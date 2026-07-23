import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { CHARACTER_ASSET_IMAGE_RATIO, addCharacterPromptSuffix, appendPromptSegments, isArtStyleValue, prependStyleReferenceImage, PRIMARY_APPEARANCE_INDEX, type ArtStyleValue } from '@/lib/constants'
import { resolveArtStyleForGeneration } from '@/lib/art-style-generation'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { assertVisionInputSupported, createVisualVersionHash } from '@/lib/visual-quality'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  toSignedUrlIfCos,
} from '../utils'
import {
  AnyObj,
  generateProjectLabeledImageToStorage,
  parseImageUrls,
  parseJsonStringArray,
  pickFirstString,
} from './image-task-handler-shared'
import { buildCharacterAssetTargetSpec } from './visual-quality-review-helpers'

function resolvePayloadArtStyle(payload: AnyObj): ArtStyleValue | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, 'artStyle')) return undefined
  const parsedArtStyle = typeof payload.artStyle === 'string' ? payload.artStyle.trim() : ''
  if (!isArtStyleValue(parsedArtStyle)) {
    throw new Error('Invalid artStyle in IMAGE_CHARACTER payload')
  }
  return parsedArtStyle
}

interface CharacterAppearanceRecord {
  id: string
  characterId: string
  appearanceIndex: number
  descriptions: string | null
  description: string | null
  imageUrls: string | null
  selectedIndex: number | null
  imageUrl: string | null
  changeReason: string | null
}

interface CharacterAppearanceWithCharacter extends CharacterAppearanceRecord {
  character: {
    name: string
  }
}

interface CharacterRecord {
  id: string
  name: string
  appearances: CharacterAppearanceRecord[]
}

interface PrimaryAppearanceRecord {
  imageUrl: string | null
  imageUrls: string | null
}

interface CharacterImageDb {
  characterAppearance: {
    findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceWithCharacter | null>
    findFirst(args: Record<string, unknown>): Promise<PrimaryAppearanceRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionCharacter: {
    findUnique(args: Record<string, unknown>): Promise<CharacterRecord | null>
  }
}

export async function handleCharacterImageTask(job: Job<TaskJobData>) {
  const db = prisma as unknown as CharacterImageDb
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const userId = job.data.userId
  const models = await getProjectModels(projectId, userId)
  const modelId = models.characterModel
  if (!modelId) throw new Error('Character model not configured')

  const appearanceId = pickFirstString(job.data.targetId, payload.appearanceId)
  let appearance: CharacterAppearanceRecord | null = null
  let appearanceForQuality: CharacterAppearanceWithCharacter | null = null
  let characterName = '角色'

  if (appearanceId) {
    const appearanceWithCharacter = await db.characterAppearance.findUnique({
      where: { id: appearanceId },
      include: { character: true },
    })
    if (appearanceWithCharacter) {
      appearance = appearanceWithCharacter
      appearanceForQuality = appearanceWithCharacter
      characterName = appearanceWithCharacter.character.name
    }
  }

  const characterId = typeof payload.id === 'string' ? payload.id : null
  if (!appearance && characterId) {
    const character = await db.novelPromotionCharacter.findUnique({
      where: { id: characterId },
      include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
    })
    appearance = character?.appearances?.[0] || null
    if (character && appearance) {
      characterName = character.name
      appearanceForQuality = {
        ...appearance,
        character: { name: character.name },
      }
    }
  }

  if (!appearance) throw new Error('Character appearance not found')

  const payloadArtStyle = resolvePayloadArtStyle(payload)
  const artStyleValue = payloadArtStyle ?? models.artStyle
  const resolvedArtStyle = resolveArtStyleForGeneration({
    artStyleMode: payloadArtStyle ? 'preset' : models.artStyleMode,
    artStyle: artStyleValue,
    artStylePrompt: models.artStylePrompt,
    customArtStyleReferenceImage: models.customArtStyleReferenceImage,
    artStyleReferenceEnabled: models.artStyleReferenceEnabled,
    locale: job.data.locale,
  })
  const descriptions = parseJsonStringArray(appearance.descriptions)
  const baseDescriptions = descriptions.length > 0 ? descriptions : [appearance.description || '']

  // 子形象（不是主形象）生成时，引用主形象图片保持一致性
  const primaryReferenceInputs: string[] = []
  if (appearance.appearanceIndex > PRIMARY_APPEARANCE_INDEX) {
    const primaryAppearance = await db.characterAppearance.findFirst({
      where: {
        characterId: appearance.characterId,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      },
      select: { imageUrl: true, imageUrls: true },
    })
    if (primaryAppearance) {
      const primaryMainUrl = primaryAppearance.imageUrl
        ? toSignedUrlIfCos(primaryAppearance.imageUrl, 3600)
        : null
      if (primaryMainUrl) {
        primaryReferenceInputs.push(primaryMainUrl)
      }
    }
  }
  const referenceImages = prependStyleReferenceImage(
    primaryReferenceInputs,
    resolvedArtStyle.referenceImage,
    resolvedArtStyle.referenceEnabled,
  )

  const singleIndex = payload.imageIndex ?? payload.descriptionIndex
  const count = normalizeImageGenerationCount('character', payload.count)
  const indexes = singleIndex !== undefined
    ? [Number(singleIndex)]
    : Array.from({ length: count }, (_value, index) => index)

  const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
  const nextImageUrls = [...imageUrls]
  const label = `${characterName} - ${appearance.changeReason || '形象'}`

  for (let i = 0; i < indexes.length; i++) {
    const index = indexes[i]
    const raw = baseDescriptions[index] || baseDescriptions[0]
    const styledPrompt = appendPromptSegments(
      raw,
      [resolvedArtStyle.prompt, resolvedArtStyle.referenceInstruction],
      job.data.locale,
    )
    const prompt = addCharacterPromptSuffix(styledPrompt)

    await reportTaskProgress(job, 15 + Math.floor((i / Math.max(indexes.length, 1)) * 55), {
      stage: 'generate_character_image',
      index,
    })

    const imageKey = await generateProjectLabeledImageToStorage({
      job,
      userId,
      modelId,
      prompt,
      label,
      targetId: `${appearance.id}-${index}`,
      keyPrefix: 'character',
      options: {
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
      },
    })

    while (nextImageUrls.length <= index) {
      nextImageUrls.push('')
    }
    nextImageUrls[index] = imageKey
  }

  const selectedIndex = appearance.selectedIndex
  const fallbackMain = nextImageUrls.find((url) => typeof url === 'string' && url) || appearance.imageUrl
  const mainImage = selectedIndex !== null && selectedIndex !== undefined && nextImageUrls[selectedIndex]
    ? nextImageUrls[selectedIndex]
    : fallbackMain

  await assertTaskActive(job, 'persist_character_image')
  await db.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      imageUrls: encodeImageUrls(nextImageUrls),
      imageUrl: mainImage || null,
    },
  })

  const qualityCandidates = nextImageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
  if (appearanceForQuality && qualityCandidates.length > 0) {
    try {
      if (!models.analysisModel) throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED')
      assertVisionInputSupported(models.analysisModel)
      const targetSpec = buildCharacterAssetTargetSpec({
        appearance: appearanceForQuality,
        artStyle: resolvedArtStyle.prompt || models.artStylePrompt || models.artStyle || '',
      })
      const versionHash = createVisualVersionHash({ targetSpec, candidateUrls: qualityCandidates })
      await submitTask({
        userId,
        locale: job.data.locale,
        projectId,
        type: TASK_TYPE.VISUAL_QUALITY_REVIEW,
        targetType: 'CharacterAppearance',
        targetId: appearance.id,
        payload: {
          assetKind: 'character',
          appearanceId: appearance.id,
          candidateUrls: qualityCandidates,
          targetSpec,
          versionHash,
          analysisModel: models.analysisModel,
          attempt: 0,
        },
        dedupeKey: `visual_quality_review:CharacterAppearance:${appearance.id}:${versionHash}`,
      })
    } catch {
      // 质量检查不可用时不阻断资产生成，用户仍可手动选择候选图。
    }
  }

  return {
    appearanceId: appearance.id,
    imageCount: nextImageUrls.filter(Boolean).length,
    imageUrl: mainImage || null,
  }
}

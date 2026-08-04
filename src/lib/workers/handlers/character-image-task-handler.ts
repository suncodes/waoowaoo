import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { CHARACTER_ASSET_IMAGE_RATIO, isArtStyleValue, type ArtStyleValue } from '@/lib/constants'
import { resolveArtStyleForGeneration } from '@/lib/art-style-generation'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { assertVisionInputSupported, createVisualVersionHash } from '@/lib/visual-quality'
import type { GenerationSnapshot } from '@/lib/creative-quality/contracts'
import { createOptionalGenerationSnapshotArtifact } from '@/lib/creative-quality/runtime-artifacts'
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
  pickFirstString,
} from './image-task-handler-shared'
import { buildCharacterAssetTargetSpec } from './visual-quality-review-helpers'
import {
  markStoryboardPanelsAwaitingAssetConfirmation,
  reconcileStoryboardPanelsForAssetChanges,
} from '@/lib/novel-promotion/storyboard-readiness'
import {
  attachPreparedPromptToSnapshot,
  requirePreparedPrompt,
  type PreparedGenerationPrompt,
} from '@/lib/creative-quality/prepared-prompts'

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
    profileData?: string | null
    semanticType?: string | null
    assetTier?: string | null
    usageScope?: string | null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readPreparedPromptArtifactId(payload: AnyObj, index: number): string {
  const byIndex = asRecord(payload.preparedPromptArtifactIds)
  const indexed = byIndex[String(index)]
  if (typeof indexed === 'string' && indexed.trim()) return indexed.trim()
  if (typeof payload.preparedPromptArtifactId === 'string' && payload.preparedPromptArtifactId.trim()) {
    return payload.preparedPromptArtifactId.trim()
  }
  return ''
}

interface CharacterRecord {
  id: string
  name: string
  profileData?: string | null
  semanticType?: string | null
  assetTier?: string | null
  usageScope?: string | null
  appearances: CharacterAppearanceRecord[]
}

interface CharacterImageDb {
  characterAppearance: {
    findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceWithCharacter | null>
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
        character: {
          name: character.name,
          profileData: character.profileData,
          semanticType: character.semanticType,
          assetTier: character.assetTier,
          usageScope: character.usageScope,
        },
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
  const singleIndex = payload.imageIndex ?? payload.descriptionIndex
  const count = normalizeImageGenerationCount('character', payload.count)
  const indexes = singleIndex !== undefined
    ? [Number(singleIndex)]
    : Array.from({ length: count }, (_value, index) => index)
  const preparedPrompts = new Map<number, PreparedGenerationPrompt>()
  for (const index of indexes) {
    const preparedPromptArtifactId = readPreparedPromptArtifactId(payload, index)
    if (!preparedPromptArtifactId) {
      throw new Error(`PREPARED_PROMPT_REQUIRED: character image index ${index}`)
    }
    const prepared = await requirePreparedPrompt({
      artifactId: preparedPromptArtifactId,
      projectId,
      targetId: appearance.id,
      refId: `${appearance.id}:${index}`,
      kind: 'asset_image',
      userId,
    })
    preparedPrompts.set(index, prepared)
  }

  const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
  const nextImageUrls = [...imageUrls]
  const label = `${characterName} - ${appearance.changeReason || '形象'}`
  const promptSnapshots: GenerationSnapshot[] = []

  for (let i = 0; i < indexes.length; i++) {
    const index = indexes[i]
    const prepared = preparedPrompts.get(index)
    if (!prepared) {
      throw new Error(`PREPARED_PROMPT_REQUIRED: character image index ${index}`)
    }
    const promptSnapshot = attachPreparedPromptToSnapshot(prepared.snapshot, prepared.artifactId)
    const prompt = promptSnapshot.compiledPrompt
    const promptReferenceImages = promptSnapshot.referenceImages.flatMap((referenceImage) => {
      const signed = toSignedUrlIfCos(referenceImage, 3600)
      return signed ? [signed] : []
    })
    promptSnapshots.push(promptSnapshot)
    await createOptionalGenerationSnapshotArtifact({
      job,
      stepKey: 'asset_image_prompt',
      artifactType: 'prompt.asset_image.snapshot',
      refId: `${appearance.id}:${index}`,
      versionHash: promptSnapshot.promptHash,
      payload: promptSnapshot,
    })

    await reportTaskProgress(job, 15 + Math.floor((i / Math.max(indexes.length, 1)) * 55), {
      stage: 'generate_character_image',
      index,
    })

    const imageKey = await generateProjectLabeledImageToStorage({
      job,
      userId,
      modelId: promptSnapshot.modelKey,
      prompt,
      label,
      targetId: `${appearance.id}-${index}`,
      keyPrefix: 'character',
      options: {
        referenceImages: promptReferenceImages.length > 0 ? promptReferenceImages : undefined,
        aspectRatio: typeof prepared.generationOptions.aspectRatio === 'string'
          ? prepared.generationOptions.aspectRatio
          : CHARACTER_ASSET_IMAGE_RATIO,
        generationOptions: prepared.generationOptions,
      },
    })

    while (nextImageUrls.length <= index) {
      nextImageUrls.push('')
    }
    nextImageUrls[index] = imageKey
  }

  const selectedIndex = appearance.selectedIndex
  const selectedImageWasReplaced = selectedIndex !== null && selectedIndex !== undefined && indexes.includes(selectedIndex)
  const nextSelectedIndex = selectedImageWasReplaced ? null : selectedIndex
  const fallbackMain = nextImageUrls.find((url) => typeof url === 'string' && url) || appearance.imageUrl
  const mainImage = nextSelectedIndex !== null && nextSelectedIndex !== undefined && nextImageUrls[nextSelectedIndex]
    ? nextImageUrls[nextSelectedIndex]
    : fallbackMain

  await assertTaskActive(job, 'persist_character_image')
  await db.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      imageUrls: encodeImageUrls(nextImageUrls),
      imageUrl: mainImage || null,
      ...(selectedImageWasReplaced ? { selectedIndex: null } : {}),
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

  const assetIds = [appearance.characterId]
  const assetReconciliation = selectedImageWasReplaced
    ? await reconcileStoryboardPanelsForAssetChanges({
      projectId,
      userId,
      assetIds,
      locale: job.data.locale,
    })
    : null
  const awaitingAssetConfirmationPanelIds = payload.source === 'asset_backfill'
    ? await markStoryboardPanelsAwaitingAssetConfirmation({ projectId, assetIds })
    : []

  return {
    appearanceId: appearance.id,
    imageCount: nextImageUrls.filter(Boolean).length,
    imageUrl: mainImage || null,
    assetReconciliation,
    awaitingAssetConfirmationPanelIds,
    promptSnapshots,
  }
}

import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { CHARACTER_ASSET_IMAGE_RATIO, LOCATION_IMAGE_RATIO, PROP_IMAGE_RATIO, appendArtStyleReferenceImage, getArtStylePrompt, getArtStyleReferenceInstruction } from '@/lib/constants'
import { type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { createCreativeQualityHash, type GenerationSnapshot } from '@/lib/creative-quality/contracts'
import { createOptionalGenerationSnapshotArtifact } from '@/lib/creative-quality/runtime-artifacts'
import {
  ASSET_PROMPT_TEMPLATE_ID,
  buildAssetImageGenerationSnapshot,
  buildAssetPromptSpec,
  compileAssetImagePrompt,
} from '@/lib/prompt-compiler/asset-prompt-compiler'
import {
  createAssetVisualFactPreparationHash,
  findReusableAssetVisualFactOptimization,
  resolveAssetVisualFactsWithAI,
} from '@/lib/prompt-compiler/asset-visual-fact-extractor'
import {
  assertTaskActive,
  getUserModels,
} from '../utils'
import {
  AnyObj,
  generateCleanImageToStorage,
  parseJsonStringArray,
} from './image-task-handler-shared'

interface GlobalCharacterAppearanceRecord {
  id: string
  appearanceIndex: number
  changeReason: string | null
  description: string | null
  descriptions: string | null
}

interface GlobalCharacterRecord {
  id: string
  name: string
  profileData?: string | null
  semanticType?: string | null
  assetTier?: string | null
  usageScope?: string | null
  appearances: GlobalCharacterAppearanceRecord[]
}

interface GlobalLocationImageRecord {
  id: string
  description: string | null
  availableSlots?: string | null
}

interface GlobalLocationRecord {
  id: string
  name: string
  semanticType?: string | null
  assetTier?: string | null
  usageScope?: string | null
  images: GlobalLocationImageRecord[]
}

interface AssetHubImageDb {
  globalCharacter: {
    findFirst(args: Record<string, unknown>): Promise<GlobalCharacterRecord | null>
  }
  globalCharacterAppearance: {
    update(args: Record<string, unknown>): Promise<unknown>
  }
  globalLocation: {
    findFirst(args: Record<string, unknown>): Promise<GlobalLocationRecord | null>
  }
  globalLocationImage: {
    update(args: Record<string, unknown>): Promise<unknown>
  }
}

export async function handleAssetHubImageTask(job: Job<TaskJobData>) {
  const db = prisma as unknown as AssetHubImageDb
  const payload = (job.data.payload || {}) as AnyObj
  const userId = job.data.userId
  const userModels = await getUserModels(userId)
  const artStyleValue = typeof payload.artStyle === 'string' ? payload.artStyle : undefined
  const artStyle = getArtStylePrompt(
    artStyleValue,
    job.data.locale,
  )
  const styleReferenceImages = appendArtStyleReferenceImage([], artStyleValue)
  const styleReferenceInstruction = getArtStyleReferenceInstruction(
    artStyleValue,
    true,
    job.data.locale,
  )

  if (payload.type === 'character') {
    const characterId = typeof payload.id === 'string' ? payload.id : null
    if (!characterId) throw new Error('Global character id missing')

    const character = await db.globalCharacter.findFirst({
      where: { id: characterId, userId },
      include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
    })

    if (!character) throw new Error('Global character not found')

    const appearanceIndex = Number(payload.appearanceIndex ?? PRIMARY_APPEARANCE_INDEX)
    const appearance = character.appearances.find((appearanceItem) => appearanceItem.appearanceIndex === appearanceIndex)
    if (!appearance) throw new Error('Global character appearance not found')

    const modelId = userModels.characterModel
    if (!modelId) throw new Error('User character model not configured')

    const descriptions = parseJsonStringArray(appearance.descriptions)
    const base = descriptions.length ? descriptions : [appearance.description || '']
    const assetFactInput = {
      model: userModels.analysisModel,
      assetKind: 'character' as const,
      assetName: character.name,
      description: base[0] || '',
      semanticType: character.semanticType,
      variantLabel: appearance.changeReason,
      profileData: character.profileData,
      locale: job.data.locale,
    }
    const reusableAssetOptimization = await findReusableAssetVisualFactOptimization({
      projectId: job.data.projectId,
      targetId: appearance.id,
      preparationHash: createAssetVisualFactPreparationHash(assetFactInput),
    })
    const resolvedAssetFacts = await resolveAssetVisualFactsWithAI({
      userId,
      projectId: job.data.projectId,
      input: assetFactInput,
      reusableOptimization: reusableAssetOptimization,
    })
    const count = normalizeImageGenerationCount('character', payload.count)
    const imageUrls: string[] = []
    const promptSnapshots: GenerationSnapshot[] = []

    for (let i = 0; i < count; i++) {
      const raw = base[i] || base[0]
      const promptSpec = buildAssetPromptSpec({
        assetId: appearance.id,
        assetKind: 'character',
        assetName: character.name,
        description: raw,
        profileData: character.profileData,
        extractedFacts: resolvedAssetFacts.facts,
        promptOptimization: resolvedAssetFacts.optimization,
        semanticType: character.semanticType,
        assetTier: character.assetTier,
        usageScope: character.usageScope,
        renderPurpose: appearance.appearanceIndex === PRIMARY_APPEARANCE_INDEX ? 'reference_sheet' : 'variant',
        variantLabel: appearance.changeReason,
        styleText: artStyle,
        styleReferenceInstruction,
        locale: job.data.locale,
      })
      const prompt = compileAssetImagePrompt({
        spec: promptSpec,
        locale: job.data.locale,
      })
      const assetVersionHash = createCreativeQualityHash({
        assetKind: 'character',
        appearanceId: appearance.id,
        characterId: character.id,
        characterName: character.name,
        appearanceIndex: appearance.appearanceIndex,
        changeReason: appearance.changeReason,
        description: raw,
        referenceImages: styleReferenceImages,
      })
      const promptSnapshot = buildAssetImageGenerationSnapshot({
        targetType: 'GlobalCharacterAppearance',
        targetId: appearance.id,
        modelKey: modelId,
        promptTemplateId: ASSET_PROMPT_TEMPLATE_ID,
        referenceImages: styleReferenceImages,
        promptSpec,
        compiledPrompt: prompt,
        assetVersionHash,
      })
      promptSnapshots.push(promptSnapshot)
      await createOptionalGenerationSnapshotArtifact({
        job,
        stepKey: 'asset_image_prompt',
        artifactType: 'prompt.asset_image.snapshot',
        refId: `${appearance.id}:${i}`,
        versionHash: promptSnapshot.promptHash,
        payload: promptSnapshot,
      })
      const imageKey = await generateCleanImageToStorage({
        job,
        userId,
        modelId,
        prompt,
        targetId: `${appearance.id}-${i}`,
        keyPrefix: 'global-character',
        options: {
          referenceImages: styleReferenceImages.length > 0 ? styleReferenceImages : undefined,
          aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
        },
      })
      imageUrls.push(imageKey)
    }

    await assertTaskActive(job, 'persist_global_character_image')
    await db.globalCharacterAppearance.update({
      where: { id: appearance.id },
      data: {
        imageUrls: encodeImageUrls(imageUrls),
        imageUrl: imageUrls[0] || null,
        selectedIndex: null,
      },
    })

    return { type: payload.type, appearanceId: appearance.id, imageCount: imageUrls.length, promptSnapshots }
  }

  if (payload.type === 'location' || payload.type === 'prop') {
    const locationId = typeof payload.id === 'string' ? payload.id : null
    if (!locationId) throw new Error('Global location id missing')

    const location = await db.globalLocation.findFirst({
      where: { id: locationId, userId },
      include: { images: { orderBy: { imageIndex: 'asc' } } },
    })

    if (!location || !location.images?.length) throw new Error('Global location not found')

    const modelId = userModels.locationModel
    if (!modelId) throw new Error('User location model not configured')

    const count = normalizeImageGenerationCount('location', payload.count)
    const targetImages = Object.prototype.hasOwnProperty.call(payload, 'count')
      ? location.images.slice(0, count)
      : location.images
    const promptSnapshots: GenerationSnapshot[] = []

    for (const image of targetImages) {
      if (!image.description) continue
      const assetKind = payload.type === 'prop' ? 'prop' : 'location'
      const assetFactInput = {
        model: userModels.analysisModel,
        assetKind: assetKind as 'location' | 'prop',
        assetName: location.name,
        description: image.description,
        semanticType: location.semanticType,
        locale: job.data.locale,
      }
      const reusableAssetOptimization = await findReusableAssetVisualFactOptimization({
        projectId: job.data.projectId,
        targetId: image.id,
        preparationHash: createAssetVisualFactPreparationHash(assetFactInput),
      })
      const resolvedAssetFacts = await resolveAssetVisualFactsWithAI({
        userId,
        projectId: job.data.projectId,
        input: assetFactInput,
        reusableOptimization: reusableAssetOptimization,
      })
      const promptSpec = buildAssetPromptSpec({
        assetId: image.id,
        assetKind,
        assetName: location.name,
        description: image.description,
        extractedFacts: resolvedAssetFacts.facts,
        promptOptimization: resolvedAssetFacts.optimization,
        semanticType: location.semanticType,
        assetTier: location.assetTier,
        usageScope: location.usageScope,
        renderPurpose: assetKind === 'prop' ? 'reference_sheet' : 'single_reference',
        styleText: artStyle,
        styleReferenceInstruction,
        availableSlotsRaw: image.availableSlots,
        locale: job.data.locale,
      })
      const prompt = compileAssetImagePrompt({
        spec: promptSpec,
        locale: job.data.locale,
      })
      const aspectRatio = payload.type === 'prop' ? PROP_IMAGE_RATIO : LOCATION_IMAGE_RATIO
      const assetVersionHash = createCreativeQualityHash({
        assetKind,
        locationImageId: image.id,
        locationId: location.id,
        locationName: location.name,
        description: image.description,
        availableSlots: image.availableSlots,
        referenceImages: styleReferenceImages,
      })
      const promptSnapshot = buildAssetImageGenerationSnapshot({
        targetType: 'GlobalLocationImage',
        targetId: image.id,
        modelKey: modelId,
        promptTemplateId: ASSET_PROMPT_TEMPLATE_ID,
        referenceImages: styleReferenceImages,
        promptSpec,
        compiledPrompt: prompt,
        assetVersionHash,
      })
      promptSnapshots.push(promptSnapshot)
      await createOptionalGenerationSnapshotArtifact({
        job,
        stepKey: 'asset_image_prompt',
        artifactType: 'prompt.asset_image.snapshot',
        refId: image.id,
        versionHash: promptSnapshot.promptHash,
        payload: promptSnapshot,
      })

      const imageKey = await generateCleanImageToStorage({
        job,
        userId,
        modelId,
        prompt,
        targetId: image.id,
        keyPrefix: 'global-location',
        options: {
          referenceImages: styleReferenceImages.length > 0 ? styleReferenceImages : undefined,
          aspectRatio,
        },
      })

      await assertTaskActive(job, 'persist_global_location_image')
      await db.globalLocationImage.update({
        where: { id: image.id },
        data: { imageUrl: imageKey },
      })
    }

    return { type: payload.type, locationId: location.id, imageCount: targetImages.length, promptSnapshots }
  }

  throw new Error(`Unsupported asset-hub image type: ${String(payload.type)}`)
}

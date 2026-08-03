import {
  CHARACTER_ASSET_IMAGE_RATIO,
  isArtStyleValue,
  LOCATION_IMAGE_RATIO,
  prependStyleReferenceImage,
  PRIMARY_APPEARANCE_INDEX,
  PROP_IMAGE_RATIO,
  type ArtStyleValue,
} from '@/lib/constants'
import { resolveArtStyleForGeneration } from '@/lib/art-style-generation'
import { getProjectModelConfig } from '@/lib/config-service'
import { createCreativeQualityHash } from '@/lib/creative-quality/contracts'
import {
  persistPreparedPrompt,
  type PreparedGenerationPrompt,
} from '@/lib/creative-quality/prepared-prompts'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import {
  ASSET_PROMPT_TEMPLATE_ID,
  buildAssetImageGenerationSnapshot,
  buildAssetPromptSpec,
  compileAssetImagePrompt,
} from '@/lib/prompt-compiler/asset-prompt-compiler'
import {
  findReusableAssetVisualFactOptimization,
  createAssetVisualFactPreparationHash,
  resolveAssetVisualFactsWithAI,
} from '@/lib/prompt-compiler/asset-visual-fact-extractor'
import type { Locale } from '@/i18n/routing'
import { prisma } from '@/lib/prisma'

type AssetGenerationPayload = Record<string, unknown>

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
      : []
  } catch {
    return []
  }
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function generationOptionsForAsset(
  payload: AssetGenerationPayload,
  aspectRatio: string,
): Record<string, string | number | boolean> {
  const options: Record<string, string | number | boolean> = { aspectRatio }
  const rawOptions = payload.generationOptions
  if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) return options
  for (const [key, value] of Object.entries(rawOptions as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      options[key] = value
    }
  }
  return options
}

function resolveIndexes(payload: AssetGenerationPayload, countType: 'character' | 'location') {
  const singleIndex = payload.imageIndex ?? payload.descriptionIndex
  if (singleIndex !== undefined && singleIndex !== null && readNumber(singleIndex) !== null) {
    return [Math.max(0, Math.floor(readNumber(singleIndex)!))]
  }
  const count = normalizeImageGenerationCount(countType, payload.count)
  return Array.from({ length: count }, (_value, index) => index)
}

function resolveArtStyleValue(payload: AssetGenerationPayload): ArtStyleValue | undefined {
  const value = readString(payload.artStyle)
  return isArtStyleValue(value) ? value : undefined
}

export async function prepareProjectAssetImagePrompts(params: {
  projectId: string
  userId: string
  locale: Locale
  kind: 'character' | 'location' | 'prop'
  assetId: string
  targetType: 'CharacterAppearance' | 'LocationImage'
  targetId: string
  payload: AssetGenerationPayload
}): Promise<PreparedGenerationPrompt[]> {
  const modelConfig = await getProjectModelConfig(params.projectId, params.userId)
  const artStyleValue = resolveArtStyleValue(params.payload)
  const resolvedArtStyle = resolveArtStyleForGeneration({
    artStyleMode: artStyleValue ? 'preset' : modelConfig.artStyleMode,
    artStyle: artStyleValue || modelConfig.artStyle,
    artStylePrompt: modelConfig.artStylePrompt,
    customArtStyleReferenceImage: modelConfig.customArtStyleReferenceImage,
    artStyleReferenceEnabled: modelConfig.artStyleReferenceEnabled,
    locale: params.locale,
  })

  if (params.kind === 'character') {
    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: params.targetId },
      include: { character: true },
    })
    if (!appearance) throw new Error('Character appearance not found')
    const modelKey = modelConfig.characterModel
    if (!modelKey) throw new Error('Character model not configured')
    const descriptions = parseStringArray(appearance.descriptions)
    const baseDescriptions = descriptions.length > 0 ? descriptions : [appearance.description || '']
    const assetFactInput = {
      model: modelConfig.analysisModel,
      assetKind: 'character' as const,
      assetName: appearance.character.name,
      description: baseDescriptions[0] || '',
      semanticType: appearance.character.semanticType,
      variantLabel: appearance.changeReason,
      profileData: appearance.character.profileData,
      locale: params.locale,
    }
    const reusableOptimization = await findReusableAssetVisualFactOptimization({
      projectId: params.projectId,
      targetId: appearance.id,
      preparationHash: createAssetVisualFactPreparationHash(assetFactInput),
    })
    const resolvedFacts = await resolveAssetVisualFactsWithAI({
      userId: params.userId,
      projectId: params.projectId,
      input: assetFactInput,
      reusableOptimization,
    })
    const primaryReferenceInputs: string[] = []
    if (appearance.appearanceIndex > PRIMARY_APPEARANCE_INDEX) {
      const primaryAppearance = await prisma.characterAppearance.findFirst({
        where: {
          characterId: appearance.characterId,
          appearanceIndex: PRIMARY_APPEARANCE_INDEX,
        },
        select: { imageUrl: true },
      })
      const primaryImage = readString(primaryAppearance?.imageUrl)
      if (primaryImage) primaryReferenceInputs.push(primaryImage)
    }
    const referenceImages = prependStyleReferenceImage(
      primaryReferenceInputs,
      resolvedArtStyle.referenceImage,
      resolvedArtStyle.referenceEnabled,
    )
    const preparedPrompts: PreparedGenerationPrompt[] = []
    for (const index of resolveIndexes(params.payload, 'character')) {
      const description = baseDescriptions[index] || baseDescriptions[0] || ''
      const promptSpec = buildAssetPromptSpec({
        assetId: appearance.id,
        assetKind: 'character',
        assetName: appearance.character.name,
        description,
        profileData: appearance.character.profileData,
        extractedFacts: resolvedFacts.facts,
        promptOptimization: resolvedFacts.optimization,
        semanticType: appearance.character.semanticType,
        assetTier: appearance.character.assetTier,
        usageScope: appearance.character.usageScope,
        renderPurpose: appearance.appearanceIndex === PRIMARY_APPEARANCE_INDEX ? 'reference_sheet' : 'variant',
        variantLabel: appearance.changeReason,
        styleText: resolvedArtStyle.prompt,
        styleReferenceInstruction: resolvedArtStyle.referenceInstruction,
        locale: params.locale,
      })
      const snapshot = buildAssetImageGenerationSnapshot({
        targetType: 'CharacterAppearance',
        targetId: appearance.id,
        modelKey,
        promptTemplateId: ASSET_PROMPT_TEMPLATE_ID,
        referenceImages,
        promptSpec,
        compiledPrompt: compileAssetImagePrompt({ spec: promptSpec, locale: params.locale }),
        assetVersionHash: createCreativeQualityHash({
          assetKind: 'character',
          appearanceId: appearance.id,
          characterId: appearance.characterId,
          characterName: appearance.character.name,
          appearanceIndex: appearance.appearanceIndex,
          changeReason: appearance.changeReason,
          description,
          referenceImages,
        }),
      })
      preparedPrompts.push(await persistPreparedPrompt({
        userId: params.userId,
        projectId: params.projectId,
        kind: 'asset_image',
        targetType: 'CharacterAppearance',
        targetId: appearance.id,
        refId: `${appearance.id}:${index}`,
        generationOptions: generationOptionsForAsset(params.payload, CHARACTER_ASSET_IMAGE_RATIO),
        snapshot,
        metadata: { assetId: params.assetId, imageIndex: index, assetKind: 'character' },
      }))
    }
    return preparedPrompts
  }

  const location = await prisma.novelPromotionLocation.findUnique({
    where: { id: params.assetId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!location) throw new Error('Location asset not found')
  const modelKey = modelConfig.locationModel
  if (!modelKey) throw new Error('Location model not configured')
  const requestedIndexes = resolveIndexes(params.payload, 'location')
  const selectedImages = readNumber(params.payload.imageIndex) === null
    ? location.images.filter((item) => requestedIndexes.includes(item.imageIndex))
    : location.images.filter((item) => item.imageIndex === requestedIndexes[0])
  if (selectedImages.length === 0) throw new Error('Location image not found')
  const assetKind: 'location' | 'prop' = params.kind === 'prop' ? 'prop' : 'location'
  const aspectRatio = assetKind === 'prop' ? PROP_IMAGE_RATIO : LOCATION_IMAGE_RATIO
  const referenceImages = prependStyleReferenceImage(
    [],
    resolvedArtStyle.referenceImage,
    resolvedArtStyle.referenceEnabled,
  )
  const preparedPrompts: PreparedGenerationPrompt[] = []
  for (const image of selectedImages) {
    const description = image.description || ''
    const assetFactInput = {
      model: modelConfig.analysisModel,
      assetKind,
      assetName: location.name,
      description,
      semanticType: location.semanticType,
      locale: params.locale,
    }
    const reusableOptimization = await findReusableAssetVisualFactOptimization({
      projectId: params.projectId,
      targetId: image.id,
      preparationHash: createAssetVisualFactPreparationHash(assetFactInput),
    })
    const resolvedFacts = await resolveAssetVisualFactsWithAI({
      userId: params.userId,
      projectId: params.projectId,
      input: assetFactInput,
      reusableOptimization,
    })
    const promptSpec = buildAssetPromptSpec({
      assetId: image.id,
      assetKind,
      assetName: location.name,
      description,
      extractedFacts: resolvedFacts.facts,
      promptOptimization: resolvedFacts.optimization,
      semanticType: location.semanticType,
      assetTier: location.assetTier,
      usageScope: location.usageScope,
      renderPurpose: assetKind === 'prop' ? 'reference_sheet' : 'single_reference',
      styleText: resolvedArtStyle.prompt,
      styleReferenceInstruction: resolvedArtStyle.referenceInstruction,
      availableSlotsRaw: image.availableSlots,
      locale: params.locale,
    })
    const snapshot = buildAssetImageGenerationSnapshot({
      targetType: 'LocationImage',
      targetId: image.id,
      modelKey,
      promptTemplateId: ASSET_PROMPT_TEMPLATE_ID,
      referenceImages,
      promptSpec,
      compiledPrompt: compileAssetImagePrompt({ spec: promptSpec, locale: params.locale }),
      assetVersionHash: createCreativeQualityHash({
        assetKind,
        locationImageId: image.id,
        locationId: image.locationId,
        name: location.name,
        description,
        availableSlots: image.availableSlots,
        referenceImages,
      }),
    })
    preparedPrompts.push(await persistPreparedPrompt({
      userId: params.userId,
      projectId: params.projectId,
      kind: 'asset_image',
      targetType: 'LocationImage',
      targetId: image.id,
      refId: image.id,
      generationOptions: generationOptionsForAsset(params.payload, aspectRatio),
      snapshot,
      metadata: { assetId: params.assetId, imageIndex: image.imageIndex, assetKind },
    }))
  }
  return preparedPrompts
}

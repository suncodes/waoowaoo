import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { LOCATION_IMAGE_RATIO, PROP_IMAGE_RATIO, isArtStyleValue, prependStyleReferenceImage, type ArtStyleValue } from '@/lib/constants'
import { resolveArtStyleForGeneration } from '@/lib/art-style-generation'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { assertVisionInputSupported, createVisualVersionHash } from '@/lib/visual-quality'
import { createCreativeQualityHash, type GenerationSnapshot } from '@/lib/creative-quality/contracts'
import { createOptionalGenerationSnapshotArtifact } from '@/lib/creative-quality/runtime-artifacts'
import {
  ASSET_PROMPT_TEMPLATE_ID,
  buildAssetImageGenerationSnapshot,
  buildAssetPromptSpec,
  compileAssetImagePrompt,
} from '@/lib/prompt-compiler/asset-prompt-compiler'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
} from '../utils'
import {
  AnyObj,
  generateProjectLabeledImageToStorage,
  pickFirstString,
} from './image-task-handler-shared'
import { buildLocationAssetTargetSpec } from './visual-quality-review-helpers'

function resolvePayloadArtStyle(payload: AnyObj): ArtStyleValue | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, 'artStyle')) return undefined
  const parsedArtStyle = typeof payload.artStyle === 'string' ? payload.artStyle.trim() : ''
  if (!isArtStyleValue(parsedArtStyle)) {
    throw new Error('Invalid artStyle in IMAGE_LOCATION payload')
  }
  return parsedArtStyle
}

interface LocationImageRecord {
  id: string
  locationId: string
  description: string | null
  availableSlots?: string | null
  imageIndex: number
  location?: {
    name: string
    summary?: string | null
    assetKind?: string | null
    semanticType?: string | null
    assetTier?: string | null
    usageScope?: string | null
  } | null
}

interface LocationWithImages {
  id: string
  name: string
  summary?: string | null
  assetKind?: string | null
  semanticType?: string | null
  assetTier?: string | null
  usageScope?: string | null
  images?: LocationImageRecord[]
}

interface LocationImageTaskDb {
  locationImage: {
    findUnique(args: Record<string, unknown>): Promise<LocationImageRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionLocation: {
    findUnique(args: Record<string, unknown>): Promise<LocationWithImages | null>
    findMany(args: Record<string, unknown>): Promise<LocationWithImages[]>
  }
}

function resolveRequestedLocationCount(payload: AnyObj): number | null {
  if (!Object.prototype.hasOwnProperty.call(payload, 'count')) return null
  return normalizeImageGenerationCount('location', payload.count)
}

export async function handleLocationImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const userId = job.data.userId
  const db = prisma as unknown as LocationImageTaskDb
  const models = await getProjectModels(projectId, userId)
  const modelId = models.locationModel
  if (!modelId) throw new Error('Location model not configured')
  const requestedCount = resolveRequestedLocationCount(payload)

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
  const styleReferenceImages = prependStyleReferenceImage([], resolvedArtStyle.referenceImage, resolvedArtStyle.referenceEnabled)
  const assetType = payload.type === 'prop' ? 'prop' : 'location'

  // targetId may be locationId (group) or locationImageId (single)
  const maybeLocationImage = await db.locationImage.findUnique({
    where: { id: job.data.targetId },
    include: { location: true },
  })

  let locationImages: LocationImageRecord[] = []
  // 用于存储 locationId -> name 的映射，避免 images 子集缺少 location 关联
  const locationNameMap: Record<string, string> = {}
  const locationMetaMap: Record<string, {
    name: string
    summary?: string | null
    assetKind?: string | null
    semanticType?: string | null
    assetTier?: string | null
    usageScope?: string | null
  }> = {}

  if (maybeLocationImage) {
    // 来源 location 名字已 include，先记录
    if (maybeLocationImage.location?.name) {
      locationNameMap[maybeLocationImage.locationId] = maybeLocationImage.location.name
      locationMetaMap[maybeLocationImage.locationId] = maybeLocationImage.location
    }
    if (payload.imageIndex !== undefined) {
      locationImages = [maybeLocationImage]
    } else {
      const location = await db.novelPromotionLocation.findUnique({
        where: { id: maybeLocationImage.locationId },
        include: { images: { orderBy: { imageIndex: 'asc' } } },
      })
      if (location?.name) {
        locationNameMap[maybeLocationImage.locationId] = location.name
        locationMetaMap[maybeLocationImage.locationId] = {
          name: location.name,
          summary: location.summary,
          assetKind: location.assetKind,
          semanticType: location.semanticType,
          assetTier: location.assetTier,
          usageScope: location.usageScope,
        }
      }
      const orderedImages = location?.images || [maybeLocationImage]
      locationImages = requestedCount === null ? orderedImages : orderedImages.slice(0, requestedCount)
    }
  } else {
    const locationId = pickFirstString(payload.id, payload.locationId, job.data.targetId)
    if (!locationId) throw new Error('Location id missing')

    const location = await db.novelPromotionLocation.findUnique({
      where: { id: locationId },
      include: { images: { orderBy: { imageIndex: 'asc' } } },
    })

    if (!location || !location.images?.length) {
      throw new Error('Location images not found')
    }

    // 记录 location 名字
    locationNameMap[locationId] = location.name
    locationMetaMap[locationId] = {
      name: location.name,
      summary: location.summary,
      assetKind: location.assetKind,
      semanticType: location.semanticType,
      assetTier: location.assetTier,
      usageScope: location.usageScope,
    }

    if (payload.imageIndex !== undefined) {
      const image = location.images.find((it) => it.imageIndex === Number(payload.imageIndex))
      if (!image) throw new Error(`Location image not found for imageIndex=${payload.imageIndex}`)
      locationImages = [image]
    } else {
      locationImages = requestedCount === null ? location.images : location.images.slice(0, requestedCount)
    }
  }

  // 补充查询缺失的 location 名字（兜底）
  const missingLocationIds = Array.from(new Set(locationImages.map((it) => it.locationId)))
    .filter((id) => !locationNameMap[id])
  if (missingLocationIds.length > 0) {
    const extras = await db.novelPromotionLocation.findMany({
      where: { id: { in: missingLocationIds } } as Record<string, unknown>,
    })
    for (const loc of extras) {
      locationNameMap[loc.id] = loc.name
      locationMetaMap[loc.id] = {
        name: loc.name,
        summary: loc.summary,
        assetKind: loc.assetKind,
        semanticType: loc.semanticType,
        assetTier: loc.assetTier,
        usageScope: loc.usageScope,
      }
    }
  }

  const locationIds = Array.from(new Set(locationImages.map((it) => it.locationId)))
  const generatedByLocationId = new Map<string, Array<{
    item: LocationImageRecord
    imageKey: string
    promptBody: string
  }>>()
  const promptSnapshots: GenerationSnapshot[] = []

  for (let i = 0; i < locationImages.length; i++) {
    const item = locationImages[i]
    // 优先用映射表中的名字，回退到 item.location?.name，最后才用默认值
    const name = locationNameMap[item.locationId] || item.location?.name || '场景'
    const promptBody = item.description || ''
    if (!promptBody) continue
    const promptSpec = buildAssetPromptSpec({
      assetId: item.id,
      assetKind: assetType,
      assetName: name,
      description: promptBody,
      semanticType: locationMetaMap[item.locationId]?.semanticType,
      assetTier: locationMetaMap[item.locationId]?.assetTier,
      usageScope: locationMetaMap[item.locationId]?.usageScope,
      renderPurpose: assetType === 'prop' ? 'reference_sheet' : 'single_reference',
      styleText: resolvedArtStyle.prompt,
      styleReferenceInstruction: resolvedArtStyle.referenceInstruction,
      availableSlotsRaw: item.availableSlots,
      locale: job.data.locale,
    })
    const prompt = compileAssetImagePrompt({
      spec: promptSpec,
      locale: job.data.locale,
    })
    const aspectRatio = assetType === 'prop' ? PROP_IMAGE_RATIO : LOCATION_IMAGE_RATIO
    const assetVersionHash = createCreativeQualityHash({
      assetKind: assetType,
      locationImageId: item.id,
      locationId: item.locationId,
      name,
      description: promptBody,
      availableSlots: item.availableSlots,
      referenceImages: styleReferenceImages,
    })
    const promptSnapshot = buildAssetImageGenerationSnapshot({
      targetType: 'LocationImage',
      targetId: item.id,
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
      refId: item.id,
      versionHash: promptSnapshot.promptHash,
      payload: promptSnapshot,
    })
    await reportTaskProgress(job, 20 + Math.floor((i / Math.max(locationImages.length, 1)) * 55), {
      stage: 'generate_location_image',
      imageId: item.id,
    })

    const imageKey = await generateProjectLabeledImageToStorage({
      job,
      userId,
      modelId,
      prompt,
      label: name,
      targetId: item.id,
      keyPrefix: 'location',
      options: {
        referenceImages: styleReferenceImages.length > 0 ? styleReferenceImages : undefined,
        aspectRatio,
      },
    })

    await assertTaskActive(job, 'persist_location_image')
    await db.locationImage.update({
      where: { id: item.id },
      data: { imageUrl: imageKey },
    })

    const generatedItems = generatedByLocationId.get(item.locationId) || []
    generatedItems.push({
      item,
      imageKey,
      promptBody,
    })
    generatedByLocationId.set(item.locationId, generatedItems)
  }

  for (const [locationId, generatedItems] of generatedByLocationId) {
    const firstItem = generatedItems[0]
    if (!firstItem) continue
    try {
      if (!models.analysisModel) throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED')
      assertVisionInputSupported(models.analysisModel)
      const locationMeta = locationMetaMap[locationId] || {
        name: locationNameMap[locationId] || '场景',
        assetKind: assetType,
      }
      const targetSpec = buildLocationAssetTargetSpec({
        image: {
          ...firstItem.item,
          description: firstItem.promptBody,
          location: locationMeta,
        },
        artStyle: resolvedArtStyle.prompt || models.artStylePrompt || models.artStyle || '',
      })
      const candidateUrls = generatedItems.map((generatedItem) => generatedItem.imageKey)
      const versionHash = createVisualVersionHash({ targetSpec, candidateUrls })
      await submitTask({
        userId,
        locale: job.data.locale,
        projectId,
        type: TASK_TYPE.VISUAL_QUALITY_REVIEW,
        targetType: 'LocationImage',
        targetId: firstItem.item.id,
        payload: {
          assetKind: assetType,
          locationId,
          locationImageId: firstItem.item.id,
          candidateUrls,
          targetSpec,
          versionHash,
          analysisModel: models.analysisModel,
          attempt: 0,
        },
        dedupeKey: `visual_quality_review:LocationImage:${firstItem.item.id}:${versionHash}`,
      })
    } catch {
      // 质量检查不可用时不阻断资产生成，用户仍可手动选择候选图。
    }
  }

  return {
    updated: locationImages.length,
    locationIds,
    promptSnapshots,
  }
}

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getProjectModelConfig, buildImageBillingPayload } from '@/lib/config-service'
import { createProjectLocationBackedAsset } from '@/lib/assets/services/location-backed-assets'
import { buildAssetMeta } from '@/lib/assets/asset-semantics'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { ensureProjectLocationImageSlots } from '@/lib/image-generation/location-slots'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import type { Locale } from '@/i18n/routing'
import type { PanelAssetBindingPlan } from './binding-plan'
import type { PanelGenerationRouteDecision } from './panel-generation-router'
import type {
  ShotAssetRequirement,
  ShotAssetRequirementPlan,
} from './shot-asset-requirements'
import { canAutoBackfillRequirement } from './asset-reference-policy'

export type MissingAssetBackfillPriority = 'blocking' | 'warning'
export type MissingAssetBackfillStatus =
  | 'planned'
  | 'existing_asset_ready'
  | 'existing_asset_queued'
  | 'created_asset_queued'
  | 'human_required'
  | 'skipped'

export interface MissingAssetBackfillRequest {
  name: string
  kind: ShotAssetRequirement['kind']
  semanticType?: string
  summary: string
  description: string
  sourcePanelIds: string[]
  priority: MissingAssetBackfillPriority
  autoGenerate: boolean
  reason: string
  assetId?: string | null
  taskId?: string | null
  status: MissingAssetBackfillStatus
}

export interface MissingAssetBackfillPlan {
  schemaVersion: 1
  panelId: string
  status: 'not_needed' | 'queued' | 'ready' | 'human_required'
  requests: MissingAssetBackfillRequest[]
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function isLocationBackedKind(kind: ShotAssetRequirement['kind']): kind is 'location' | 'prop' {
  return kind === 'location' || kind === 'prop'
}

function isAutoBackfillKind(kind: ShotAssetRequirement['kind']): kind is 'character' | 'location' | 'prop' {
  return kind === 'character' || isLocationBackedKind(kind)
}

function requestMatchesRequirement(
  request: MissingAssetBackfillRequest,
  requirement: ShotAssetRequirement,
): boolean {
  if (request.assetId && requirement.assetId === request.assetId) return true
  return request.kind === requirement.kind && normalizeName(request.name) === normalizeName(requirement.name)
}

function blockedRequirementNames(decision: PanelGenerationRouteDecision): Set<string> {
  return new Set(decision.blockingAssetNames.map(normalizeName))
}

function requirementNeedsBackfill(
  requirement: ShotAssetRequirement,
  decision: PanelGenerationRouteDecision,
): boolean {
  const blockedNames = blockedRequirementNames(decision)
  return blockedNames.has(normalizeName(requirement.name))
}

function buildDescription(params: {
  requirement: ShotAssetRequirement
  bindingPlan: PanelAssetBindingPlan
}): string {
  const kindLabel = params.requirement.kind === 'character'
    ? '角色'
    : params.requirement.kind === 'prop'
      ? '道具'
      : '场景'
  return [
    `${params.requirement.name}，用于分镜镜头的稳定${kindLabel}参考。`,
    params.requirement.semanticType ? `语义类型：${params.requirement.semanticType}。` : '',
    params.requirement.reason ? `镜头需求：${params.requirement.reason}。` : '',
    params.bindingPlan.primarySubject ? `关联主视觉主体：${params.bindingPlan.primarySubject}。` : '',
    params.requirement.kind === 'character'
      ? '生成为可复用角色形象参考图，面部、服装、轮廓和关键识别特征清晰稳定，无文字、无水印、无标志。'
      : '生成为可复用资产参考图，主体清晰、无文字、无水印、无标志。',
  ].filter(Boolean).join('\n')
}

export function planMissingAssetBackfill(params: {
  panelId: string
  bindingPlan: PanelAssetBindingPlan
  decision: PanelGenerationRouteDecision
}): MissingAssetBackfillPlan {
  if (params.decision.route !== 'asset_backfill' && params.decision.route !== 'human_required') {
    return {
      schemaVersion: 1,
      panelId: params.panelId,
      status: 'not_needed',
      requests: [],
    }
  }

  const requirements = params.bindingPlan.requirementPlan?.requirements || []
  const planned = requirements
    .filter((requirement) => requirementNeedsBackfill(requirement, params.decision))
    .map((requirement): MissingAssetBackfillRequest => ({
      name: requirement.name,
      kind: requirement.kind,
      ...(requirement.semanticType ? { semanticType: requirement.semanticType } : {}),
      summary: `${requirement.name}（分镜缺失资产回填）`,
      description: buildDescription({
        requirement,
        bindingPlan: params.bindingPlan,
      }),
      sourcePanelIds: [params.panelId],
      priority: 'blocking',
      autoGenerate: canAutoBackfillRequirement(requirement),
      reason: requirement.reason,
      assetId: requirement.assetId || null,
      status: canAutoBackfillRequirement(requirement) && isAutoBackfillKind(requirement.kind)
        ? 'planned'
        : 'human_required',
    }))

  if (planned.some((request) => request.status === 'human_required')) {
    return {
      schemaVersion: 1,
      panelId: params.panelId,
      status: 'human_required',
      requests: planned,
    }
  }

  return {
    schemaVersion: 1,
    panelId: params.panelId,
    status: planned.length > 0 ? 'queued' : 'not_needed',
    requests: planned,
  }
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function findExistingLocationBackedAsset(params: {
  projectDbId: string
  kind: 'location' | 'prop'
  assetId?: string | null
  name: string
}) {
  if (params.assetId) {
    const existing = await prisma.novelPromotionLocation.findFirst({
      where: {
        id: params.assetId,
        novelPromotionProjectId: params.projectDbId,
        assetKind: params.kind,
      },
      include: { images: { orderBy: { imageIndex: 'asc' } } },
    })
    if (existing) return existing
  }

  return await prisma.novelPromotionLocation.findFirst({
    where: {
      novelPromotionProjectId: params.projectDbId,
      assetKind: params.kind,
      name: params.name,
    },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
}

function hasUsableImage(asset: Awaited<ReturnType<typeof findExistingLocationBackedAsset>>): boolean {
  return !!asset?.images?.some((image) => typeof image.imageUrl === 'string' && image.imageUrl.trim())
}

async function findExistingCharacterAsset(params: {
  projectDbId: string
  assetId?: string | null
  name: string
}) {
  if (params.assetId) {
    const existing = await prisma.novelPromotionCharacter.findFirst({
      where: {
        id: params.assetId,
        novelPromotionProjectId: params.projectDbId,
      },
      include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
    })
    if (existing) return existing
  }

  return await prisma.novelPromotionCharacter.findFirst({
    where: {
      novelPromotionProjectId: params.projectDbId,
      name: params.name,
    },
    include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
  })
}

function characterAppearanceHasUsableImage(
  appearance: NonNullable<Awaited<ReturnType<typeof findExistingCharacterAsset>>>['appearances'][number],
): boolean {
  if (typeof appearance.imageUrl === 'string' && appearance.imageUrl.trim()) return true
  return decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
    .some((url) => typeof url === 'string' && url.trim().length > 0)
}

function hasUsableCharacterImage(asset: Awaited<ReturnType<typeof findExistingCharacterAsset>>): boolean {
  return !!asset?.appearances?.some(characterAppearanceHasUsableImage)
}

async function ensurePrimaryCharacterAppearance(params: {
  characterId: string
  description: string
}) {
  const existing = await prisma.characterAppearance.findFirst({
    where: {
      characterId: params.characterId,
      appearanceIndex: PRIMARY_APPEARANCE_INDEX,
    },
  })
  if (existing) return existing
  return await prisma.characterAppearance.create({
    data: {
      characterId: params.characterId,
      appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      changeReason: '初始形象',
      description: params.description,
      descriptions: JSON.stringify([params.description]),
      selectedIndex: null,
    },
  })
}

async function createProjectCharacterBackfillAsset(params: {
  projectDbId: string
  request: MissingAssetBackfillRequest
}) {
  const assetMeta = buildAssetMeta({
    assetKind: 'character',
    name: params.request.name,
    description: params.request.description,
    importance: 'supporting',
    explicitSemanticType: params.request.semanticType,
    explicitUsageScope: 'identity_lock',
  })
  const created = await prisma.novelPromotionCharacter.create({
    data: {
      novelPromotionProjectId: params.projectDbId,
      name: params.request.name,
      aliases: JSON.stringify([]),
      introduction: params.request.summary,
      profileData: JSON.stringify({
        source: 'missing_asset_backfill',
        summary: params.request.summary,
        description: params.request.description,
        sourcePanelIds: params.request.sourcePanelIds,
      }),
      semanticType: assetMeta.semanticType,
      assetTier: assetMeta.assetTier,
      usageScope: assetMeta.usageScope,
      assetMeta: asInputJson({
        ...assetMeta,
        source: 'missing_asset_backfill',
        sourcePanelIds: params.request.sourcePanelIds,
        reason: params.request.reason,
      }),
      profileConfirmed: false,
      appearances: {
        create: {
          appearanceIndex: PRIMARY_APPEARANCE_INDEX,
          changeReason: '初始形象',
          description: params.request.description,
          descriptions: JSON.stringify([params.request.description]),
          selectedIndex: null,
        },
      },
    },
    include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
  })
  return created
}

export function applyBackfillRequestsToRequirementPlan(
  requirementPlan: ShotAssetRequirementPlan | null | undefined,
  requests: MissingAssetBackfillRequest[],
): ShotAssetRequirementPlan | null {
  if (!requirementPlan) return null
  return {
    ...requirementPlan,
    requirements: requirementPlan.requirements.map((requirement) => {
      const request = requests.find((item) => requestMatchesRequirement(item, requirement))
      if (!request?.assetId) return requirement
      return {
        ...requirement,
        assetId: request.assetId,
      }
    }),
  }
}

export async function ensureMissingAssetBackfill(params: {
  projectId: string
  userId: string
  locale: Locale
  panelId: string
  bindingPlan: PanelAssetBindingPlan
  decision: PanelGenerationRouteDecision
}): Promise<MissingAssetBackfillPlan> {
  const plan = planMissingAssetBackfill({
    panelId: params.panelId,
    bindingPlan: params.bindingPlan,
    decision: params.decision,
  })
  const autoRequests = plan.requests.filter((request) => request.autoGenerate && isAutoBackfillKind(request.kind))
  if (autoRequests.length === 0) return plan

  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
    select: { id: true },
  })
  if (!project) return {
    ...plan,
    status: 'human_required',
    requests: plan.requests.map((request) => ({
      ...request,
      status: request.autoGenerate ? 'skipped' : request.status,
      reason: request.autoGenerate ? `${request.reason}; project not found` : request.reason,
    })),
  }

  const modelConfig = await getProjectModelConfig(params.projectId, params.userId)
  const nextRequests: MissingAssetBackfillRequest[] = []

  for (const request of plan.requests) {
    if (!request.autoGenerate || !isAutoBackfillKind(request.kind)) {
      nextRequests.push(request)
      continue
    }

    if (request.kind === 'character') {
      let asset = await findExistingCharacterAsset({
        projectDbId: project.id,
        assetId: request.assetId,
        name: request.name,
      })
      let status: MissingAssetBackfillStatus = hasUsableCharacterImage(asset)
        ? 'existing_asset_ready'
        : 'existing_asset_queued'

      if (!asset) {
        asset = await createProjectCharacterBackfillAsset({
          projectDbId: project.id,
          request,
        })
        status = 'created_asset_queued'
      }

      const appearance = asset.appearances[0] || await ensurePrimaryCharacterAppearance({
        characterId: asset.id,
        description: request.description,
      })

      let taskId: string | null = null
      if (!hasUsableCharacterImage(asset) && modelConfig.characterModel) {
        const payloadBase = {
          type: 'character',
          id: asset.id,
          appearanceId: appearance.id,
          count: 1,
          source: 'asset_backfill',
          sourcePanelIds: request.sourcePanelIds,
          backfillPanelId: params.panelId,
        }
        const billingPayload = await buildImageBillingPayload({
          projectId: params.projectId,
          userId: params.userId,
          imageModel: modelConfig.characterModel,
          basePayload: payloadBase,
        })
        const { submitTask } = await import('@/lib/task/submitter')
        const submitted = await submitTask({
          userId: params.userId,
          locale: params.locale,
          projectId: params.projectId,
          type: TASK_TYPE.IMAGE_CHARACTER,
          targetType: 'CharacterAppearance',
          targetId: appearance.id,
          payload: withTaskUiPayload(billingPayload, {
            intent: 'generate',
            hasOutputAtStart: false,
            source: 'asset_backfill',
          }),
          dedupeKey: `asset_backfill:${params.projectId}:character:${asset.id}:1`,
        })
        taskId = submitted.taskId || null
      }

      nextRequests.push({
        ...request,
        assetId: asset.id,
        taskId,
        status: hasUsableCharacterImage(asset)
          ? 'existing_asset_ready'
          : modelConfig.characterModel ? status : 'human_required',
        reason: modelConfig.characterModel
          ? request.reason
          : `${request.reason}; character model not configured`,
      })
      continue
    }

    let asset = await findExistingLocationBackedAsset({
      projectDbId: project.id,
      kind: request.kind,
      assetId: request.assetId,
      name: request.name,
    })
    let status: MissingAssetBackfillStatus = hasUsableImage(asset)
      ? 'existing_asset_ready'
      : 'existing_asset_queued'

    if (!asset) {
      const created = await createProjectLocationBackedAsset({
        novelPromotionProjectId: project.id,
        name: request.name,
        summary: request.summary,
        initialDescription: request.description,
        kind: request.kind,
      })
      await prisma.novelPromotionLocation.update({
        where: { id: created.id },
        data: {
          ...(request.semanticType ? { semanticType: request.semanticType } : {}),
          assetTier: 'supporting',
          usageScope: 'shot_backfill',
          assetMeta: asInputJson({
            source: 'missing_asset_backfill',
            sourcePanelIds: request.sourcePanelIds,
            reason: request.reason,
          }),
        },
      })
      asset = await findExistingLocationBackedAsset({
        projectDbId: project.id,
        kind: request.kind,
        assetId: created.id,
        name: request.name,
      })
      status = 'created_asset_queued'
    }

    if (!asset) {
      nextRequests.push({
        ...request,
        status: 'skipped',
      })
      continue
    }

    if (!hasUsableImage(asset) && (!asset.images || asset.images.length === 0)) {
      await ensureProjectLocationImageSlots({
        locationId: asset.id,
        count: 1,
        fallbackDescription: request.description,
      })
      asset = await findExistingLocationBackedAsset({
        projectDbId: project.id,
        kind: request.kind,
        assetId: asset.id,
        name: request.name,
      })
    }

    if (!asset) {
      nextRequests.push({
        ...request,
        status: 'skipped',
      })
      continue
    }

    const targetImageId = asset?.images?.[0]?.id || asset?.id || request.assetId

    let taskId: string | null = null
    if (!hasUsableImage(asset) && !modelConfig.locationModel) {
      nextRequests.push({
        ...request,
        assetId: asset.id,
        status: 'human_required',
        reason: `${request.reason}; location model not configured`,
      })
      continue
    }

    if (!hasUsableImage(asset) && targetImageId) {
      const payloadBase = {
        type: request.kind,
        id: asset.id,
        count: 1,
        source: 'asset_backfill',
        sourcePanelIds: request.sourcePanelIds,
        backfillPanelId: params.panelId,
      }
      const billingPayload = await buildImageBillingPayload({
        projectId: params.projectId,
        userId: params.userId,
        imageModel: modelConfig.locationModel,
        basePayload: payloadBase,
      })
      const { submitTask } = await import('@/lib/task/submitter')
      const submitted = await submitTask({
        userId: params.userId,
        locale: params.locale,
        projectId: params.projectId,
        type: TASK_TYPE.IMAGE_LOCATION,
        targetType: 'LocationImage',
        targetId: targetImageId,
        payload: withTaskUiPayload(billingPayload, {
          intent: 'generate',
          hasOutputAtStart: false,
          source: 'asset_backfill',
        }),
        dedupeKey: `asset_backfill:${params.projectId}:${request.kind}:${asset.id}:1`,
      })
      taskId = submitted.taskId || null
    }

    nextRequests.push({
      ...request,
      assetId: asset.id,
      taskId,
      status,
    })
  }

  const hasQueued = nextRequests.some((request) => request.status === 'existing_asset_queued' || request.status === 'created_asset_queued')
  const hasHuman = nextRequests.some((request) => request.status === 'human_required')
  return {
    ...plan,
    status: hasHuman ? 'human_required' : hasQueued ? 'queued' : 'ready',
    requests: nextRequests,
  }
}

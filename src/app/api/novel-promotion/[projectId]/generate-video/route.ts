import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { BillingOperationError } from '@/lib/billing/errors'
import { hasPanelVideoOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { parseModelKeyStrict, type CapabilityValue } from '@/lib/model-config-contract'
import {
  resolveBuiltinCapabilitiesByModelKey,
} from '@/lib/model-capabilities/lookup'
import { resolveBuiltinPricing } from '@/lib/model-pricing/lookup'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { evaluateVisualReadiness } from '@/lib/visual-readiness'
import { hasUnconfirmedVisualCandidates } from '@/lib/quality-workflow'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toVideoRuntimeSelections(value: unknown): Record<string, CapabilityValue> {
  if (!isRecord(value)) return {}
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (field === 'aspectRatio') continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      selections[field] = raw
    }
  }
  return selections
}

function resolveVideoGenerationMode(payload: unknown): 'normal' | 'firstlastframe' {
  if (!isRecord(payload)) return 'normal'
  if (payload.batchMode === 'firstlastframe') return 'firstlastframe'
  return isRecord(payload.firstLastFrame) ? 'firstlastframe' : 'normal'
}

function isSeedance2Model(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) return false
  return parsed.provider === 'ark'
    && (
      parsed.modelId === 'doubao-seedance-2-0-260128'
      || parsed.modelId === 'doubao-seedance-2-0-fast-260128'
    )
}

function resolveVideoModelKeyFromPayload(payload: Record<string, unknown>): string | null {
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && typeof firstLast.flModel === 'string' && parseModelKeyStrict(firstLast.flModel)) {
    return firstLast.flModel
  }
  if (typeof payload.videoModel === 'string' && parseModelKeyStrict(payload.videoModel)) {
    return payload.videoModel
  }
  return null
}

function requireVideoModelKeyFromPayload(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.videoModel !== 'string' || !parseModelKeyStrict(payload.videoModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_MODEL_REQUIRED',
      field: 'videoModel',
    })
  }
  return payload.videoModel
}

function validateFirstLastFrameModel(input: unknown) {
  if (input === undefined || input === null) return
  if (!isRecord(input)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_PAYLOAD_INVALID',
      field: 'firstLastFrame',
    })
  }

  const flModel = input.flModel
  if (typeof flModel !== 'string' || !parseModelKeyStrict(flModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_MODEL_INVALID',
      field: 'firstLastFrame.flModel',
    })
  }

  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', flModel)
  if (capabilities?.video?.firstlastframe !== true) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_MODEL_UNSUPPORTED',
      field: 'firstLastFrame.flModel',
    })
  }
}

async function validateVideoCapabilityCombination(input: {
  payload: unknown
  projectId: string
  userId: string
}) {
  const payload = input.payload
  if (!isRecord(payload)) return
  const modelKey = resolveVideoModelKeyFromPayload(payload)
  if (!modelKey) return

  // Skip validation for models not in the built-in capability catalog
  const builtinCaps = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  if (!builtinCaps) return

  const runtimeSelections = toVideoRuntimeSelections(payload.generationOptions)
  runtimeSelections.generationMode = resolveVideoGenerationMode(payload)

  let resolvedOptions: Record<string, CapabilityValue>
  try {
    resolvedOptions = await resolveProjectModelCapabilityGenerationOptions({
      projectId: input.projectId,
      userId: input.userId,
      modelType: 'video',
      modelKey,
      runtimeSelections,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
      field: 'generationOptions',
      details: {
        model: modelKey,
        selections: runtimeSelections,
        message,
      },
    })
  }

  const resolution = resolveBuiltinPricing({
    apiType: 'video',
    model: modelKey,
    selections: {
      ...resolvedOptions,
      ...(isSeedance2Model(modelKey) ? { containsVideoInput: false } : {}),
    },
  })
  if (resolution.status === 'missing_capability_match') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
      field: 'generationOptions',
      details: {
        model: modelKey,
        selections: resolvedOptions,
      },
    })
  }
}

function buildVideoPanelBillingInfoOrThrow(payload: unknown) {
  try {
    return buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, isRecord(payload) ? payload : null)
  } catch (error) {
    if (
      error instanceof BillingOperationError
      && (
        error.code === 'BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION'
        || error.code === 'BILLING_UNKNOWN_VIDEO_RESOLUTION'
      )
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
        field: 'generationOptions',
      })
    }
    // Model not in built-in pricing catalog — allow task to proceed;
    // actual billing will be resolved downstream where billing mode is checked.
    if (
      error instanceof BillingOperationError
      && error.code === 'BILLING_UNKNOWN_MODEL'
    ) {
      return null
    }
    throw error
  }
}

function assertVisualReady(panel: { id: string; candidateImages?: unknown; visualQualityState?: unknown }) {
  if (hasUnconfirmedVisualCandidates(panel.candidateImages, panel.visualQualityState)) {
    throw new ApiError('CONFLICT', {
      code: 'VISUAL_CANDIDATE_NOT_CONFIRMED',
      panelId: panel.id,
    })
  }
  const readiness = evaluateVisualReadiness(panel.visualQualityState)
  if (readiness.ready) return
  throw new ApiError('CONFLICT', {
    code: 'VISUAL_QUALITY_NOT_READY',
    panelId: panel.id,
    status: readiness.status,
    reasons: readiness.reasons,
  })
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  requireVideoModelKeyFromPayload(body)
  const locale = resolveRequiredTaskLocale(request, body)
  const isBatch = body?.all === true
  const batchMode: 'normal' | 'firstlastframe' = body?.batchMode === 'firstlastframe'
    ? 'firstlastframe'
    : 'normal'

  validateFirstLastFrameModel(
    isBatch && batchMode === 'firstlastframe'
      ? { flModel: body?.videoModel }
      : body?.firstLastFrame,
  )
  await validateVideoCapabilityCombination({
    payload: body,
    projectId,
    userId: session.user.id,
  })

  if (isBatch) {
    const episodeId = body?.episodeId
    if (!episodeId) {
      throw new ApiError('INVALID_PARAMS')
    }

    const episode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: episodeId,
        novelPromotionProject: { projectId },
      },
      select: { id: true },
    })
    if (!episode) throw new ApiError('NOT_FOUND')

    const storyboards = await prisma.novelPromotionStoryboard.findMany({
      where: { episodeId },
      select: {
        id: true,
        createdAt: true,
        clip: { select: { start: true, createdAt: true } },
        panels: {
          orderBy: { panelIndex: 'asc' },
          select: {
            id: true,
            storyboardId: true,
            panelIndex: true,
            imageUrl: true,
            videoUrl: true,
            lipSyncVideoUrl: true,
            candidateImages: true,
            visualQualityState: true,
            linkedToNextPanel: true,
            firstLastFramePrompt: true,
          },
        },
      },
    })
    storyboards.sort((left, right) => (
      (left.clip.start ?? Number.MAX_SAFE_INTEGER) - (right.clip.start ?? Number.MAX_SAFE_INTEGER)
      || left.clip.createdAt.getTime() - right.clip.createdAt.getTime()
      || left.createdAt.getTime() - right.createdAt.getTime()
    ))
    const panels = storyboards.flatMap((storyboard) => storyboard.panels)

    if (panels.length === 0) {
      return NextResponse.json({ tasks: [], total: 0, skipped: 0, reasonCounts: {} })
    }

    const reasonCounts: Record<string, number> = {}
    const skip = (reason: string) => {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
    }
    const basePayload = { ...body }
    delete basePayload.all
    delete basePayload.episodeId
    delete basePayload.batchMode
    const targets: Array<{ panelId: string; payload: Record<string, unknown> }> = []

    panels.forEach((panel, index) => {
      if (panel.videoUrl?.trim() || panel.lipSyncVideoUrl?.trim()) {
        skip('video_exists')
        return
      }
      if (!panel.imageUrl?.trim()) {
        skip('image_missing')
        return
      }
      if (
        hasUnconfirmedVisualCandidates(panel.candidateImages, panel.visualQualityState)
        || !evaluateVisualReadiness(panel.visualQualityState).ready
      ) {
        skip('quality_not_ready')
        return
      }
      if (batchMode === 'normal') {
        targets.push({
          panelId: panel.id,
          payload: {
            ...basePayload,
            storyboardId: panel.storyboardId,
            panelIndex: panel.panelIndex,
          },
        })
        return
      }

      const nextPanel = panels[index + 1]
      if (!nextPanel) {
        skip('last_panel')
        return
      }
      if (!panel.linkedToNextPanel) {
        skip('not_linked')
        return
      }
      if (!nextPanel.imageUrl?.trim()) {
        skip('last_image_missing')
        return
      }
      if (
        hasUnconfirmedVisualCandidates(nextPanel.candidateImages, nextPanel.visualQualityState)
        || !evaluateVisualReadiness(nextPanel.visualQualityState).ready
      ) {
        skip('last_quality_not_ready')
        return
      }
      targets.push({
        panelId: panel.id,
        payload: {
          ...basePayload,
          storyboardId: panel.storyboardId,
          panelIndex: panel.panelIndex,
          firstLastFrame: {
            lastFrameStoryboardId: nextPanel.storyboardId,
            lastFramePanelIndex: nextPanel.panelIndex,
            flModel: body.videoModel,
            ...(panel.firstLastFramePrompt?.trim()
              ? { customPrompt: panel.firstLastFramePrompt.trim() }
              : {}),
          },
        },
      })
    })

    const results = await Promise.all(
      targets.map(async (target) =>
        submitTask({
          userId: session.user.id,
          locale,
          requestId: getRequestId(request),
          projectId,
          episodeId,
          type: TASK_TYPE.VIDEO_PANEL,
          targetType: 'NovelPromotionPanel',
          targetId: target.panelId,
          payload: withTaskUiPayload(target.payload, {
            hasOutputAtStart: await hasPanelVideoOutput(target.panelId),
          }),
          dedupeKey: `video_panel:${target.panelId}`,
          billingInfo: buildVideoPanelBillingInfoOrThrow(target.payload),
        }),
      ),
    )

    return NextResponse.json({
      tasks: results,
      total: targets.length,
      skipped: panels.length - targets.length,
      reasonCounts,
      mode: batchMode,
    })
  }

  const storyboardId = body?.storyboardId
  const panelIndex = body?.panelIndex
  if (!storyboardId || panelIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: { storyboardId, panelIndex: Number(panelIndex) },
    select: { id: true, candidateImages: true, visualQualityState: true },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }
  assertVisualReady(panel)

  const firstLastFrame = isRecord(body?.firstLastFrame) ? body.firstLastFrame : null
  if (
    firstLastFrame
    && typeof firstLastFrame.lastFrameStoryboardId === 'string'
    && firstLastFrame.lastFramePanelIndex !== undefined
  ) {
    const lastFramePanel = await prisma.novelPromotionPanel.findFirst({
      where: {
        storyboardId: firstLastFrame.lastFrameStoryboardId,
        panelIndex: Number(firstLastFrame.lastFramePanelIndex),
      },
      select: { id: true, candidateImages: true, visualQualityState: true },
    })
    if (!lastFramePanel) throw new ApiError('NOT_FOUND')
    assertVisualReady(lastFramePanel)
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.VIDEO_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(body, {
      hasOutputAtStart: await hasPanelVideoOutput(panel.id),
    }),
    dedupeKey: `video_panel:${panel.id}`,
    billingInfo: buildVideoPanelBillingInfoOrThrow(body),
  })

  return NextResponse.json(result)
})

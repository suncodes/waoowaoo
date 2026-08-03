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
import {
  listEpisodePanelSpeeches,
  validatePanelSpeechReadyForVideo,
} from '@/lib/novel-promotion/panel-speech'
import { PreparedPromptError, requirePreparedPrompt } from '@/lib/creative-quality/prepared-prompts'

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
  if (isRecord(payload.generationOptions) && payload.generationOptions.generationMode === 'firstlastframe') {
    return 'firstlastframe'
  }
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

function readPanelSpeechProjection(value: unknown): {
  originalContent: string
  deliveryContent?: string | null
  status?: string | null
} | null {
  if (!isRecord(value)) return null
  const speech = value.panelSpeech
  if (!isRecord(speech) || typeof speech.originalContent !== 'string') return null
  return {
    originalContent: speech.originalContent,
    ...(typeof speech.deliveryContent === 'string' ? { deliveryContent: speech.deliveryContent } : {}),
    ...(typeof speech.status === 'string' ? { status: speech.status } : {}),
  }
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
  const requestedPreparedPromptArtifactId = typeof body?.preparedPromptArtifactId === 'string'
    ? body.preparedPromptArtifactId.trim()
    : ''
  const locale = resolveRequiredTaskLocale(request, body)
  const isBatch = body?.all === true
  const batchMode: 'normal' | 'firstlastframe' = body?.batchMode === 'firstlastframe'
    ? 'firstlastframe'
    : 'normal'

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
    const panelSpeechesState = await listEpisodePanelSpeeches(episodeId)
    if (!panelSpeechesState.available) {
      throw new ApiError('CONFLICT', {
        code: 'DB_SCHEMA_OUT_OF_DATE',
        message: '数据库结构不是最新版本，缺少镜头级可播台词表。请执行数据库迁移后重新部署。',
        table: 'novel_promotion_panel_speeches',
      })
    }

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
            description: true,
            imageUrl: true,
            videoUrl: true,
            videoPrompt: true,
            lipSyncVideoUrl: true,
            candidateImages: true,
            visualQualityState: true,
            linkedToNextPanel: true,
            firstLastFramePrompt: true,
            targetDurationMs: true,
            duration: true,
            panelSpeech: {
              select: {
                originalContent: true,
                deliveryContent: true,
                status: true,
              },
            },
            matchedVoiceLines: {
              select: { id: true },
            },
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
    const preparedPromptArtifactIds = isRecord(body?.preparedPromptArtifactIds)
      ? body.preparedPromptArtifactIds
      : {}
    const targets: Array<{ panelId: string; payload: Record<string, unknown> }> = []

    for (let index = 0; index < panels.length; index += 1) {
      const panel = panels[index]
      if (panel.videoUrl?.trim() || panel.lipSyncVideoUrl?.trim()) {
        skip('video_exists')
        continue
      }
      if (!panel.imageUrl?.trim()) {
        skip('image_missing')
        continue
      }
      if (
        hasUnconfirmedVisualCandidates(panel.candidateImages, panel.visualQualityState)
        || !evaluateVisualReadiness(panel.visualQualityState).ready
      ) {
        skip('quality_not_ready')
        continue
      }
      const panelSpeech = readPanelSpeechProjection(panel)
      if (panelSpeech && panelSpeech.status !== 'ready') {
        skip('speech_not_ready')
        continue
      }
      if (!panelSpeech && panel.matchedVoiceLines.length > 0) {
        skip('legacy_speech_rebuild_required')
        continue
      }

      if (batchMode === 'firstlastframe') {
        const nextPanel = panels[index + 1]
        if (!nextPanel) {
          skip('last_panel')
          continue
        }
        if (!panel.linkedToNextPanel) {
          skip('not_linked')
          continue
        }
        if (!nextPanel.imageUrl?.trim()) {
          skip('last_image_missing')
          continue
        }
        if (
          hasUnconfirmedVisualCandidates(nextPanel.candidateImages, nextPanel.visualQualityState)
          || !evaluateVisualReadiness(nextPanel.visualQualityState).ready
        ) {
          skip('last_quality_not_ready')
          continue
        }
      }

      const artifactId = typeof preparedPromptArtifactIds[panel.id] === 'string'
        ? preparedPromptArtifactIds[panel.id].trim()
        : ''
      if (!artifactId) {
        skip('prompt_not_prepared')
        continue
      }
      let preparedPrompt
      try {
        preparedPrompt = await requirePreparedPrompt({
          artifactId,
          projectId,
          targetId: panel.id,
          kind: 'panel_video',
          userId: session.user.id,
        })
      } catch (error) {
        if (error instanceof PreparedPromptError) {
          skip('prepared_prompt_invalid')
          continue
        }
        throw error
      }
      if (preparedPrompt.generationMode !== batchMode) {
        skip('prepared_mode_mismatch')
        continue
      }
      if (batchMode === 'firstlastframe' && preparedPrompt.snapshot.referenceImages.length < 2) {
        skip('prepared_reference_missing')
        continue
      }
      targets.push({
        panelId: panel.id,
        payload: {
          preparedPromptArtifactId: preparedPrompt.artifactId,
          storyboardId: panel.storyboardId,
          panelIndex: panel.panelIndex,
          videoModel: preparedPrompt.snapshot.modelKey,
          generationOptions: preparedPrompt.generationOptions,
        },
      })
    }

    await Promise.all(targets.map((target) => validateVideoCapabilityCombination({
      payload: target.payload,
      projectId,
      userId: session.user.id,
    })))

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
          dedupeKey: `video_panel:${target.panelId}:${String(target.payload.preparedPromptArtifactId)}`,
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
    select: {
      id: true,
      candidateImages: true,
      visualQualityState: true,
      targetDurationMs: true,
      duration: true,
    },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }
  let preparedPrompt
  try {
    preparedPrompt = await requirePreparedPrompt({
      artifactId: requestedPreparedPromptArtifactId,
      projectId,
      targetId: panel.id,
      kind: 'panel_video',
      userId: session.user.id,
    })
  } catch (error) {
    if (error instanceof PreparedPromptError) {
      throw new ApiError('CONFLICT', { code: error.code, message: error.message })
    }
    throw error
  }
  assertVisualReady(panel)
  const panelSpeechState = await validatePanelSpeechReadyForVideo(panel.id)
  if (!panelSpeechState.ready) {
    throw new ApiError('CONFLICT', {
      code: panelSpeechState.code,
      panelId: panel.id,
      reasons: panelSpeechState.reasons,
      table: panelSpeechState.available ? undefined : 'novel_promotion_panel_speeches',
    })
  }

  const taskPayload = {
    storyboardId,
    panelIndex: Number(panelIndex),
    preparedPromptArtifactId: preparedPrompt.artifactId,
    videoModel: preparedPrompt.snapshot.modelKey,
    generationOptions: preparedPrompt.generationOptions,
  }
  await validateVideoCapabilityCombination({
    payload: taskPayload,
    projectId,
    userId: session.user.id,
  })

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.VIDEO_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(taskPayload, {
      hasOutputAtStart: await hasPanelVideoOutput(panel.id),
    }),
    dedupeKey: `video_panel:${panel.id}:${preparedPrompt.artifactId}`,
    billingInfo: buildVideoPanelBillingInfoOrThrow(taskPayload),
  })

  return NextResponse.json(result)
})

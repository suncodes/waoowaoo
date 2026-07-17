import type { Prisma } from '@prisma/client'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { safeParseJsonObject } from '@/lib/json-repair'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { createArtifact } from '@/lib/run-runtime/service'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { resolveVideoProfile } from '@/lib/video-profile'
import {
  assertVisionInputSupported,
  createVisualVersionHash,
  decideVisualRepair,
  inspectVisualCandidates,
  parseImageQualityReviewResult,
} from '@/lib/visual-quality'
import { createVisualQualityState, parseVisualQualityState } from '@/lib/quality-workflow'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import { readTaskRunId, toJsonRecord } from './planning-task-shared'
import {
  buildPanelImageTargetSpec,
  mergeTechnicalChecks,
  readCandidateUrls,
} from './visual-quality-review-helpers'

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function handleVisualQualityReviewTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const panelId = typeof payload.panelId === 'string' && payload.panelId.trim()
    ? payload.panelId.trim()
    : job.data.targetId
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    include: {
      storyboard: {
        include: {
          episode: { select: { productionBible: true } },
        },
      },
    },
  })
  if (!panel) throw new Error('Panel not found')
  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId: job.data.projectId },
  })
  if (!novelData) throw new Error('Novel promotion data not found')

  const currentState = parseVisualQualityState(panel.visualQualityState)
  const payloadCandidates = Array.isArray(payload.candidateUrls)
    ? payload.candidateUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const candidateUrls = payloadCandidates.length > 0
    ? payloadCandidates
    : currentState?.candidateUrls.length ? currentState.candidateUrls : readCandidateUrls(panel.candidateImages)
  if (candidateUrls.length === 0 && panel.imageUrl) candidateUrls.push(panel.imageUrl)
  if (candidateUrls.length === 0) throw new Error('No visual candidate found')

  const profile = resolveVideoProfile(novelData.videoProfile)
  const mode = panel.linkedToNextPanel ? 'shadow' : (currentState?.mode || profile.qualityPolicy.mode)
  const targetSpec = buildPanelImageTargetSpec({
    panel,
    aspectRatio: novelData.videoRatio,
    artStyle: novelData.artStylePrompt || novelData.artStyle,
    productionBible: panel.storyboard.episode.productionBible,
  })
  const versionHash = createVisualVersionHash({ targetSpec, candidateUrls })
  if (currentState?.versionHash && currentState.versionHash !== versionHash && payload.versionHash) {
    throw new Error('VISUAL_VERSION_STALE')
  }
  const attempt = currentState?.attempt || 0
  const maxAttempts = currentState?.maxAttempts ?? profile.qualityPolicy.maxRepairAttempts
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      visualQualityState: asInputJson(createVisualQualityState({
        mode,
        status: 'reviewing',
        versionHash,
        candidateUrls,
        activeCandidateUrl: currentState?.activeCandidateUrl || panel.imageUrl,
        attempt,
        maxAttempts,
      })),
    },
  })

  await reportTaskProgress(job, 18, { stage: 'visual_quality_prepare', displayMode: 'detail' })
  await assertTaskActive(job, 'visual_quality_prepare')
  const checks = await inspectVisualCandidates(candidateUrls, targetSpec.aspectRatio)
  const model = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model ?? payload.analysisModel,
    projectAnalysisModel: novelData.analysisModel,
  })
  assertVisionInputSupported(model)
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_VISUAL_QUALITY_REVIEW,
    locale: job.data.locale,
    variables: {
      target_spec_json: JSON.stringify(targetSpec, null, 2),
      technical_checks_json: JSON.stringify(checks, null, 2),
      candidate_count: String(candidateUrls.length),
    },
  })
  const streamContext = createWorkerLLMStreamContext(job, 'visual_quality_review')
  const callbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  let rawReview: Record<string, unknown>
  try {
    const completion = await withInternalLLMStreamCallbacks(callbacks, async () => await executeAiVisionStep({
      userId: job.data.userId,
      model,
      prompt,
      imageUrls: candidateUrls,
      projectId: job.data.projectId,
      action: 'visual_quality_review',
      reasoning: true,
      meta: {
        stepId: 'visual_quality_review',
        stepTitle: 'progress.stage.visualQualityReview',
        stepIndex: 1,
        stepTotal: 1,
      },
    }))
    rawReview = safeParseJsonObject(completion.text)
  } finally {
    await callbacks.flush()
  }
  let review = parseImageQualityReviewResult(rawReview, versionHash)
  review = mergeTechnicalChecks(review, checks)
  const decision = decideVisualRepair({
    review,
    attempt,
    maxAttempts,
    autoApproveThreshold: profile.qualityPolicy.autoApproveThreshold,
    minConfidence: profile.qualityPolicy.minConfidence,
    editModelAvailable: Boolean(novelData.editModel),
  })

  await reportTaskProgress(job, 82, { stage: 'visual_quality_route', displayMode: 'detail' })
  await assertTaskActive(job, 'visual_quality_route')
  const selectedUrl = decision.candidateIndex === null ? null : candidateUrls[decision.candidateIndex] || null
  let nextStatus: 'shadow_completed' | 'approved' | 'repairing' | 'human_required'
  if (mode === 'shadow') nextStatus = 'shadow_completed'
  else if (decision.action === 'approve' || decision.action === 'select_candidate') nextStatus = 'approved'
  else if (decision.action === 'human_required') nextStatus = 'human_required'
  else nextStatus = 'repairing'
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      ...(nextStatus === 'approved' && selectedUrl ? {
        previousImageUrl: panel.imageUrl && panel.imageUrl !== selectedUrl ? panel.imageUrl : panel.previousImageUrl,
        imageUrl: selectedUrl,
      } : {}),
      visualQualityState: asInputJson(createVisualQualityState({
        mode,
        status: nextStatus,
        versionHash,
        candidateUrls,
        activeCandidateUrl: nextStatus === 'approved' ? selectedUrl : panel.imageUrl,
        attempt,
        maxAttempts,
        lastAction: decision.action,
        review,
      })),
    },
  })
  const runId = readTaskRunId(job)
  await createArtifact({
    runId,
    stepKey: 'visual_quality_review',
    artifactType: 'visual.quality.review',
    refId: panel.id,
    versionHash,
    payload: toJsonRecord({ targetSpec, checks, review, decision, mode, candidateUrls }),
  })

  if (nextStatus === 'repairing') {
    const imageModel = decision.action === 'edit' && novelData.editModel
      ? novelData.editModel
      : novelData.storyboardModel
    if (!imageModel) throw new Error('IMAGE_MODEL_NOT_CONFIGURED')
    await submitTask({
      userId: job.data.userId,
      locale: job.data.locale,
      projectId: job.data.projectId,
      episodeId: panel.storyboard.episodeId,
      type: TASK_TYPE.VISUAL_AUTO_REPAIR,
      targetType: 'NovelPromotionPanel',
      targetId: panel.id,
      payload: {
        panelId: panel.id,
        versionHash,
        action: decision.action,
        sourceCandidateUrl: selectedUrl,
        promptPatch: decision.promptPatch,
        targetSpec,
        attempt: attempt + 1,
        imageModel,
        candidateCount: 1,
      },
      dedupeKey: `visual_auto_repair:${panel.id}:${versionHash}:${attempt + 1}`,
    })
  }
  return { panelId: panel.id, mode, status: nextStatus, review, decision }
}

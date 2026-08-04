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
  completeLatestVisualAutoRepairLineage,
  normalizeVisualAutoRepairLineage,
} from '@/lib/creative-quality/contracts'
import {
  VISUAL_REPAIR_ASSET_CANDIDATE_LIMIT,
  VISUAL_REPAIR_PANEL_CANDIDATE_LIMIT,
  resolveVisualRepairCandidateCount,
} from '@/lib/visual-quality/repair-policy'
import {
  assertVisionInputSupported,
  createVisualVersionHash,
  decideVisualRepair,
  enforceVisualQualityHardGates,
  type ImageQualityReviewResult,
  type ImageTargetSpec,
  inspectVisualCandidates,
  parseImageQualityReviewResult,
} from '@/lib/visual-quality'
import {
  createVisualQualityState,
  flattenVisualCandidateGroups,
  parseVisualQualityState,
  resolveVisualCandidateGroups,
} from '@/lib/quality-workflow'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import { readTaskRunId, toJsonRecord } from './planning-task-shared'
import {
  buildCharacterAssetTargetSpec,
  buildLocationAssetTargetSpec,
  buildPanelImageTargetSpec,
  mergeTechnicalChecks,
  readCandidateUrls,
} from './visual-quality-review-helpers'

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readPayloadCandidateUrls(payload: Record<string, unknown>): string[] {
  return Array.isArray(payload.candidateUrls)
    ? payload.candidateUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

function hasUsableVisualCandidate(review: ImageQualityReviewResult): boolean {
  return review.candidates.some((candidate) => candidate.passed)
}

function chooseNextActiveCandidateUrl(params: {
  currentState: ReturnType<typeof parseVisualQualityState> | null
  review: ImageQualityReviewResult
  selectedUrl: string | null
  fallbackUrl: string | null
}): string | null {
  const currentScore = typeof params.currentState?.review?.score === 'number'
    ? params.currentState.review.score
    : null
  if (
    currentScore !== null
    && currentScore > params.review.score
    && params.currentState?.activeCandidateUrl
  ) {
    return params.currentState.activeCandidateUrl
  }
  return params.selectedUrl || params.fallbackUrl
}

async function resolveAssetReviewTarget(params: {
  job: Job<TaskJobData>
  payload: Record<string, unknown>
  artStyle: string
}): Promise<{
  targetSpec: ImageTargetSpec
  candidateUrls: string[]
  assetKind: 'character' | 'location' | 'prop'
}> {
  const payloadTargetSpec = asRecord(params.payload.targetSpec)
  const payloadCandidates = readPayloadCandidateUrls(params.payload)

  if (params.job.data.targetType === 'CharacterAppearance') {
    const appearanceId = typeof params.payload.appearanceId === 'string' && params.payload.appearanceId.trim()
      ? params.payload.appearanceId.trim()
      : params.job.data.targetId
    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: appearanceId },
      include: { character: true },
    })
    if (!appearance) throw new Error('Character appearance not found')
    const targetSpec = payloadTargetSpec.targetId
      ? payloadTargetSpec as unknown as ImageTargetSpec
      : buildCharacterAssetTargetSpec({
        appearance,
        artStyle: params.artStyle,
      })
    const fallbackCandidates = [
      ...readCandidateUrls(appearance.imageUrls),
      ...(appearance.imageUrl ? [appearance.imageUrl] : []),
    ]
    return {
      targetSpec,
      candidateUrls: payloadCandidates.length > 0 ? payloadCandidates : Array.from(new Set(fallbackCandidates.filter(Boolean))),
      assetKind: 'character',
    }
  }

  const locationImageId = typeof params.payload.locationImageId === 'string' && params.payload.locationImageId.trim()
    ? params.payload.locationImageId.trim()
    : params.job.data.targetId
  const image = await prisma.locationImage.findUnique({
    where: { id: locationImageId },
    include: { location: true },
  })
  if (!image) throw new Error('Location image not found')
  const targetSpec = payloadTargetSpec.targetId
    ? payloadTargetSpec as unknown as ImageTargetSpec
    : buildLocationAssetTargetSpec({
      image,
      artStyle: params.artStyle,
    })
  return {
    targetSpec,
    candidateUrls: payloadCandidates.length > 0 ? payloadCandidates : (image.imageUrl ? [image.imageUrl] : []),
    assetKind: image.location.assetKind === 'prop' ? 'prop' : 'location',
  }
}

async function handleAssetVisualQualityReviewTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId: job.data.projectId },
  })
  if (!novelData) throw new Error('Novel promotion data not found')

  const artStyle = novelData.artStylePrompt || novelData.artStyle || ''
  const { targetSpec, candidateUrls, assetKind } = await resolveAssetReviewTarget({
    job,
    payload,
    artStyle,
  })
  if (candidateUrls.length === 0) throw new Error('No visual asset candidate found')

  const profile = resolveVideoProfile(novelData.videoProfile)
  const mode = profile.qualityPolicy.mode
  const versionHash = createVisualVersionHash({ targetSpec, candidateUrls })
  if (payload.versionHash && typeof payload.versionHash === 'string' && payload.versionHash !== versionHash) {
    throw new Error('VISUAL_VERSION_STALE')
  }
  const attempt = readNumber(payload.attempt, 0)
  const maxAttempts = profile.qualityPolicy.maxRepairAttempts

  await reportTaskProgress(job, 18, {
    stage: 'visual_quality_prepare',
    displayMode: 'detail',
    attempt,
    maxAttempts,
  })
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
      action: 'visual_asset_quality_review',
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
  review = enforceVisualQualityHardGates(mergeTechnicalChecks(review, checks), targetSpec)
  const hasUsableCandidate = hasUsableVisualCandidate(review)
  const decision = decideVisualRepair({
    review,
    attempt,
    maxAttempts,
    autoApproveThreshold: profile.qualityPolicy.autoApproveThreshold,
    minConfidence: profile.qualityPolicy.minConfidence,
    editModelAvailable: Boolean(novelData.editModel),
    targetSpec,
  })
  const selectedUrl = decision.candidateIndex === null ? null : candidateUrls[decision.candidateIndex] || null
  const repairCandidateCount = resolveVisualRepairCandidateCount({
    currentCandidateCount: candidateUrls.length,
    maxCandidateCount: VISUAL_REPAIR_ASSET_CANDIDATE_LIMIT[assetKind],
  })
  const canRepair = mode === 'auto'
    && !hasUsableCandidate
    && repairCandidateCount > 0
    && decision.action !== 'approve'
    && decision.action !== 'select_candidate'
    && decision.action !== 'human_required'
  const incomingRepairLineage = normalizeVisualAutoRepairLineage(payload.repairLineage)
  const completedRepairLineage = completeLatestVisualAutoRepairLineage(
    incomingRepairLineage,
    {
      attempt,
      repairVersionHash: versionHash,
      scoreAfter: review.score,
      accepted: decision.action === 'approve' || decision.action === 'select_candidate',
      acceptedCandidateUrl: decision.action === 'approve' || decision.action === 'select_candidate' ? selectedUrl : null,
      stopReason: decision.action === 'approve' || decision.action === 'select_candidate'
        ? 'approved'
        : canRepair
          ? 'needs_next_repair'
          : decision.action === 'human_required'
            ? attempt >= maxAttempts ? 'max_attempts' : 'human_required'
            : 'human_required',
    },
  )

  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'visual_quality_review',
    artifactType: 'visual.asset.quality.review',
    refId: job.data.targetId,
    versionHash,
    payload: toJsonRecord({ targetSpec, checks, review, decision, mode, candidateUrls, assetKind, repairLineage: completedRepairLineage }),
  })

  if (canRepair) {
    const imageModel = decision.action === 'edit' && novelData.editModel
      ? novelData.editModel
      : assetKind === 'character' ? novelData.characterModel : novelData.locationModel
    if (!imageModel) throw new Error('IMAGE_MODEL_NOT_CONFIGURED')
    await submitTask({
      userId: job.data.userId,
      locale: job.data.locale,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId,
      type: TASK_TYPE.VISUAL_AUTO_REPAIR,
      targetType: job.data.targetType,
      targetId: job.data.targetId,
      payload: {
        assetKind,
        versionHash,
        action: decision.action,
        sourceCandidateUrl: selectedUrl,
        promptPatch: decision.promptPatch,
        targetSpec,
        attempt: attempt + 1,
        maxAttempts,
        imageModel,
        candidateCount: repairCandidateCount,
        scoreBefore: review.score,
        repairLineage: completedRepairLineage,
      },
      dedupeKey: `visual_auto_repair:${job.data.targetType}:${job.data.targetId}:${versionHash}:${attempt + 1}`,
    })
  }

  return {
    targetType: job.data.targetType,
    targetId: job.data.targetId,
    mode,
    status: canRepair
      ? 'repairing'
      : decision.action === 'human_required'
        || (hasUsableCandidate && decision.action !== 'approve' && decision.action !== 'select_candidate')
        ? 'human_required'
        : 'completed',
    review,
    decision,
  }
}

export async function handleVisualQualityReviewTask(job: Job<TaskJobData>) {
  if (job.data.targetType === 'CharacterAppearance' || job.data.targetType === 'LocationImage') {
    return handleAssetVisualQualityReviewTask(job)
  }

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
  if (currentState?.humanConfirmedAt) {
    return {
      panelId: panel.id,
      mode: currentState.mode,
      status: currentState.status,
      superseded: true,
    }
  }
  const payloadCandidates = Array.isArray(payload.candidateUrls)
    ? payload.candidateUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const candidateUrls = payloadCandidates.length > 0
    ? payloadCandidates
    : currentState?.candidateUrls.length ? currentState.candidateUrls : readCandidateUrls(panel.candidateImages)
  if (candidateUrls.length === 0 && panel.imageUrl) candidateUrls.push(panel.imageUrl)
  if (candidateUrls.length === 0) throw new Error('No visual candidate found')
  const candidateGroups = resolveVisualCandidateGroups({
    visualQualityState: currentState,
    candidateImages: panel.candidateImages || JSON.stringify(candidateUrls),
  })
  const retainedCandidateCount = flattenVisualCandidateGroups(candidateGroups).length

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
  const reviewingState = createVisualQualityState({
    mode,
    status: 'reviewing',
    versionHash,
    candidateUrls,
    candidateGroups,
    activeCandidateUrl: currentState?.activeCandidateUrl || panel.imageUrl,
    attempt,
    maxAttempts,
    repairLineage: currentState?.repairLineage,
  })
  let reviewingPanel: { updatedAt: Date }
  try {
    reviewingPanel = await prisma.novelPromotionPanel.update({
      where: panel.updatedAt
        ? { id: panel.id, updatedAt: panel.updatedAt }
        : { id: panel.id },
      data: {
        visualQualityState: asInputJson(reviewingState),
      },
      select: { updatedAt: true },
    })
  } catch {
    const latestPanel = await prisma.novelPromotionPanel.findUnique({
      where: { id: panel.id },
      select: { visualQualityState: true },
    })
    const latestState = parseVisualQualityState(latestPanel?.visualQualityState)
    if (latestState?.humanConfirmedAt) {
      return {
        panelId: panel.id,
        mode: latestState.mode,
        status: latestState.status,
        superseded: true,
      }
    }
    throw new Error('VISUAL_VERSION_STALE')
  }

  await reportTaskProgress(job, 18, {
    stage: 'visual_quality_prepare',
    displayMode: 'detail',
    attempt,
    maxAttempts,
  })
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
  review = enforceVisualQualityHardGates(mergeTechnicalChecks(review, checks), targetSpec)
  const hasUsableCandidate = hasUsableVisualCandidate(review)
  const decision = decideVisualRepair({
    review,
    attempt,
    maxAttempts,
    autoApproveThreshold: profile.qualityPolicy.autoApproveThreshold,
    minConfidence: profile.qualityPolicy.minConfidence,
    editModelAvailable: Boolean(novelData.editModel),
    targetSpec,
  })

  await reportTaskProgress(job, 82, {
    stage: 'visual_quality_route',
    displayMode: 'detail',
    attempt,
    maxAttempts,
  })
  await assertTaskActive(job, 'visual_quality_route')
  const selectedUrl = decision.candidateIndex === null ? null : candidateUrls[decision.candidateIndex] || null
  let nextStatus: 'shadow_completed' | 'approved' | 'repairing' | 'human_required'
  if (mode === 'shadow') nextStatus = 'shadow_completed'
  else if (decision.action === 'approve' || decision.action === 'select_candidate') nextStatus = 'approved'
  else if (decision.action === 'human_required' || hasUsableCandidate) nextStatus = 'human_required'
  else nextStatus = 'repairing'
  const repairCandidateCount = resolveVisualRepairCandidateCount({
    currentCandidateCount: retainedCandidateCount,
    maxCandidateCount: VISUAL_REPAIR_PANEL_CANDIDATE_LIMIT,
  })
  if (nextStatus === 'repairing' && repairCandidateCount === 0) {
    nextStatus = 'human_required'
  }
  const completedRepairLineage = completeLatestVisualAutoRepairLineage(
    currentState?.repairLineage?.length
      ? currentState.repairLineage
      : normalizeVisualAutoRepairLineage(payload.repairLineage),
    {
      attempt,
      repairVersionHash: versionHash,
      scoreAfter: review.score,
      accepted: nextStatus === 'approved',
      acceptedCandidateUrl: nextStatus === 'approved' ? selectedUrl : null,
      stopReason: nextStatus === 'approved'
        ? 'approved'
        : nextStatus === 'shadow_completed'
          ? 'shadow_completed'
          : nextStatus === 'repairing'
            ? 'needs_next_repair'
            : attempt >= maxAttempts ? 'max_attempts' : 'human_required',
    },
  )

  const nextQualityState = createVisualQualityState({
    mode,
    status: nextStatus,
    versionHash,
    candidateUrls,
    candidateGroups,
    activeCandidateUrl: chooseNextActiveCandidateUrl({
      currentState,
      review,
      selectedUrl,
      fallbackUrl: panel.imageUrl,
    }),
    attempt,
    maxAttempts,
    lastAction: decision.action,
    review,
    repairLineage: completedRepairLineage,
  })
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'visual_quality_review',
    artifactType: 'visual.quality.review',
    refId: panel.id,
    versionHash,
    payload: toJsonRecord({ targetSpec, checks, review, decision, mode, candidateUrls, repairLineage: completedRepairLineage }),
  })

  const finalWrite = await prisma.novelPromotionPanel.updateMany({
    where: {
      id: panel.id,
      updatedAt: reviewingPanel.updatedAt,
    },
    data: {
      visualQualityState: asInputJson(nextQualityState),
    },
  })

  if (finalWrite.count === 0) {
    const latestPanel = await prisma.novelPromotionPanel.findUnique({
      where: { id: panel.id },
      select: { visualQualityState: true },
    })
    const latestState = parseVisualQualityState(latestPanel?.visualQualityState)
    if (latestState?.humanConfirmedAt || latestState?.status === 'approved') {
      return {
        panelId: panel.id,
        mode: latestState.mode,
        status: 'approved' as const,
        review,
        decision,
        superseded: true,
      }
    }
    throw new Error('VISUAL_VERSION_STALE')
  }

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
        candidateCount: repairCandidateCount,
        scoreBefore: review.score,
        repairLineage: completedRepairLineage,
      },
      dedupeKey: `visual_auto_repair:${panel.id}:${versionHash}:${attempt + 1}`,
    })
  }
  return { panelId: panel.id, mode, status: nextStatus, review, decision }
}

import type { Prisma } from '@prisma/client'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { createArtifact } from '@/lib/run-runtime/service'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import {
  appendVisualCandidateGroup,
  createVisualCandidateGroup,
  createVisualQualityState,
  flattenVisualCandidateGroups,
  parseVisualQualityState,
  resolveVisualCandidateGroups,
} from '@/lib/quality-workflow'
import {
  VISUAL_REPAIR_CANDIDATE_COUNT,
  VISUAL_REPAIR_MAX_ATTEMPTS,
} from '@/lib/visual-quality/repair-policy'
import { createVisualVersionHash, type ImageTargetSpec, type PromptPatch } from '@/lib/visual-quality'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '@/lib/workers/utils'
import {
  collectPanelReferenceImages,
  resolveNovelData,
} from './image-task-handler-shared'
import { readTaskRunId, toJsonRecord } from './planning-task-shared'
import { readCandidateUrls } from './visual-quality-review-helpers'

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

async function persistAssetRepairCandidates(params: {
  targetType: string
  targetId: string
  candidateUrls: string[]
}): Promise<'character' | 'location' | 'prop'> {
  if (params.targetType === 'CharacterAppearance') {
    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: params.targetId },
    })
    if (!appearance) throw new Error('Character appearance not found')
    const nextImageUrls = uniqueStrings([
      ...readCandidateUrls(appearance.imageUrls),
      ...params.candidateUrls,
    ])
    await prisma.characterAppearance.update({
      where: { id: appearance.id },
      data: {
        imageUrls: encodeImageUrls(nextImageUrls),
        imageUrl: appearance.imageUrl || nextImageUrls[appearance.selectedIndex ?? -1] || nextImageUrls[0] || null,
      },
    })
    return 'character'
  }

  const image = await prisma.locationImage.findUnique({
    where: { id: params.targetId },
    include: { location: true },
  })
  if (!image) throw new Error('Location image not found')
  const siblings = await prisma.locationImage.findMany({
    where: { locationId: image.locationId },
    select: { imageIndex: true },
    orderBy: { imageIndex: 'desc' },
    take: 1,
  })
  const startIndex = (siblings[0]?.imageIndex ?? image.imageIndex) + 1
  for (let index = 0; index < params.candidateUrls.length; index += 1) {
    await prisma.locationImage.create({
      data: {
        locationId: image.locationId,
        imageIndex: startIndex + index,
        description: image.description,
        availableSlots: image.availableSlots,
        imageUrl: params.candidateUrls[index],
        isSelected: false,
      },
    })
  }
  return image.location.assetKind === 'prop' ? 'prop' : 'location'
}

async function handleAssetVisualAutoRepairTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const targetSpec = asRecord(payload.targetSpec) as unknown as ImageTargetSpec
  const promptPatch = asRecord(payload.promptPatch) as unknown as PromptPatch
  const action = payload.action === 'edit' ? 'edit' : 'regenerate'
  const sourceCandidateUrl = typeof payload.sourceCandidateUrl === 'string'
    ? payload.sourceCandidateUrl.trim()
    : ''
  const attempt = typeof payload.attempt === 'number' && Number.isFinite(payload.attempt)
    ? Math.max(1, Math.floor(payload.attempt))
    : 1
  const maxAttempts = typeof payload.maxAttempts === 'number' && Number.isFinite(payload.maxAttempts)
    ? Math.min(VISUAL_REPAIR_MAX_ATTEMPTS, Math.max(1, Math.floor(payload.maxAttempts)))
    : null
  const imageModel = typeof payload.imageModel === 'string' ? payload.imageModel.trim() : ''
  const candidateCount = typeof payload.candidateCount === 'number' && Number.isFinite(payload.candidateCount)
    ? Math.min(VISUAL_REPAIR_CANDIDATE_COUNT, Math.max(1, Math.floor(payload.candidateCount)))
    : VISUAL_REPAIR_CANDIDATE_COUNT
  if (!targetSpec.targetId || !imageModel) throw new Error('VISUAL_REPAIR_PAYLOAD_INVALID')

  const projectData = await resolveNovelData(job.data.projectId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_VISUAL_AUTO_REPAIR,
    locale: job.data.locale,
    variables: {
      base_prompt: targetSpec.intent,
      target_spec_json: JSON.stringify(targetSpec, null, 2),
      prompt_patch_json: JSON.stringify(promptPatch, null, 2),
    },
  })
  const referenceImages = action === 'edit' && sourceCandidateUrl ? [sourceCandidateUrl] : []
  const candidateUrls: string[] = []
  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    await reportTaskProgress(job, 20 + Math.floor((candidateIndex / candidateCount) * 58), {
      stage: 'visual_auto_repair_generate',
      displayMode: 'detail',
      attempt,
      maxAttempts,
      candidateIndex,
      candidateCount,
    })
    await assertTaskActive(job, 'visual_auto_repair_generate')
    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: imageModel,
      prompt,
      options: {
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        aspectRatio: targetSpec.aspectRatio || projectData.videoRatio || undefined,
      },
      allowTaskExternalIdResume: candidateCount === 1,
    })
    candidateUrls.push(await uploadImageSourceToCos(
      source,
      'visual-asset-repair-candidate',
      `${job.data.targetId}-${attempt}-${candidateIndex}`,
    ))
  }

  await reportTaskProgress(job, 84, {
    stage: 'visual_auto_repair_persist',
    displayMode: 'detail',
    attempt,
    maxAttempts,
  })
  await assertTaskActive(job, 'visual_auto_repair_persist')
  const assetKind = await persistAssetRepairCandidates({
    targetType: job.data.targetType,
    targetId: job.data.targetId,
    candidateUrls,
  })
  const versionHash = createVisualVersionHash({ targetSpec, candidateUrls })

  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'visual_auto_repair',
    artifactType: 'visual.asset.repair.candidate',
    refId: job.data.targetId,
    versionHash,
    payload: toJsonRecord({
      previousVersionHash: typeof payload.versionHash === 'string' ? payload.versionHash : null,
      candidateUrls,
      attempt,
      maxAttempts,
      action,
      sourceCandidateUrl,
      imageModel,
      promptPatch,
      assetKind,
    }),
  })

  if (!modelConfig.analysisModel) throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED')
  await submitTask({
    userId: job.data.userId,
    locale: job.data.locale,
    projectId: job.data.projectId,
    episodeId: job.data.episodeId,
    type: TASK_TYPE.VISUAL_QUALITY_REVIEW,
    targetType: job.data.targetType,
    targetId: job.data.targetId,
    payload: {
      assetKind,
      candidateUrls,
      versionHash,
      targetSpec,
      analysisModel: modelConfig.analysisModel,
      attempt,
      maxAttempts,
    },
    dedupeKey: `visual_quality_review:${job.data.targetType}:${job.data.targetId}:${versionHash}`,
  })
  return { targetType: job.data.targetType, targetId: job.data.targetId, candidateUrls, versionHash, attempt, maxAttempts }
}

export async function handleVisualAutoRepairTask(job: Job<TaskJobData>) {
  if (job.data.targetType === 'CharacterAppearance' || job.data.targetType === 'LocationImage') {
    return handleAssetVisualAutoRepairTask(job)
  }

  const payload = (job.data.payload || {}) as Record<string, unknown>
  const panelId = typeof payload.panelId === 'string' && payload.panelId.trim()
    ? payload.panelId.trim()
    : job.data.targetId
  const panel = await prisma.novelPromotionPanel.findUnique({ where: { id: panelId } })
  if (!panel) throw new Error('Panel not found')
  const state = parseVisualQualityState(panel.visualQualityState)
  if (state?.humanConfirmedAt) {
    return { panelId: panel.id, status: state.status, superseded: true }
  }
  if (!state || state.mode !== 'auto' || state.status !== 'repairing') {
    throw new Error('VISUAL_REPAIR_STATE_INVALID')
  }
  const expectedVersionHash = typeof payload.versionHash === 'string' ? payload.versionHash : ''
  if (!expectedVersionHash || state.versionHash !== expectedVersionHash) {
    throw new Error('VISUAL_VERSION_STALE')
  }
  const targetSpec = asRecord(payload.targetSpec) as unknown as ImageTargetSpec
  const promptPatch = asRecord(payload.promptPatch) as unknown as PromptPatch
  const action = payload.action === 'edit' ? 'edit' : 'regenerate'
  const sourceCandidateUrl = typeof payload.sourceCandidateUrl === 'string'
    ? payload.sourceCandidateUrl.trim()
    : ''
  const attempt = typeof payload.attempt === 'number' && Number.isFinite(payload.attempt)
    ? Math.max(1, Math.floor(payload.attempt))
    : state.attempt + 1
  const maxAttempts = state.maxAttempts
  const imageModel = typeof payload.imageModel === 'string' ? payload.imageModel.trim() : ''
  const candidateCount = typeof payload.candidateCount === 'number' && Number.isFinite(payload.candidateCount)
    ? Math.min(VISUAL_REPAIR_CANDIDATE_COUNT, Math.max(1, Math.floor(payload.candidateCount)))
    : VISUAL_REPAIR_CANDIDATE_COUNT
  if (!targetSpec.targetId || !imageModel) throw new Error('VISUAL_REPAIR_PAYLOAD_INVALID')

  const projectData = await resolveNovelData(job.data.projectId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const basePrompt = panel.imagePrompt || panel.description || targetSpec.intent
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_VISUAL_AUTO_REPAIR,
    locale: job.data.locale,
    variables: {
      base_prompt: basePrompt,
      target_spec_json: JSON.stringify(targetSpec, null, 2),
      prompt_patch_json: JSON.stringify(promptPatch, null, 2),
    },
  })
  const assetReferences = await collectPanelReferenceImages(projectData, panel)
  const referenceImages = action === 'edit' && sourceCandidateUrl
    ? [sourceCandidateUrl, ...assetReferences]
    : assetReferences

  const candidateUrls: string[] = []
  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    await reportTaskProgress(job, 20 + Math.floor((candidateIndex / candidateCount) * 58), {
      stage: 'visual_auto_repair_generate',
      displayMode: 'detail',
      attempt,
      maxAttempts,
      candidateIndex,
      candidateCount,
    })
    await assertTaskActive(job, 'visual_auto_repair_generate')
    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: imageModel,
      prompt,
      options: {
        referenceImages,
        aspectRatio: targetSpec.aspectRatio || projectData.videoRatio || undefined,
      },
      allowTaskExternalIdResume: candidateCount === 1,
    })
    candidateUrls.push(await uploadImageSourceToCos(
      source,
      'visual-repair-candidate',
      `${panel.id}-${attempt}-${candidateIndex}`,
    ))
  }
  const versionHash = createVisualVersionHash({ targetSpec, candidateUrls })
  const candidateGroups = appendVisualCandidateGroup(
    resolveVisualCandidateGroups({
      visualQualityState: state,
      candidateImages: panel.candidateImages,
    }),
    createVisualCandidateGroup({
      versionHash,
      origin: 'repair',
      attempt,
      candidateUrls,
      sourceCandidateUrl,
      action,
    }),
  )
  const retainedCandidateUrls = flattenVisualCandidateGroups(candidateGroups)

  await reportTaskProgress(job, 84, {
    stage: 'visual_auto_repair_persist',
    displayMode: 'detail',
    attempt,
    maxAttempts,
  })
  await assertTaskActive(job, 'visual_auto_repair_persist')
  try {
    await prisma.novelPromotionPanel.update({
      where: panel.updatedAt
        ? { id: panel.id, updatedAt: panel.updatedAt }
        : { id: panel.id },
      data: {
        candidateImages: JSON.stringify(retainedCandidateUrls),
        visualQualityState: asInputJson(createVisualQualityState({
          mode: 'auto',
          status: 'reviewing',
          versionHash,
          candidateUrls,
          candidateGroups,
          activeCandidateUrl: panel.imageUrl,
          attempt,
          maxAttempts: state.maxAttempts,
          lastAction: action,
        })),
      },
    })
  } catch {
    const latestPanel = await prisma.novelPromotionPanel.findUnique({
      where: { id: panel.id },
      select: { visualQualityState: true },
    })
    if (parseVisualQualityState(latestPanel?.visualQualityState)?.humanConfirmedAt) {
      return { panelId: panel.id, status: 'approved', superseded: true }
    }
    throw new Error('VISUAL_VERSION_STALE')
  }
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'visual_auto_repair',
    artifactType: 'visual.repair.candidate',
    refId: panel.id,
    versionHash,
    payload: toJsonRecord({
      previousVersionHash: expectedVersionHash,
      candidateUrls,
      retainedCandidateUrls,
      candidateGroups,
      attempt,
      action,
      sourceCandidateUrl,
      imageModel,
      promptPatch,
    }),
  })

  if (!modelConfig.analysisModel) throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED')
  await submitTask({
    userId: job.data.userId,
    locale: job.data.locale,
    projectId: job.data.projectId,
    episodeId: job.data.episodeId,
    type: TASK_TYPE.VISUAL_QUALITY_REVIEW,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: {
      panelId: panel.id,
      candidateUrls,
        versionHash,
        analysisModel: modelConfig.analysisModel,
        attempt,
        maxAttempts,
      },
    dedupeKey: `visual_quality_review:${panel.id}:${versionHash}`,
  })
  return { panelId: panel.id, candidateUrls, versionHash, attempt, maxAttempts }
}

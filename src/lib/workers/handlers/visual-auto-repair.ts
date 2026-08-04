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
import {
  createVisualAutoRepairLineage,
  normalizeVisualAutoRepairLineage,
} from '@/lib/creative-quality/contracts'
import { createVisualVersionHash, type ImageTargetSpec, type PromptPatch } from '@/lib/visual-quality'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '@/lib/workers/utils'
import {
  collectPanelVisualReferenceCandidates,
  resolveNovelData,
} from './image-task-handler-shared'
import { readTaskRunId, toJsonRecord } from './planning-task-shared'
import { readCandidateUrls } from './visual-quality-review-helpers'
import {
  bindingPlanPromptGuidance,
  resolvePanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'
import {
  resolvePanelVisualReferenceSelection,
  visualReferencesForPrompt,
  visualReferencesToImageUrls,
} from '@/lib/visual-production/references'

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

function promptPatchArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
    : []
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
  const runId = readTaskRunId(job)
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
  const scoreBefore = typeof payload.scoreBefore === 'number' && Number.isFinite(payload.scoreBefore)
    ? payload.scoreBefore
    : null
  const repairLineageRecord = createVisualAutoRepairLineage({
    targetType: assetKind,
    targetId: job.data.targetId,
    attempt,
    action,
    sourceCandidateUrl,
    candidateUrls,
    previousVersionHash: typeof payload.versionHash === 'string' ? payload.versionHash : null,
    repairVersionHash: versionHash,
    scoreBefore,
    promptPatch,
    imageModel,
  })
  const repairLineage = [
    ...normalizeVisualAutoRepairLineage(payload.repairLineage),
    repairLineageRecord,
  ]

  await createArtifact({
    runId,
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
      repairLineage,
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
      runId,
      assetKind,
      candidateUrls,
      versionHash,
      targetSpec,
      analysisModel: modelConfig.analysisModel,
      attempt,
      maxAttempts,
      repairLineage,
    },
    dedupeKey: `visual_quality_review:${job.data.targetType}:${job.data.targetId}:${versionHash}`,
  })
  return { targetType: job.data.targetType, targetId: job.data.targetId, candidateUrls, versionHash, attempt, maxAttempts }
}

export async function handleVisualAutoRepairTask(job: Job<TaskJobData>) {
  if (job.data.targetType === 'CharacterAppearance' || job.data.targetType === 'LocationImage') {
    return handleAssetVisualAutoRepairTask(job)
  }

  const runId = readTaskRunId(job)
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
  const bindingPlan = resolvePanelAssetBindingPlan(panel)
  const visualReferences = await collectPanelVisualReferenceCandidates(projectData, panel)
  const referenceInstructions = bindingPlanPromptGuidance(bindingPlan)
  const enhancedTargetSpec: ImageTargetSpec = {
    ...targetSpec,
    referenceInstructions,
    bindingPlan,
    continuityRules: Array.from(new Set([
      ...(targetSpec.continuityRules || []),
      ...referenceInstructions,
      `Binding complexity: ${bindingPlan.complexity.level}; recommended action: ${bindingPlan.complexity.recommendedAction}.`,
    ])),
  }
  const enhancedPromptPatch: PromptPatch = {
    preserve: Array.from(new Set([
      ...promptPatchArray(promptPatch.preserve),
      ...referenceInstructions,
    ])),
    add: promptPatchArray(promptPatch.add),
    remove: promptPatchArray(promptPatch.remove),
    negative: Array.from(new Set([
      ...promptPatchArray(promptPatch.negative),
      '不要修改绑定计划中的主主体和参考资产职责',
      ...(bindingPlan.complexity.level === 'high' ? ['复杂镜头只修复一个关键瞬间，不要添加分屏、多阶段动作或额外主体'] : []),
    ])),
    rationale: typeof promptPatch.rationale === 'string' ? promptPatch.rationale : '',
  }
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_VISUAL_AUTO_REPAIR,
    locale: job.data.locale,
    variables: {
      base_prompt: basePrompt,
      target_spec_json: JSON.stringify(enhancedTargetSpec, null, 2),
      prompt_patch_json: JSON.stringify(enhancedPromptPatch, null, 2),
    },
  })
  const repairReferenceSelection = resolvePanelVisualReferenceSelection({
    projectData: {},
    panel,
    options: {
      includeCharacterAssets: false,
      includeLocationAssets: false,
      includePropAssets: false,
      includeSourceAnchorAssets: false,
    },
    additionalReferences: action === 'edit' && sourceCandidateUrl
      ? [{
        assetId: null,
        renderId: null,
        assetKind: 'panel',
        assetName: job.data.locale === 'en' ? 'source candidate image' : '待修复候选图',
        url: sourceCandidateUrl,
        role: 'previous_frame',
        usage: 'adapt',
        weight: 1.1,
        source: 'previous_frame',
      }, ...visualReferences]
      : visualReferences,
  })
  const referenceImages = visualReferencesToImageUrls(repairReferenceSelection.selected)

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
        aspectRatio: enhancedTargetSpec.aspectRatio || projectData.videoRatio || undefined,
      },
      allowTaskExternalIdResume: candidateCount === 1,
    })
    candidateUrls.push(await uploadImageSourceToCos(
      source,
      'visual-repair-candidate',
      `${panel.id}-${attempt}-${candidateIndex}`,
    ))
  }
  const versionHash = createVisualVersionHash({ targetSpec: enhancedTargetSpec, candidateUrls })
  const repairLineageRecord = createVisualAutoRepairLineage({
    targetType: 'panel',
    targetId: panel.id,
    attempt,
    action,
    sourceCandidateUrl,
    candidateUrls,
    previousVersionHash: expectedVersionHash,
    repairVersionHash: versionHash,
    scoreBefore: state.review?.score ?? null,
    promptPatch: enhancedPromptPatch,
    imageModel,
  })
  const repairLineage = [
    ...(state.repairLineage || []),
    repairLineageRecord,
  ]
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
          repairLineage,
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
    runId,
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
      promptPatch: enhancedPromptPatch,
      bindingPlan,
      visualReferences: visualReferencesForPrompt(visualReferences),
      repairLineage: repairLineageRecord,
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
      runId,
      panelId: panel.id,
      candidateUrls,
      versionHash,
      analysisModel: modelConfig.analysisModel,
      attempt,
      maxAttempts,
      repairLineage,
      targetSpec: enhancedTargetSpec,
    },
    dedupeKey: `visual_quality_review:${panel.id}:${versionHash}`,
  })
  return { panelId: panel.id, candidateUrls, versionHash, attempt, maxAttempts }
}

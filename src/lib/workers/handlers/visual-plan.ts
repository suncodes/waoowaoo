import type { Job } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createArtifact } from '@/lib/run-runtime/service'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { isBookGuideProfile, resolveVideoProfile } from '@/lib/video-profile'
import {
  buildVisualBeatPlan,
  parseVisualPlanResult,
  type VisualAssetRef,
  type VisualPlanResult,
} from '@/lib/visual-planning'
import {
  autoRepairVisualPlanStoryboard,
  type StoryboardAutoRepairResult,
} from '@/lib/visual-planning/storyboard-auto-repair'
import { reviewVisualPlanStoryboard, type StoryboardReviewResult } from '@/lib/visual-planning/storyboard-review'
import { buildVisualShotSlotPlan } from '@/lib/visual-planning/storyboard-slot-plan'
import {
  auditVisualAssetCoverage,
  type AssetCoverageAuditAsset,
} from '@/lib/assets/asset-coverage-audit'
import {
  estimateNarrationDurationMs,
  rebuildEpisodeNarrationTimeline,
} from '@/lib/novel-promotion/narration-timeline'
import {
  buildFallbackShotAssetRequirementPlanResult,
  normalizeShotAssetRequirementPlanResult,
  type ShotAssetRequirementPlanResult,
} from '@/lib/visual-production/shot-asset-requirements'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { materializeGuideStoryboards, persistVisualPlan } from './visual-plan-persist'
import {
  bindVisualUnitsToAnchors,
  buildVisualAnchors,
} from '@/lib/creation-workspace/visual-anchors'
import {
  cloneWorkspaceValue,
  readContentArtifactMeta,
  readReusableApprovedVisualPlanState,
  readVisualArtifactMeta,
  stripWorkspaceArtifactMeta,
  withContentArtifactMeta,
  withVisualArtifactMeta,
} from '@/lib/creation-workspace/artifact-state'
import { isWorkspaceClipActive } from '@/lib/creation-workspace/guide-clips'
import {
  executePlanningJsonStep,
  PLANNING_JSON_PARSE_ERROR_CODE,
  readTaskRunId,
  toJsonRecord,
} from './planning-task-shared'

const MAX_VISUAL_PLAN_OUTPUT_ATTEMPTS = 3

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function narrationDurationSeconds(line: {
  content: string
  audioDuration: number | null
  estimatedDurationMs: number | null
} | undefined, fallback: number | null): number | null {
  if (!line) return fallback
  const durationMs = typeof line.audioDuration === 'number' && Number.isFinite(line.audioDuration) && line.audioDuration > 0
    ? line.audioDuration
    : typeof line.estimatedDurationMs === 'number' && Number.isFinite(line.estimatedDurationMs) && line.estimatedDurationMs > 0
      ? line.estimatedDurationMs
      : estimateNarrationDurationMs(line.content)
  return Math.max(1, Math.round((durationMs / 1000) * 10) / 10)
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function readBooleanFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function shouldBypassApprovedVisualPlanReuse(payload: Record<string, unknown>): boolean {
  return readBooleanFlag(payload.forceRegenerate)
    || readBooleanFlag(payload.force)
    || readBooleanFlag(payload.ignoreLock)
    || !!readText(payload.instruction)
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRepairableVisualPlanOutputError(error: unknown): boolean {
  if (error instanceof SyntaxError) return true
  const record = error && typeof error === 'object'
    ? error as { code?: unknown }
    : null
  return record?.code === PLANNING_JSON_PARSE_ERROR_CODE
    || readErrorMessage(error).startsWith('VISUAL_PLAN_INVALID:')
    || readErrorMessage(error).startsWith('VISUAL_PLAN_REVIEW_FAILED:')
}

function readInvalidCandidateOutput(
  candidate: Record<string, unknown> | null,
  error: unknown,
): string {
  if (candidate) return JSON.stringify(candidate, null, 2)
  if (error && typeof error === 'object') {
    const rawText = (error as { rawText?: unknown }).rawText
    if (typeof rawText === 'string' && rawText.trim()) return rawText.trim()
  }
  return '{}'
}

function asCandidateRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function isBlockingStoryboardReview(review: StoryboardReviewResult): boolean {
  return review.status === 'failed'
    || review.status === 'human_required'
    || review.criticalIssues.length > 0
}

function storyboardReviewFailureMessage(review: StoryboardReviewResult): string {
  return `VISUAL_PLAN_REVIEW_FAILED:${review.score}:${review.evidence.slice(0, 5).join(' | ')}`
}

async function generateValidatedVisualPlan(params: {
  job: Job<TaskJobData>
  model: string
  initialPrompt: string
  profile: ReturnType<typeof resolveVideoProfile>
  clipIds: string[]
  clipsJson: string
  assetsJson: string
  assets: VisualAssetRef[]
  visualBeatPlanJson: string
  visualShotSlotPlanJson: string
  targetId: string
}): Promise<{
  result: VisualPlanResult
  storyboardReview: StoryboardReviewResult
  storyboardAutoRepair: StoryboardAutoRepairResult | null
}> {
  let prompt = params.initialPrompt

  for (let attempt = 1; attempt <= MAX_VISUAL_PLAN_OUTPUT_ATTEMPTS; attempt += 1) {
    let candidate: Record<string, unknown> | null = null
    try {
      candidate = await executePlanningJsonStep({
        job: params.job,
        model: params.model,
        prompt,
        action: attempt === 1 ? 'visual_plan_generate' : 'visual_plan_repair',
        stepId: 'visual_plan_generate',
        stepTitle: 'progress.stage.visualPlanGenerate',
        stepIndex: 1,
        stepTotal: 1,
        stepAttempt: attempt,
        temperature: attempt === 1 ? 0.4 : 0.2,
      })
      const parsedResult = parseVisualPlanResult(candidate, params.profile, params.clipIds, params.assets)
      const autoRepair = autoRepairVisualPlanStoryboard(parsedResult)
      const result = autoRepair.result
      if (autoRepair.appliedFixes.length > 0) {
        candidate = asCandidateRecord(result)
      }
      const storyboardReview = reviewVisualPlanStoryboard({
        targetId: params.targetId,
        result,
        profile: params.profile,
      })
      if (isBlockingStoryboardReview(storyboardReview)) {
        throw new Error(storyboardReviewFailureMessage(storyboardReview))
      }
      return {
        result,
        storyboardReview,
        storyboardAutoRepair: autoRepair.appliedFixes.length > 0 ? autoRepair : null,
      }
    } catch (error) {
      if (!isRepairableVisualPlanOutputError(error) || attempt === MAX_VISUAL_PLAN_OUTPUT_ATTEMPTS) {
        throw error
      }
      await assertTaskActive(params.job, 'visual_plan_repair')
      prompt = buildPrompt({
        promptId: PROMPT_IDS.NP_VISUAL_PLAN_REPAIR,
        locale: params.job.data.locale,
        variables: {
          validation_error: readErrorMessage(error),
          candidate_output: readInvalidCandidateOutput(candidate, error),
          profile_json: JSON.stringify(params.profile, null, 2),
          clips_json: params.clipsJson,
          assets_json: params.assetsJson,
        },
      })
      prompt += `\n\n【VisualBeatPlan 约束】\n${params.visualBeatPlanJson}`
      prompt += `\n\n【VisualShotSlotPlan 硬约束】\n${params.visualShotSlotPlanJson}`
    }
  }

  throw new Error('VISUAL_PLAN_INVALID: no valid result after repair')
}

async function generateShotAssetRequirementPlan(params: {
  job: Job<TaskJobData>
  model: string
  profile: ReturnType<typeof resolveVideoProfile>
  result: VisualPlanResult
  assetsJson: string
  assets: VisualAssetRef[]
  visualBeatPlanJson: string
}): Promise<ShotAssetRequirementPlanResult> {
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_SHOT_ASSET_REQUIREMENTS,
    locale: params.job.data.locale,
    variables: {
      profile_json: JSON.stringify(params.profile, null, 2),
      visual_plan_json: JSON.stringify({
        shotPlan: params.result.shotPlan,
        visualUnits: params.result.visualUnits,
      }, null, 2),
      assets_json: params.assetsJson,
      visual_beat_plan_json: params.visualBeatPlanJson,
    },
  })

  try {
    const candidate = await executePlanningJsonStep({
      job: params.job,
      model: params.model,
      prompt,
      action: 'shot_asset_requirements',
      stepId: 'shot_asset_requirements',
      stepTitle: 'progress.stage.shotAssetRequirements',
      stepIndex: 1,
      stepTotal: 1,
      temperature: 0.2,
    })
    return normalizeShotAssetRequirementPlanResult(candidate, params.result.visualUnits, params.assets)
  } catch {
    return buildFallbackShotAssetRequirementPlanResult(params.result.visualUnits)
  }
}

async function materializeReusableApprovedVisualPlan(params: {
  episodeId: string
  result: VisualPlanResult
  narratorLabel: string
  shotAssetRequirementPlan?: ShotAssetRequirementPlanResult
}) {
  await prisma.$transaction(async (tx) => {
    await materializeGuideStoryboards(tx, {
      episodeId: params.episodeId,
      result: params.result,
      narratorLabel: params.narratorLabel,
      shotAssetRequirementPlan: params.shotAssetRequirementPlan,
    })
    const current = await tx.novelPromotionEpisode.findUnique({
      where: { id: params.episodeId },
      select: { contentPlan: true, productionBible: true },
    })
    if (!current?.productionBible) throw new Error('VISUAL_PLAN_REQUIRED')
    const now = new Date().toISOString()
    const visualMeta = readVisualArtifactMeta(current.productionBible)
    const contentMeta = readContentArtifactMeta(current.contentPlan)
    const productionBible = visualMeta
      ? withVisualArtifactMeta(current.productionBible, {
          ...cloneWorkspaceValue(visualMeta),
          updatedAt: now,
          downstream: {
            ...visualMeta.downstream,
            storyboard: false,
          },
        })
      : current.productionBible
    const contentPlan = contentMeta
      ? withContentArtifactMeta(current.contentPlan, {
          ...cloneWorkspaceValue(contentMeta),
          updatedAt: now,
          downstream: {
            ...contentMeta.downstream,
            storyboard: false,
          },
        })
      : current.contentPlan
    await tx.novelPromotionEpisode.update({
      where: { id: params.episodeId },
      data: {
        contentPlan: contentPlan ? asInputJson(contentPlan) : undefined,
        productionBible: asInputJson(productionBible),
      },
    })
  }, { timeout: 30000 })
}

export async function handleVisualPlanTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  if (!episodeId) throw new Error('episodeId is required')

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId: job.data.projectId },
    include: {
      characters: { select: { id: true, name: true, aliases: true, introduction: true, semanticType: true, assetTier: true, usageScope: true } },
      locations: { select: { id: true, name: true, summary: true, assetKind: true, semanticType: true, assetTier: true, usageScope: true } },
    },
  })
  if (!novelData) throw new Error('Novel promotion data not found')
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: { orderBy: { createdAt: 'asc' } },
      storyboards: { select: { id: true } },
      voiceLines: {
        orderBy: { lineIndex: 'asc' },
        select: {
          lineIndex: true,
          content: true,
          audioDuration: true,
          estimatedDurationMs: true,
        },
      },
    },
  })
  if (!episode || episode.novelPromotionProjectId !== novelData.id) throw new Error('Episode not found')
  if (!episode.creativeBrief || !episode.contentPlan) throw new Error('CONTENT_PLAN_REQUIRED')
  const activeClips = episode.clips.filter(isWorkspaceClipActive)
  if (activeClips.length === 0) throw new Error('No clips found')

  const profile = resolveVideoProfile(payload.videoProfile ?? novelData.videoProfile)
  const deferStoryboard = payload.deferStoryboard === true
  const resolveTaskModel = () => resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelData.analysisModel,
  })
  const voiceLineByIndex = new Map(episode.voiceLines.map((line) => [line.lineIndex, line]))
  const clips = activeClips.map((clip, index) => ({
    id: clip.id,
    summary: clip.summary,
    content: clip.content,
    screenplay: clip.screenplay,
    characters: clip.characters,
    location: clip.location,
    props: clip.props,
    duration: narrationDurationSeconds(voiceLineByIndex.get(index + 1), clip.duration),
  }))
  const assets = {
    characters: novelData.characters,
    locations: novelData.locations.filter((item) => item.assetKind !== 'prop'),
    props: novelData.locations.filter((item) => item.assetKind === 'prop'),
  }
  const visualAssets: VisualAssetRef[] = [
    ...novelData.characters.map((item) => ({ id: item.id, kind: 'character' as const, name: item.name })),
    ...novelData.locations.map((item) => ({
      id: item.id,
      kind: item.assetKind === 'prop' ? 'prop' as const : 'location' as const,
      name: item.name,
    })),
  ]
  const coverageAssets: AssetCoverageAuditAsset[] = [
    ...novelData.characters.map((item) => ({
      id: item.id,
      kind: 'character' as const,
      name: item.name,
      summary: item.introduction,
      semanticType: item.semanticType,
      assetTier: item.assetTier,
      usageScope: item.usageScope,
    })),
    ...novelData.locations.map((item) => ({
      id: item.id,
      kind: item.assetKind === 'prop' ? 'prop' as const : 'location' as const,
      name: item.name,
      summary: item.summary,
      semanticType: item.semanticType,
      assetTier: item.assetTier,
      usageScope: item.usageScope,
    })),
  ]
  const visualBeatPlan = buildVisualBeatPlan({
    profile,
    clips,
    assets: visualAssets,
  })
  const visualBeatPlanJson = JSON.stringify(visualBeatPlan, null, 2)
  const visualShotSlotPlan = buildVisualShotSlotPlan({
    profile,
    clips,
    beatPlan: visualBeatPlan,
  })
  const visualShotSlotPlanJson = JSON.stringify(visualShotSlotPlan, null, 2)
  const contentMeta = readContentArtifactMeta(episode.contentPlan)
  const requiredAssetIds = contentMeta?.assetRequirements.status === 'approved'
    ? contentMeta.assetRequirements.assetIds
    : []
  const availableAssetIds = new Set([
    ...novelData.characters.map((item) => item.id),
    ...novelData.locations.map((item) => item.id),
  ])
  const missingRequiredAssetIds = requiredAssetIds.filter((assetId) => !availableAssetIds.has(assetId))
  if (missingRequiredAssetIds.length > 0) {
    throw new Error(`VISUAL_ASSET_REQUIREMENTS_INVALID:${missingRequiredAssetIds.join(',')}`)
  }

  const reusableVisualPlanState = shouldBypassApprovedVisualPlanReuse(payload)
    ? null
    : readReusableApprovedVisualPlanState(episode.productionBible)
  if (reusableVisualPlanState && episode.directorTreatment && episode.productionBible) {
    const reusedResult = parseVisualPlanResult({
      directorTreatment: episode.directorTreatment,
      productionBible: stripWorkspaceArtifactMeta(episode.productionBible),
      shotPlan: reusableVisualPlanState.plan.shotPlan,
      visualUnits: reusableVisualPlanState.plan.visualUnits,
    }, profile, clips.map((clip) => clip.id), visualAssets)
    const storyboardReview = reviewVisualPlanStoryboard({
      targetId: episodeId,
      result: reusedResult,
      profile,
    })
    const shotAssetRequirementPlan = buildFallbackShotAssetRequirementPlanResult(reusedResult.visualUnits)
    const assetCoverageAudit = auditVisualAssetCoverage({
      targetId: episodeId,
      visualUnits: reusedResult.visualUnits,
      assets: coverageAssets,
      shotAssetRequirementPlan,
    })
    if (storyboardReview.status !== 'passed') {
      throw new Error(`VISUAL_PLAN_REUSE_INVALID:${storyboardReview.score}:${storyboardReview.evidence.slice(0, 5).join(' | ')}`)
    }
    const storyboardCount = Array.isArray(episode.storyboards) ? episode.storyboards.length : 0
    const shouldMaterializeStoryboard = isBookGuideProfile(profile)
      && !deferStoryboard
      && (storyboardCount === 0 || reusableVisualPlanState.downstream.storyboard)

    await reportTaskProgress(job, 90, { stage: 'visual_plan_reuse', displayMode: 'detail' })
    await assertTaskActive(job, 'visual_plan_reuse')
    if (shouldMaterializeStoryboard) {
      await materializeReusableApprovedVisualPlan({
        episodeId,
        result: reusedResult,
        narratorLabel: job.data.locale === 'en' ? 'Narrator' : '旁白',
        shotAssetRequirementPlan,
      })
      await rebuildEpisodeNarrationTimeline(episodeId)
    }
    await createArtifact({
      runId: readTaskRunId(job),
      stepKey: 'visual_plan_reuse',
      artifactType: 'visual.plan.reuse',
      refId: episodeId,
      payload: toJsonRecord({
        reason: 'approved_visual_plan_reused',
        profilePreset: profile.preset,
        revision: reusableVisualPlanState.revision,
        approvedRevision: reusableVisualPlanState.approvedRevision,
        approvedUpdatedAt: reusableVisualPlanState.updatedAt,
        visualUnitCount: reusedResult.visualUnits.length,
        anchorCount: reusableVisualPlanState.anchorCount,
        storyboardReviewScore: storyboardReview.score,
        storyboardReviewStatus: storyboardReview.status,
        storyboardMaterialized: shouldMaterializeStoryboard,
      }),
    })
    await createArtifact({
      runId: readTaskRunId(job),
      stepKey: 'asset_coverage_audit',
      artifactType: 'asset.coverage.audit',
      refId: episodeId,
      payload: toJsonRecord(assetCoverageAudit),
    })
    await createArtifact({
      runId: readTaskRunId(job),
      stepKey: 'shot_asset_requirements',
      artifactType: 'visual.shot_asset_requirements',
      refId: episodeId,
      payload: toJsonRecord(shotAssetRequirementPlan),
    })
    return {
      episodeId,
      profilePreset: profile.preset,
      visualUnitCount: reusedResult.visualUnits.length,
      reused: true,
      reuseReason: 'approved_visual_plan_reused',
      visualPlanRevision: reusableVisualPlanState.revision,
      approvedRevision: reusableVisualPlanState.approvedRevision,
      storyboardReviewScore: storyboardReview.score,
      storyboardReviewStatus: storyboardReview.status,
      assetCoverageStatus: assetCoverageAudit.status,
      shotAssetRequirementPlanSource: 'fallback',
      storyboardPersisted: isBookGuideProfile(profile) && !deferStoryboard,
      storyboardMaterialized: shouldMaterializeStoryboard,
    }
  }

  const model = await resolveTaskModel()
  await reportTaskProgress(job, 18, { stage: 'visual_plan_prepare', displayMode: 'detail' })
  await assertTaskActive(job, 'visual_plan_prepare')
  const clipsJson = JSON.stringify(clips, null, 2)
  const assetsJson = JSON.stringify(assets, null, 2)
  const initialPrompt = buildPrompt({
    promptId: PROMPT_IDS.NP_VISUAL_PLAN,
    locale: job.data.locale,
    variables: {
      profile_json: JSON.stringify(profile, null, 2),
      creative_brief_json: JSON.stringify(episode.creativeBrief, null, 2),
      content_plan_json: JSON.stringify(stripWorkspaceArtifactMeta(episode.contentPlan), null, 2),
      clips_json: clipsJson,
      assets_json: assetsJson,
      video_ratio: novelData.videoRatio,
      art_style: novelData.artStylePrompt || novelData.artStyle,
    },
  })
  const rewriteInstruction = readText(payload.instruction)
  const visualBeatPlanInstruction = `${job.data.locale === 'en' ? 'VisualBeatPlan constraints' : 'VisualBeatPlan 约束'}：\n${visualBeatPlanJson}\n\n${job.data.locale === 'en'
    ? 'Use this beat plan as the directing layer. Each visualUnit must map to a beat, preserve visualLicense, screenEvent, actionMoment, continuity and assetNeeds, and avoid static PPT-like illustrations.'
    : '必须把以上节拍计划作为导演前置层。每个 visualUnit 都要对应某个 beat，并继承 visualLicense、screenEvent、actionMoment、continuity 和 assetNeeds，避免静态 PPT 式说明图。'}`
  const visualShotSlotPlanInstruction = `${job.data.locale === 'en' ? 'VisualShotSlotPlan hard constraints' : 'VisualShotSlotPlan 硬约束'}：\n${visualShotSlotPlanJson}\n\n${job.data.locale === 'en'
    ? 'Treat this as the shot-planning agent output. Fill every slot with one visualUnit, do not merge slots, and keep generated_image within the slot max duration.'
    : '必须把以上槽位计划视为镜头规划 Agent 的硬输出。每个 slot 填成一个 visualUnit，不得合并 slot；generated_image 必须服从槽位的最长时长和单一关键瞬间限制。'}`
  const planningPromptBase = `${initialPrompt}\n\n${visualBeatPlanInstruction}\n\n${visualShotSlotPlanInstruction}`
  const planningPrompt = rewriteInstruction
    ? `${planningPromptBase}\n\n${job.data.locale === 'en' ? 'Rewrite instruction' : '本次重写要求'}：${rewriteInstruction}`
    : planningPromptBase
  const {
    result: parsedResult,
    storyboardReview: initialStoryboardReview,
    storyboardAutoRepair,
  } = await generateValidatedVisualPlan({
    job,
    model,
    initialPrompt: planningPrompt,
    profile,
    clipIds: clips.map((clip) => clip.id),
    clipsJson,
    assetsJson,
    assets: visualAssets,
    visualBeatPlanJson,
    visualShotSlotPlanJson,
    targetId: episodeId,
  })
  const explicitlyReferencedAssetIds = parsedResult.visualUnits.flatMap(
    (unit) => unit.assetRefs?.map((asset) => asset.id) || [],
  )
  const anchors = buildVisualAnchors({
    contentPlan: episode.contentPlan,
    clips,
    characters: novelData.characters,
    locations: novelData.locations,
    includeAssetIds: [...requiredAssetIds, ...explicitlyReferencedAssetIds],
  })
  const anchorAssetIds = new Set(anchors.map((anchor) => anchor.assetId))
  const missingAnchorIds = requiredAssetIds.filter((assetId) => !anchorAssetIds.has(assetId))
  if (missingAnchorIds.length > 0) {
    throw new Error(`VISUAL_ANCHOR_BUILD_FAILED:${missingAnchorIds.join(',')}`)
  }
  const result = {
    ...parsedResult,
    visualUnits: bindVisualUnitsToAnchors(parsedResult.visualUnits, anchors),
  }
  const storyboardReview = reviewVisualPlanStoryboard({
    targetId: episodeId,
    result,
    profile,
    reviewedAt: initialStoryboardReview.reviewedAt,
  })
  await reportTaskProgress(job, 80, { stage: 'shot_asset_requirements', displayMode: 'detail' })
  await assertTaskActive(job, 'shot_asset_requirements')
  const shotAssetRequirementPlan = await generateShotAssetRequirementPlan({
    job,
    model,
    profile,
    result,
    assetsJson,
    assets: visualAssets,
    visualBeatPlanJson,
  })
  const assetCoverageAudit = auditVisualAssetCoverage({
    targetId: episodeId,
    visualUnits: result.visualUnits,
    assets: coverageAssets,
    shotAssetRequirementPlan,
  })
  if (assetCoverageAudit.relationSuggestions.length > 0) {
    await prisma.novelPromotionAssetRelation.createMany({
      data: assetCoverageAudit.relationSuggestions.map((relation) => ({
        projectId: novelData.id,
        ...relation,
      })),
      skipDuplicates: true,
    })
  }
  await reportTaskProgress(job, 82, { stage: 'visual_plan_persist', displayMode: 'detail' })
  await assertTaskActive(job, 'visual_plan_persist')
  await persistVisualPlan({
    episodeId,
    result,
    isBookGuide: isBookGuideProfile(profile),
    narratorLabel: job.data.locale === 'en' ? 'Narrator' : '旁白',
    anchors,
    deferStoryboard,
    storyboardReview,
    visualBeatPlan,
    assetCoverageAudit,
    shotAssetRequirementPlan,
  })
  await rebuildEpisodeNarrationTimeline(episodeId)
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'visual_beat_plan',
    artifactType: 'visual.beat.plan',
    refId: episodeId,
    payload: toJsonRecord(visualBeatPlan),
  })
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'visual_shot_slot_plan',
    artifactType: 'visual.shot_slot.plan',
    refId: episodeId,
    payload: toJsonRecord(visualShotSlotPlan),
  })
  if (storyboardAutoRepair) {
    await createArtifact({
      runId: readTaskRunId(job),
      stepKey: 'storyboard_auto_repair',
      artifactType: 'storyboard.auto_repair',
      refId: episodeId,
      payload: toJsonRecord({
        appliedFixes: storyboardAutoRepair.appliedFixes,
        visualUnitCount: storyboardAutoRepair.result.visualUnits.length,
      }),
    })
  }
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'asset_coverage_audit',
    artifactType: 'asset.coverage.audit',
    refId: episodeId,
    payload: toJsonRecord(assetCoverageAudit),
  })
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'shot_asset_requirements',
    artifactType: 'visual.shot_asset_requirements',
    refId: episodeId,
    payload: toJsonRecord(shotAssetRequirementPlan),
  })
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'storyboard_review',
    artifactType: 'storyboard.quality.review',
    refId: episodeId,
    payload: toJsonRecord({ profile, review: storyboardReview, storyboardAutoRepair: storyboardAutoRepair?.appliedFixes || [] }),
  })
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'visual_plan',
    artifactType: 'visual.plan',
    refId: episodeId,
    payload: toJsonRecord({
      profile,
      visualBeatPlan,
      visualShotSlotPlan,
      storyboardReview,
      storyboardAutoRepair: storyboardAutoRepair?.appliedFixes || [],
      assetCoverageAudit,
      shotAssetRequirementPlan,
      ...result,
    }),
  })

  return {
    episodeId,
    profilePreset: profile.preset,
    visualUnitCount: result.visualUnits.length,
    storyboardReviewScore: storyboardReview.score,
    storyboardReviewStatus: storyboardReview.status,
    storyboardAutoRepairApplied: !!storyboardAutoRepair,
    assetCoverageStatus: assetCoverageAudit.status,
    shotAssetRequirementPlanSource: shotAssetRequirementPlan.plans.some((plan) => plan.source === 'llm') ? 'llm' : 'fallback',
    storyboardPersisted: isBookGuideProfile(profile) && !deferStoryboard,
  }
}

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { createArtifact } from '@/lib/run-runtime/service'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { isBookGuideProfile, resolveVideoProfile } from '@/lib/video-profile'
import { parseVisualPlanResult, type VisualAssetRef, type VisualPlanResult } from '@/lib/visual-planning'
import { reviewVisualPlanStoryboard, type StoryboardReviewResult } from '@/lib/visual-planning/storyboard-review'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { persistVisualPlan } from './visual-plan-persist'
import {
  bindVisualUnitsToAnchors,
  buildVisualAnchors,
} from '@/lib/creation-workspace/visual-anchors'
import {
  readContentArtifactMeta,
  stripWorkspaceArtifactMeta,
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

async function generateValidatedVisualPlan(params: {
  job: Job<TaskJobData>
  model: string
  initialPrompt: string
  profile: ReturnType<typeof resolveVideoProfile>
  clipIds: string[]
  clipsJson: string
  assetsJson: string
  assets: VisualAssetRef[]
  targetId: string
}): Promise<{ result: VisualPlanResult; storyboardReview: StoryboardReviewResult }> {
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
      const result = parseVisualPlanResult(candidate, params.profile, params.clipIds, params.assets)
      const storyboardReview = reviewVisualPlanStoryboard({
        targetId: params.targetId,
        result,
        profile: params.profile,
      })
      if (storyboardReview.status !== 'passed') {
        throw new Error(`VISUAL_PLAN_REVIEW_FAILED:${storyboardReview.score}:${storyboardReview.evidence.slice(0, 5).join(' | ')}`)
      }
      return { result, storyboardReview }
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
    }
  }

  throw new Error('VISUAL_PLAN_INVALID: no valid result after repair')
}

export async function handleVisualPlanTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  if (!episodeId) throw new Error('episodeId is required')

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId: job.data.projectId },
    include: {
      characters: { select: { id: true, name: true, introduction: true } },
      locations: { select: { id: true, name: true, summary: true, assetKind: true } },
    },
  })
  if (!novelData) throw new Error('Novel promotion data not found')
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: { clips: { orderBy: { createdAt: 'asc' } } },
  })
  if (!episode || episode.novelPromotionProjectId !== novelData.id) throw new Error('Episode not found')
  if (!episode.creativeBrief || !episode.contentPlan) throw new Error('CONTENT_PLAN_REQUIRED')
  const activeClips = episode.clips.filter(isWorkspaceClipActive)
  if (activeClips.length === 0) throw new Error('No clips found')

  const profile = resolveVideoProfile(payload.videoProfile ?? novelData.videoProfile)
  const model = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelData.analysisModel,
  })
  const clips = activeClips.map((clip) => ({
    id: clip.id,
    summary: clip.summary,
    content: clip.content,
    screenplay: clip.screenplay,
    characters: clip.characters,
    location: clip.location,
    props: clip.props,
    duration: clip.duration,
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
  const planningPrompt = rewriteInstruction
    ? `${initialPrompt}\n\n${job.data.locale === 'en' ? 'Rewrite instruction' : '本次重写要求'}：${rewriteInstruction}`
    : initialPrompt
  const { result: parsedResult, storyboardReview: initialStoryboardReview } = await generateValidatedVisualPlan({
    job,
    model,
    initialPrompt: planningPrompt,
    profile,
    clipIds: clips.map((clip) => clip.id),
    clipsJson,
    assetsJson,
    assets: visualAssets,
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
  const deferStoryboard = payload.deferStoryboard === true

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
  })
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'storyboard_review',
    artifactType: 'storyboard.quality.review',
    refId: episodeId,
    payload: toJsonRecord({ profile, review: storyboardReview }),
  })
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'visual_plan',
    artifactType: 'visual.plan',
    refId: episodeId,
    payload: toJsonRecord({ profile, storyboardReview, ...result }),
  })

  return {
    episodeId,
    profilePreset: profile.preset,
    visualUnitCount: result.visualUnits.length,
    storyboardReviewScore: storyboardReview.score,
    storyboardReviewStatus: storyboardReview.status,
    storyboardPersisted: isBookGuideProfile(profile) && !deferStoryboard,
  }
}

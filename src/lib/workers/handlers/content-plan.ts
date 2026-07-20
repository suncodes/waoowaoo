import type { Job } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  parseContentPlan,
  parseContentPlanResult,
  parseContentReview,
  type GuideContentPlan,
} from '@/lib/content-planning'
import { createArtifact } from '@/lib/run-runtime/service'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveVideoProfile } from '@/lib/video-profile'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { persistContentPlan } from './content-plan-helpers'
import { storeContentUnitCandidate } from '@/lib/creation-workspace/content-artifacts'
import { cloneWorkspaceValue, asWorkspaceRecord } from '@/lib/creation-workspace/artifact-state'
import {
  executePlanningJsonStep,
  readTaskRunId,
  toJsonRecord,
} from './planning-task-shared'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRewriteInstruction(value: unknown, locale: TaskJobData['locale']) {
  return readText(value) || (locale === 'en'
    ? 'Improve clarity, pacing, spoken naturalness, and visual executability.'
    : '提升表达清晰度、节奏、口语自然度和画面可执行性。')
}

function buildGuideCandidate(params: {
  plan: GuideContentPlan
  unitId: string
  payload: unknown
  profile: ReturnType<typeof resolveVideoProfile>
}) {
  const wrapper = asWorkspaceRecord(params.payload)
  const rawSegment = asWorkspaceRecord(wrapper?.segment)
  const currentIndex = params.plan.segments.findIndex((segment) => segment.id === params.unitId)
  if (currentIndex < 0 || !rawSegment) throw new Error('CONTENT_UNIT_REWRITE_INVALID')
  const candidatePlan = cloneWorkspaceValue(params.plan)
  candidatePlan.segments[currentIndex] = {
    ...candidatePlan.segments[currentIndex],
    ...cloneWorkspaceValue(rawSegment),
    id: params.unitId,
    outlineId: candidatePlan.segments[currentIndex].outlineId,
  } as GuideContentPlan['segments'][number]
  const validated = parseContentPlan(candidatePlan, params.profile)
  if (validated.planType !== 'guide') throw new Error('CONTENT_UNIT_REWRITE_INVALID')
  return {
    candidate: validated.segments[currentIndex],
    candidatePlan: validated,
  }
}

function buildScriptCandidate(payload: unknown, current: {
  id: string
  summary: string
  content: string
  screenplay: string | null
}) {
  const wrapper = asWorkspaceRecord(payload)
  const rawClip = asWorkspaceRecord(wrapper?.clip)
  if (!rawClip) throw new Error('CONTENT_UNIT_REWRITE_INVALID')
  const screenplay = rawClip.screenplay && typeof rawClip.screenplay === 'object'
    ? JSON.stringify(rawClip.screenplay)
    : typeof rawClip.screenplay === 'string'
      ? rawClip.screenplay
      : current.screenplay
  if (screenplay) {
    const parsed = JSON.parse(screenplay) as { scenes?: unknown }
    if (!Array.isArray(parsed.scenes)) throw new Error('CONTENT_UNIT_REWRITE_INVALID')
  }
  return {
    id: current.id,
    summary: readText(rawClip.summary) || current.summary,
    content: readText(rawClip.content) || current.content,
    screenplay,
  }
}

export async function handleContentPlanTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  if (!episodeId) throw new Error('episodeId is required')

  const [novelData, episode] = await Promise.all([
    prisma.novelPromotionProject.findUnique({ where: { projectId: job.data.projectId } }),
    prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: { clips: { orderBy: [{ start: 'asc' }, { createdAt: 'asc' }] } },
    }),
  ])
  if (!novelData) throw new Error('Novel promotion data not found')
  if (!episode || episode.novelPromotionProjectId !== novelData.id) throw new Error('Episode not found')

  const sourceText = readText(payload.content) || readText(episode.novelText)
  if (!sourceText) throw new Error('content is required')
  const profile = resolveVideoProfile(payload.videoProfile ?? novelData.videoProfile)
  const model = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelData.analysisModel,
  })
  const profileJson = JSON.stringify(profile, null, 2)

  if (payload.mode === 'rewrite_unit') {
    const targetUnitId = readText(payload.targetUnitId)
    if (!targetUnitId || !episode.contentPlan) throw new Error('targetUnitId is required')
    const currentPlan = parseContentPlan(episode.contentPlan, profile)
    const guideIndex = currentPlan.planType === 'guide'
      ? currentPlan.segments.findIndex((segment) => segment.id === targetUnitId)
      : -1
    const targetClip = guideIndex < 0
      ? await prisma.novelPromotionClip.findFirst({ where: { id: targetUnitId, episodeId } })
      : null
    if (guideIndex < 0 && !targetClip) throw new Error('CONTENT_UNIT_NOT_FOUND')
    const currentUnit = guideIndex >= 0 && currentPlan.planType === 'guide'
      ? currentPlan.segments[guideIndex]
      : targetClip
    const neighbors = guideIndex >= 0 && currentPlan.planType === 'guide'
      ? currentPlan.segments.slice(Math.max(0, guideIndex - 1), guideIndex + 2)
      : episode.clips
          .filter((clip) => clip.id !== targetUnitId)
          .slice(0, 2)
          .map((clip) => ({ id: clip.id, summary: clip.summary, content: clip.content }))
    await reportTaskProgress(job, 20, { stage: 'content_unit_rewrite', displayMode: 'detail' })
    const candidatePayload = await executePlanningJsonStep({
      job,
      model,
      prompt: buildPrompt({
        promptId: PROMPT_IDS.NP_CONTENT_UNIT_REWRITE,
        locale: job.data.locale,
        variables: {
          profile_json: profileJson,
          source_text: sourceText.slice(0, 60000),
          unit_type: guideIndex >= 0 ? 'guide_segment' : 'script_clip',
          current_unit_json: JSON.stringify(currentUnit, null, 2),
          neighbor_units_json: JSON.stringify(neighbors, null, 2),
          instruction: readRewriteInstruction(payload.instruction, job.data.locale),
        },
      }),
      action: 'content_unit_rewrite',
      stepId: 'content_unit_rewrite',
      stepTitle: 'progress.stage.contentUnitRewrite',
      stepIndex: 1,
      stepTotal: guideIndex >= 0 ? 2 : 1,
    })

    let candidate: unknown
    let candidateReview: unknown
    let candidateKind: 'guide_segment' | 'script_clip'
    if (guideIndex >= 0 && currentPlan.planType === 'guide') {
      const guideCandidate = buildGuideCandidate({
        plan: currentPlan,
        unitId: targetUnitId,
        payload: candidatePayload,
        profile,
      })
      candidate = guideCandidate.candidate
      candidateKind = 'guide_segment'
      const reviewPayload = await executePlanningJsonStep({
        job,
        model,
        prompt: buildPrompt({
          promptId: PROMPT_IDS.NP_CONTENT_REVIEW,
          locale: job.data.locale,
          variables: {
            profile_json: profileJson,
            source_text: sourceText.slice(0, 60000),
            plan_json: JSON.stringify(guideCandidate.candidatePlan, null, 2),
          },
        }),
        action: 'content_unit_review',
        stepId: 'content_unit_review',
        stepTitle: 'progress.stage.contentPlanReview',
        stepIndex: 2,
        stepTotal: 2,
        temperature: 0.2,
      })
      candidateReview = parseContentReview(reviewPayload)
    } else {
      candidate = buildScriptCandidate(candidatePayload, targetClip!)
      candidateKind = 'script_clip'
    }
    const contentPlan = storeContentUnitCandidate({
      contentPlan: episode.contentPlan,
      unitId: targetUnitId,
      kind: candidateKind,
      value: candidate,
      review: candidateReview,
      now: new Date().toISOString(),
    })
    await prisma.novelPromotionEpisode.update({
      where: { id: episodeId },
      data: { contentPlan: JSON.parse(JSON.stringify(contentPlan)) as Prisma.InputJsonValue },
    })
    await createArtifact({
      runId: readTaskRunId(job),
      stepKey: 'content_unit_rewrite',
      artifactType: 'content.unit_candidate',
      refId: targetUnitId,
      payload: toJsonRecord({ candidateKind, candidate, review: candidateReview }),
    })
    return {
      episodeId,
      targetUnitId,
      candidateKind,
      reviewStatus: asWorkspaceRecord(candidateReview)?.status || null,
    }
  }

  await reportTaskProgress(job, 15, { stage: 'content_plan_prepare', displayMode: 'detail' })
  await assertTaskActive(job, 'content_plan_prepare')
  const planPayload = await executePlanningJsonStep({
    job,
    model,
    prompt: buildPrompt({
      promptId: PROMPT_IDS.NP_CONTENT_PLAN,
      locale: job.data.locale,
      variables: { profile_json: profileJson, source_text: sourceText.slice(0, 60000) },
    }),
    action: 'content_plan_generate',
    stepId: 'content_plan_generate',
    stepTitle: 'progress.stage.contentPlanGenerate',
    stepIndex: 1,
    stepTotal: 2,
  })

  await reportTaskProgress(job, 55, { stage: 'content_plan_review', displayMode: 'detail' })
  await assertTaskActive(job, 'content_plan_review')
  const reviewPayload = await executePlanningJsonStep({
    job,
    model,
    prompt: buildPrompt({
      promptId: PROMPT_IDS.NP_CONTENT_REVIEW,
      locale: job.data.locale,
      variables: {
        profile_json: profileJson,
        source_text: sourceText.slice(0, 60000),
        plan_json: JSON.stringify(planPayload, null, 2),
      },
    }),
    action: 'content_plan_review',
    stepId: 'content_plan_review',
    stepTitle: 'progress.stage.contentPlanReview',
    stepIndex: 2,
    stepTotal: 2,
    temperature: 0.2,
  })

  const result = parseContentPlanResult(planPayload, reviewPayload, profile)
  await reportTaskProgress(job, 84, { stage: 'content_plan_persist', displayMode: 'detail' })
  await assertTaskActive(job, 'content_plan_persist')
  await persistContentPlan({
    episodeId,
    result,
    commitGuideClips: result.contentReview.status !== 'blocked',
  })
  await createArtifact({
    runId: readTaskRunId(job),
    stepKey: 'content_plan',
    artifactType: 'content.plan',
    refId: episodeId,
    payload: toJsonRecord({ profile, ...result }),
  })

  if (result.contentReview.status === 'blocked') {
    throw new Error(`CONTENT_PLAN_BLOCKED: ${result.contentReview.revisionInstructions.join('; ')}`)
  }
  return {
    episodeId,
    profilePreset: profile.preset,
    planType: result.contentPlan.planType,
    reviewStatus: result.contentReview.status,
    reviewScore: result.contentReview.score,
  }
}

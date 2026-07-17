import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { parseContentPlanResult } from '@/lib/content-planning'
import { createArtifact } from '@/lib/run-runtime/service'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveVideoProfile } from '@/lib/video-profile'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { persistContentPlan } from './content-plan-helpers'
import {
  executePlanningJsonStep,
  readTaskRunId,
  toJsonRecord,
} from './planning-task-shared'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleContentPlanTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  if (!episodeId) throw new Error('episodeId is required')

  const [novelData, episode] = await Promise.all([
    prisma.novelPromotionProject.findUnique({ where: { projectId: job.data.projectId } }),
    prisma.novelPromotionEpisode.findUnique({ where: { id: episodeId } }),
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

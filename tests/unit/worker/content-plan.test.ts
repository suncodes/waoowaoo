import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionEpisode: { findUnique: vi.fn() },
}))
const planningMock = vi.hoisted(() => ({
  executePlanningJsonStep: vi.fn(),
}))
const persistenceMock = vi.hoisted(() => ({
  persistContentPlan: vi.fn(async () => undefined),
}))
const artifactMock = vi.hoisted(() => ({
  createArtifact: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/handlers/planning-task-shared', () => ({
  executePlanningJsonStep: planningMock.executePlanningJsonStep,
  readTaskRunId: vi.fn(() => 'run-content-1'),
  toJsonRecord: (value: unknown) => value,
}))
vi.mock('@/lib/workers/handlers/content-plan-helpers', () => persistenceMock)
vi.mock('@/lib/run-runtime/service', () => artifactMock)
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({
  resolveAnalysisModel: vi.fn(async () => 'google::gemini-3-flash-preview'),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: vi.fn(async () => undefined) }))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_CONTENT_PLAN: 'content-plan', NP_CONTENT_REVIEW: 'content-review' },
  buildPrompt: vi.fn(({ promptId }: { promptId: string }) => promptId),
}))

import { handleContentPlanTask } from '@/lib/workers/handlers/content-plan'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-content-plan-1',
      type: TASK_TYPE.CONTENT_PLAN_RUN,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload: { runId: 'run-content-1', content: '故事原文' },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function planPayload() {
  return {
    creativeBrief: {
      objective: '讲清主人公的选择',
      audiencePromise: '看到冲突与变化',
      targetDurationSec: 90,
    },
    contentPlan: {
      title: '雨夜抉择',
      logline: '主人公在雨夜作出关键选择',
      themes: ['选择'],
      beats: [{ title: '冲突', purpose: '建立抉择', summary: '主人公面对两难', estimatedDurationSec: 30 }],
    },
  }
}

function reviewPayload(status: 'approved' | 'blocked' = 'approved') {
  return {
    status,
    score: status === 'approved' ? 90 : 40,
    profileFitScore: 90,
    sourceSupportScore: 88,
    issues: status === 'blocked'
      ? [{ code: 'PROFILE_MISMATCH', severity: 'blocking', message: '结构不匹配' }]
      : [],
    revisionInstructions: status === 'blocked' ? ['重写内容结构'] : [],
  }
}

describe('worker content-plan behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'novel-project-1',
      analysisModel: 'google::gemini-3-flash-preview',
      videoProfile: { preset: 'ai_comic' },
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'novel-project-1',
      novelText: '数据库原文',
    })
  })

  it('persists the parsed plan and artifact before returning the review result', async () => {
    planningMock.executePlanningJsonStep
      .mockResolvedValueOnce(planPayload())
      .mockResolvedValueOnce(reviewPayload())

    const result = await handleContentPlanTask(buildJob())

    expect(result).toEqual({
      episodeId: 'episode-1',
      profilePreset: 'ai_comic',
      planType: 'narrative',
      reviewStatus: 'approved',
      reviewScore: 90,
    })
    expect(persistenceMock.persistContentPlan).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: 'episode-1',
      commitGuideClips: true,
      result: expect.objectContaining({
        contentPlan: expect.objectContaining({ planType: 'narrative' }),
      }),
    }))
    expect(artifactMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-content-1',
      artifactType: 'content.plan',
      refId: 'episode-1',
    }))
  })

  it('persists review evidence and then blocks an invalid content plan', async () => {
    planningMock.executePlanningJsonStep
      .mockResolvedValueOnce(planPayload())
      .mockResolvedValueOnce(reviewPayload('blocked'))

    await expect(handleContentPlanTask(buildJob())).rejects.toThrow('CONTENT_PLAN_BLOCKED: 重写内容结构')
    expect(persistenceMock.persistContentPlan).toHaveBeenCalledWith(expect.objectContaining({
      commitGuideClips: false,
      result: expect.objectContaining({ contentReview: expect.objectContaining({ status: 'blocked' }) }),
    }))
  })
})

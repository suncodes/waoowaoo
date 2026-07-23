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

function guidePlanPayload() {
  return {
    creativeBrief: {
      objective: '生成经典书籍导读',
      audiencePromise: '理解作品核心价值',
      targetDurationSec: 180,
    },
    contentPlan: {
      planType: 'guide',
      title: '海底两万里导读',
      thesis: '这是一部关于科学想象与探索精神的经典作品',
      recommendationAngle: '从冒险想象和时代精神切入',
      outline: [{
        id: 'outline_1',
        title: '为什么值得读',
        question: '作品为何经典',
        takeaway: '科学幻想与冒险叙事结合',
      }],
      segments: [{
        id: 'segment_1',
        outlineId: 'outline_1',
        title: '经典价值',
        narration: '《海底两万里》把海洋探险、科学想象和人物命运结合起来。',
        visualPurpose: '建立书籍与主题认知',
        visualHints: ['书封', '海底潜航示意'],
        estimatedDurationSec: 30,
        spoilerLevel: 'light',
        sourceAnchor: {
          label: '模型常识：作品整体',
          quote: '伪原文引用',
        },
      }],
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

    expect(result).toMatchObject({
      episodeId: 'episode-1',
      profilePreset: 'ai_comic',
      planType: 'narrative',
      reviewStatus: 'approved',
      reviewScore: 90,
      contentQualityReviewStatus: 'passed',
      contentQualityReviewScore: expect.any(Number),
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
      artifactType: 'content.quality.review',
      refId: 'episode-1',
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

  it('marks book-title-only guide plans as model-knowledge drafts', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'novel-project-1',
      analysisModel: 'google::gemini-3-flash-preview',
      videoProfile: { preset: 'book_guide' },
    })
    planningMock.executePlanningJsonStep
      .mockResolvedValueOnce(guidePlanPayload())
      .mockResolvedValueOnce(reviewPayload())

    const job = buildJob()
    job.data.payload = { runId: 'run-content-1', content: '《海底两万里》' }

    const result = await handleContentPlanTask(job)

    expect(result).toEqual(expect.objectContaining({
      profilePreset: 'book_guide',
      planType: 'guide',
      reviewStatus: 'warning',
      contentQualityReviewStatus: 'passed',
    }))
    const persisted = (persistenceMock.persistContentPlan.mock.calls as unknown as Array<[{
      result: {
        contentPlan: {
          sourceLedger: Array<{ sourceType?: string; confidence?: number; quote?: string; riskFlags: Array<{ code?: string }> }>
          riskFlags: Array<{ code?: string }>
          segments: Array<{
            sourceAnchor: { quote?: string; sourceType?: string; confidence?: number }
            riskFlags: Array<{ code?: string }>
          }>
        }
        contentReview: {
          sourceSupportScore: number
          issues: Array<{ code?: string }>
        }
      }
    }]>)[0]?.[0]
    expect(persisted).toBeDefined()
    const contentPlan = persisted?.result.contentPlan
    const contentReview = persisted?.result.contentReview
    expect(contentPlan?.sourceLedger[0]).toEqual(expect.objectContaining({
      sourceType: 'model_knowledge',
      confidence: expect.any(Number),
      quote: undefined,
    }))
    expect(contentPlan?.sourceLedger[0]?.riskFlags.some((risk) => risk.code === 'source_gap')).toBe(true)
    expect(contentPlan?.riskFlags.some((risk) => risk.code === 'source_gap')).toBe(true)
    expect(contentPlan?.segments[0]?.sourceAnchor).toEqual(expect.objectContaining({
      sourceType: 'model_knowledge',
      confidence: expect.any(Number),
    }))
    expect(contentPlan?.segments[0]?.sourceAnchor.quote).toBeUndefined()
    expect(contentPlan?.segments[0]?.riskFlags.some((risk) => risk.code === 'source_gap')).toBe(true)
    expect(contentReview?.sourceSupportScore).toBeLessThanOrEqual(70)
    expect(contentReview?.issues.some((issue) => issue.code === 'SOURCE_UNSUPPORTED')).toBe(true)
  })
})

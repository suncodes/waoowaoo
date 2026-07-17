import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionEpisode: { findUnique: vi.fn() },
}))
const planningMock = vi.hoisted(() => ({ executePlanningJsonStep: vi.fn() }))
const persistenceMock = vi.hoisted(() => ({ persistVisualPlan: vi.fn(async () => undefined) }))
const artifactMock = vi.hoisted(() => ({ createArtifact: vi.fn(async () => undefined) }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/handlers/planning-task-shared', () => ({
  executePlanningJsonStep: planningMock.executePlanningJsonStep,
  readTaskRunId: vi.fn(() => 'run-visual-1'),
  toJsonRecord: (value: unknown) => value,
}))
vi.mock('@/lib/workers/handlers/visual-plan-persist', () => persistenceMock)
vi.mock('@/lib/run-runtime/service', () => artifactMock)
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({
  resolveAnalysisModel: vi.fn(async () => 'google::gemini-3-flash-preview'),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: vi.fn(async () => undefined) }))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_VISUAL_PLAN: 'visual-plan' },
  buildPrompt: vi.fn(() => 'visual-plan-prompt'),
}))

import { handleVisualPlanTask } from '@/lib/workers/handlers/visual-plan'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-visual-plan-1',
      type: TASK_TYPE.VISUAL_PLAN_RUN,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload: { runId: 'run-visual-1' },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function visualPlanPayload() {
  return {
    directorTreatment: {
      narrativeStrategy: '旁白驱动',
      pacing: '问题到结论',
      cameraLanguage: '稳定镜头',
      transitionStrategy: '图形匹配',
      soundStrategy: '克制配乐',
    },
    productionBible: {
      visualStyle: '编辑式插画',
      lightingBaseline: '柔光',
      colorGrade: '中性暖色',
      compositionRules: ['主体清晰'],
      continuityRules: ['色温一致'],
      forbiddenPatterns: ['乱码文字'],
    },
    shotPlan: { summary: '导读镜头计划', totalEstimatedDurationSec: 24 },
    visualUnits: [{
      id: 'unit-1',
      clipId: 'clip-1',
      panelNumber: 1,
      visualType: 'diagram',
      renderMode: 'composite',
      shotType: 'medium shot',
      cameraMove: 'slow push',
      description: '展示核心概念图',
      imagePrompt: '清晰的概念图',
      videoPrompt: '缓慢推进',
      durationSec: 8,
    }],
  }
}

describe('worker visual-plan behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'novel-project-1',
      analysisModel: 'google::gemini-3-flash-preview',
      videoProfile: { preset: 'book_guide' },
      videoRatio: '16:9',
      artStyle: 'editorial',
      artStylePrompt: null,
      characters: [],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'novel-project-1',
      creativeBrief: { objective: '导读' },
      contentPlan: { planType: 'guide' },
      clips: [{ id: 'clip-1', summary: '核心观点', content: '旁白内容', screenplay: '{}', duration: 24 }],
    })
    planningMock.executePlanningJsonStep.mockResolvedValue(visualPlanPayload())
  })

  it('persists guide storyboards through the shared visual plan adapter', async () => {
    const result = await handleVisualPlanTask(buildJob())

    expect(result).toEqual({
      episodeId: 'episode-1',
      profilePreset: 'book_guide',
      visualUnitCount: 1,
      storyboardPersisted: true,
    })
    expect(persistenceMock.persistVisualPlan).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: 'episode-1',
      isBookGuide: true,
      narratorLabel: '旁白',
      result: expect.objectContaining({ visualUnits: [expect.objectContaining({ clipId: 'clip-1' })] }),
    }))
    expect(artifactMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactType: 'visual.plan',
      runId: 'run-visual-1',
    }))
  })

  it('requires a completed content plan before visual planning', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      novelPromotionProjectId: 'novel-project-1',
      creativeBrief: null,
      contentPlan: null,
      clips: [{ id: 'clip-1' }],
    })

    await expect(handleVisualPlanTask(buildJob())).rejects.toThrow('CONTENT_PLAN_REQUIRED')
    expect(planningMock.executePlanningJsonStep).not.toHaveBeenCalled()
  })
})

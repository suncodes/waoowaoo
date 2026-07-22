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
  PLANNING_JSON_PARSE_ERROR_CODE: 'PLANNING_JSON_PARSE_FAILED',
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
  PROMPT_IDS: {
    NP_VISUAL_PLAN: 'visual-plan',
    NP_VISUAL_PLAN_REPAIR: 'visual-plan-repair',
  },
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

function contentPlanWithApprovedAssets(assetIds: string[]) {
  return {
    planType: 'guide',
    segments: [{ id: 'segment-1', narration: '介绍一位神秘人物。' }],
    _workspace: {
      schemaVersion: 1,
      status: 'approved',
      revision: 1,
      approvedRevision: 1,
      updatedAt: '2026-07-20T00:00:00.000Z',
      updatedBy: 'user',
      units: {},
      assetRequirements: {
        status: 'approved',
        analyzedRevision: 1,
        analyzedAt: '2026-07-20T00:00:00.000Z',
        approvedAt: '2026-07-20T00:01:00.000Z',
        assetIds,
      },
      latestImpact: null,
      downstream: { visualDesign: false, storyboard: false, production: false },
    },
  }
}

describe('worker visual-plan behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planningMock.executePlanningJsonStep.mockReset()
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

  it('repairs a visual plan when a generated unit is missing imagePrompt', async () => {
    const invalidPayload = visualPlanPayload()
    delete (invalidPayload.visualUnits[0] as { imagePrompt?: string }).imagePrompt
    planningMock.executePlanningJsonStep
      .mockResolvedValueOnce(invalidPayload)
      .mockResolvedValueOnce(visualPlanPayload())

    const result = await handleVisualPlanTask(buildJob())

    expect(result.visualUnitCount).toBe(1)
    expect(planningMock.executePlanningJsonStep).toHaveBeenCalledTimes(2)
    expect(planningMock.executePlanningJsonStep).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'visual_plan_repair',
      stepAttempt: 2,
      temperature: 0.2,
    }))
    expect(persistenceMock.persistVisualPlan).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        visualUnits: [expect.objectContaining({ imagePrompt: '清晰的概念图' })],
      }),
    }))
  })

  it('repairs malformed JSON output using the captured raw model response', async () => {
    const parseError = Object.assign(new Error('Unexpected end of JSON input'), {
      code: 'PLANNING_JSON_PARSE_FAILED',
      rawText: '{"directorTreatment":{"narrativeStrategy":"旁白驱动"',
    })
    planningMock.executePlanningJsonStep
      .mockRejectedValueOnce(parseError)
      .mockResolvedValueOnce(visualPlanPayload())

    await handleVisualPlanTask(buildJob())

    expect(planningMock.executePlanningJsonStep).toHaveBeenCalledTimes(2)
    expect(planningMock.executePlanningJsonStep).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'visual_plan_repair',
      stepAttempt: 2,
    }))
    expect(persistenceMock.persistVisualPlan).toHaveBeenCalledOnce()
  })

  it('stops after bounded repair attempts when the model keeps returning invalid units', async () => {
    const invalidPayload = visualPlanPayload()
    delete (invalidPayload.visualUnits[0] as { imagePrompt?: string }).imagePrompt
    planningMock.executePlanningJsonStep.mockResolvedValue(invalidPayload)

    await expect(handleVisualPlanTask(buildJob())).rejects.toThrow(
      'VISUAL_PLAN_INVALID: visualUnits.0.imagePrompt is required',
    )
    expect(planningMock.executePlanningJsonStep).toHaveBeenCalledTimes(3)
    expect(persistenceMock.persistVisualPlan).not.toHaveBeenCalled()
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

  it('keeps approved visual requirements even when their names are absent from the script', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'novel-project-1',
      analysisModel: 'google::gemini-3-flash-preview',
      videoProfile: { preset: 'book_guide' },
      videoRatio: '16:9',
      artStyle: 'editorial',
      artStylePrompt: null,
      characters: [{
        id: 'character-nemo',
        name: '尼摩船长标准形象',
        introduction: '需要贯穿全片保持一致',
      }],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      novelPromotionProjectId: 'novel-project-1',
      creativeBrief: { objective: '导读' },
      contentPlan: contentPlanWithApprovedAssets(['character-nemo']),
      clips: [{ id: 'clip-1', summary: '核心观点', content: '介绍一位神秘人物。', screenplay: '{}', duration: 24 }],
    })

    await handleVisualPlanTask(buildJob())

    expect(persistenceMock.persistVisualPlan).toHaveBeenCalledWith(expect.objectContaining({
      anchors: [expect.objectContaining({
        assetId: 'character-nemo',
        assetKind: 'character',
        importance: 'core',
      })],
    }))
  })

  it('preserves exact model-selected asset refs and binds them into the persisted visual units', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'novel-project-1',
      analysisModel: 'google::gemini-3-flash-preview',
      videoProfile: { preset: 'book_guide' },
      videoRatio: '16:9',
      artStyle: 'editorial',
      artStylePrompt: null,
      characters: [],
      locations: [{
        id: 'prop-nautilus',
        name: '鹦鹉螺号潜水艇',
        summary: '核心潜水艇道具',
        assetKind: 'prop',
      }],
    })
    const payload = visualPlanPayload()
    payload.visualUnits[0] = {
      ...payload.visualUnits[0],
      description: '展示鹦鹉螺号潜水艇的外形',
      imagePrompt: '鹦鹉螺号潜水艇在纯净深海中航行，无文字',
      assetRefs: [{ id: 'prop-nautilus', kind: 'prop', name: '鹦鹉螺号潜水艇' }],
    } as typeof payload.visualUnits[number] & { assetRefs: Array<{ id: string; kind: 'prop'; name: string }> }
    planningMock.executePlanningJsonStep.mockResolvedValueOnce(payload)

    await handleVisualPlanTask(buildJob())

    expect(persistenceMock.persistVisualPlan).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        visualUnits: [expect.objectContaining({
          assetRefs: [{ id: 'prop-nautilus', kind: 'prop', name: '鹦鹉螺号潜水艇' }],
        })],
      }),
    }))
  })

  it('repairs visual plans that reference unknown asset ids', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'novel-project-1',
      analysisModel: 'google::gemini-3-flash-preview',
      videoProfile: { preset: 'book_guide' },
      videoRatio: '16:9',
      artStyle: 'editorial',
      artStylePrompt: null,
      characters: [],
      locations: [{
        id: 'prop-nautilus',
        name: '鹦鹉螺号潜水艇',
        summary: '核心潜水艇道具',
        assetKind: 'prop',
      }],
    })
    const invalid = visualPlanPayload()
    invalid.visualUnits[0] = {
      ...invalid.visualUnits[0],
      assetRefs: [{ id: 'missing-prop', kind: 'prop', name: '不存在的道具' }],
    } as typeof invalid.visualUnits[number] & { assetRefs: Array<{ id: string; kind: 'prop'; name: string }> }
    planningMock.executePlanningJsonStep
      .mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce(visualPlanPayload())

    await handleVisualPlanTask(buildJob())

    expect(planningMock.executePlanningJsonStep).toHaveBeenCalledTimes(2)
    expect(planningMock.executePlanningJsonStep).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'visual_plan_repair',
    }))
  })

  it('rejects deleted approved assets before generating or persisting a partial plan', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      novelPromotionProjectId: 'novel-project-1',
      creativeBrief: { objective: '导读' },
      contentPlan: contentPlanWithApprovedAssets(['deleted-asset']),
      clips: [{ id: 'clip-1', summary: '核心观点', content: '旁白内容', screenplay: '{}', duration: 24 }],
    })

    await expect(handleVisualPlanTask(buildJob())).rejects.toThrow(
      'VISUAL_ASSET_REQUIREMENTS_INVALID:deleted-asset',
    )
    expect(planningMock.executePlanningJsonStep).not.toHaveBeenCalled()
    expect(persistenceMock.persistVisualPlan).not.toHaveBeenCalled()
  })
})

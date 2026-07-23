import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  novelPromotionProject: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionCharacter: { create: vi.fn(async () => ({ id: 'char-new-1' })) },
  novelPromotionLocation: { create: vi.fn(async () => ({ id: 'loc-new-1' })) },
  locationImage: {
    create: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({ count: 1 })),
  },
}))

const llmMock = vi.hoisted(() => ({
  chatCompletion: vi.fn(async () => ({ id: 'completion-1' })),
  getCompletionContent: vi.fn(),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/llm-client', () => llmMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/constants')>()
  return {
    ...actual,
    getArtStylePrompt: vi.fn(() => 'cinematic style'),
    removeLocationPromptSuffix: vi.fn((text: string) => text.replace(' [SUFFIX]', '')),
    removePropPromptSuffix: vi.fn((text: string) => text),
  }
})
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    onStage: vi.fn(),
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    flush: vi.fn(async () => undefined),
  })),
}))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: {
    NP_AGENT_CHARACTER_PROFILE: 'char',
    NP_SELECT_LOCATION: 'loc',
    NP_SELECT_PROP: 'prop',
  },
  buildPrompt: vi.fn(() => 'analysis-prompt'),
}))

import { handleAnalyzeNovelTask } from '@/lib/workers/handlers/analyze-novel'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-analyze-novel-1',
      type: TASK_TYPE.ANALYZE_NOVEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionProject',
      targetId: 'np-project-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker analyze-novel behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.novelPromotionLocation.create
      .mockResolvedValueOnce({ id: 'loc-new-1' })
      .mockResolvedValueOnce({ id: 'prop-new-1' })

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
    })

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: '全局设定文本',
      characters: [{ id: 'char-existing', name: '已有角色' }],
      locations: [{ id: 'loc-existing', name: '已有场景', summary: 'old' }],
    })

    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'np-project-1',
      novelText: '首集内容',
      contentPlan: null,
      productionBible: null,
    })

    llmMock.getCompletionContent
      .mockReturnValueOnce(JSON.stringify({
        characters: [
          {
            name: '新角色',
            aliases: ['别名A'],
            role_level: 'main',
            personality_tags: ['冷静'],
            visual_keywords: ['黑发'],
          },
        ],
      }))
      .mockReturnValueOnce(JSON.stringify({
        locations: [
          {
            name: '新地点',
            summary: '雨夜街道',
            descriptions: ['雨夜街道 [SUFFIX]'],
          },
        ],
      }))
      .mockReturnValueOnce(JSON.stringify({
        props: [
          {
            name: '金箍棒',
            summary: '孙悟空随身铁棍法器',
            description: '一根黑铁长棍，两端包裹金色金属箍，表面磨损发亮，杆身笔直厚重',
          },
        ],
      }))
  })

  it('no global text and no episode text -> explicit error', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: '',
      characters: [],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      novelPromotionProjectId: 'np-project-1',
      novelText: '',
      contentPlan: null,
      productionBible: null,
    })

    await expect(handleAnalyzeNovelTask(buildJob())).rejects.toThrow('请先填写全局资产设定或剧本内容')
  })

  it('success path -> creates character/location and persists cleaned location descriptions', async () => {
    const result = await handleAnalyzeNovelTask(buildJob())

    expect(result).toEqual({
      success: true,
      characters: [{ id: 'char-new-1' }],
      locations: [{ id: 'loc-new-1' }],
      props: [{ id: 'prop-new-1' }],
      characterCount: 1,
      locationCount: 1,
      propCount: 1,
    })

    expect(prismaMock.novelPromotionCharacter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          novelPromotionProjectId: 'np-project-1',
          name: '新角色',
          aliases: JSON.stringify(['别名A']),
        }),
      }),
    )

    expect(prismaMock.novelPromotionLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          novelPromotionProjectId: 'np-project-1',
          name: '新地点',
          summary: '雨夜街道',
        }),
      }),
    )

    expect(prismaMock.locationImage.create).not.toHaveBeenCalled()
    expect(prismaMock.locationImage.createMany).toHaveBeenNthCalledWith(1, {
      data: [
        {
          locationId: 'loc-new-1',
          imageIndex: 0,
          description: '雨夜街道',
          availableSlots: '[]',
        },
      ],
    })
    expect(prismaMock.locationImage.createMany).toHaveBeenNthCalledWith(2, {
      data: [
        {
          locationId: 'prop-new-1',
          imageIndex: 0,
          description: '一根黑铁长棍，两端包裹金色金属箍，表面磨损发亮，杆身笔直厚重',
          availableSlots: '[]',
        },
      ],
    })

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      60,
      expect.objectContaining({
        stepId: 'analyze_characters',
        done: true,
        output: expect.stringContaining('"characters"'),
      }),
    )

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      70,
      expect.objectContaining({
        stepId: 'analyze_locations',
        done: true,
        output: expect.stringContaining('"locations"'),
      }),
    )
  })

  it('persists a reviewable empty visual requirement result', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'np-project-1',
      novelText: '只使用抽象知识图形，不包含固定人物、地点或道具。',
      contentPlan: {
        planType: 'guide',
        title: '知识导读',
        thesis: '核心观点',
        recommendationAngle: '理解概念',
        outline: [],
        segments: [],
      },
      productionBible: null,
      clips: [],
    })
    llmMock.getCompletionContent
      .mockReset()
      .mockReturnValueOnce(JSON.stringify({ characters: [] }))
      .mockReturnValueOnce(JSON.stringify({ locations: [] }))
      .mockReturnValueOnce(JSON.stringify({ props: [] }))

    await handleAnalyzeNovelTask(buildJob())

    expect(prismaMock.novelPromotionEpisode.update).toHaveBeenCalledWith({
      where: { id: 'episode-1' },
      data: {
        contentPlan: expect.objectContaining({
          _workspace: expect.objectContaining({
            assetRequirements: {
              status: 'needs_review',
              analyzedRevision: 1,
              analyzedAt: expect.any(String),
              approvedAt: null,
              assetIds: [],
              assetBible: [],
              review: expect.objectContaining({
                reviewKind: 'asset_bible',
                status: 'passed',
                assetCount: 0,
              }),
            },
          }),
        }),
      },
    })
  })

  it('keeps an outdated visual plan stale while refreshing visual requirements', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'np-project-1',
      novelText: '更新后的导读内容。',
      contentPlan: {
        planType: 'guide',
        title: '知识导读',
        thesis: '核心观点',
        recommendationAngle: '理解概念',
        outline: [],
        segments: [],
      },
      productionBible: {
        visualStyle: 'cinematic',
        visualMotifs: [],
        continuityRules: [],
        negativeConstraints: [],
        _workspace: {
          schemaVersion: 1,
          status: 'stale',
          revision: 3,
          approvedRevision: 2,
          updatedAt: '2026-07-20T00:00:00.000Z',
          updatedBy: 'user',
          anchors: [],
          plan: { shotPlan: {}, visualUnits: [] },
          latestImpact: null,
          downstream: { storyboard: true, production: true },
        },
      },
      clips: [],
    })
    llmMock.getCompletionContent
      .mockReset()
      .mockReturnValueOnce(JSON.stringify({ characters: [] }))
      .mockReturnValueOnce(JSON.stringify({ locations: [] }))
      .mockReturnValueOnce(JSON.stringify({ props: [] }))

    await handleAnalyzeNovelTask(buildJob())

    expect(prismaMock.novelPromotionEpisode.update).toHaveBeenCalledWith({
      where: { id: 'episode-1' },
      data: expect.objectContaining({
        productionBible: expect.objectContaining({
          _workspace: expect.objectContaining({ status: 'stale' }),
        }),
      }),
    })
  })

  it('writes an asset bible with evidence for reviewable visual requirements', async () => {
    prismaMock.novelPromotionProject.findUnique
      .mockResolvedValueOnce({
        id: 'np-project-1',
        analysisModel: 'llm::analysis-1',
        artStyle: 'cinematic',
        globalAssetText: '全局设定文本',
        characters: [],
        locations: [],
      })
      .mockResolvedValueOnce({
        id: 'np-project-1',
        characters: [{ id: 'char-nemo', name: '尼摩船长', introduction: '神秘的潜艇指挥者' }],
        locations: [{ id: 'prop-nautilus', name: '鹦鹉螺号潜水艇', summary: '核心潜艇道具', assetKind: 'prop' }],
      })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'np-project-1',
      novelText: '尼摩船长驾驶鹦鹉螺号潜水艇进入深海。',
      contentPlan: {
        planType: 'guide',
        title: '海底两万里导读',
        thesis: '理解科学想象',
        recommendationAngle: '冒险与技术',
        outline: [],
        segments: [{
          id: 'segment-1',
          title: '深海冒险',
          narration: '尼摩船长驾驶鹦鹉螺号潜水艇进入深海。',
          visualPurpose: '锁定核心人物和潜艇',
          visualHints: ['尼摩船长', '鹦鹉螺号潜水艇'],
        }],
      },
      productionBible: null,
      clips: [{
        id: 'clip-1',
        summary: '深海冒险',
        content: '尼摩船长驾驶鹦鹉螺号潜水艇进入深海。',
        screenplay: null,
        characters: null,
        location: null,
        props: null,
      }],
    })
    llmMock.getCompletionContent
      .mockReset()
      .mockReturnValueOnce(JSON.stringify({ characters: [] }))
      .mockReturnValueOnce(JSON.stringify({ locations: [] }))
      .mockReturnValueOnce(JSON.stringify({ props: [] }))

    await handleAnalyzeNovelTask(buildJob())

    expect(prismaMock.novelPromotionEpisode.update).toHaveBeenCalledWith({
      where: { id: 'episode-1' },
      data: {
        contentPlan: expect.objectContaining({
          _workspace: expect.objectContaining({
            assetRequirements: expect.objectContaining({
              assetIds: expect.arrayContaining(['char-nemo', 'prop-nautilus']),
              review: expect.objectContaining({
                reviewKind: 'asset_bible',
                status: 'passed',
                assetCount: 2,
                mustLockCount: 2,
              }),
              assetBible: expect.arrayContaining([
                expect.objectContaining({
                  id: 'char-nemo',
                  canonicalName: '尼摩船长',
                  priority: 'must_lock',
                  generationNeed: 'reference_required',
                  evidence: expect.arrayContaining([expect.objectContaining({ sourceId: 'segment-1' })]),
                }),
                expect.objectContaining({
                  id: 'prop-nautilus',
                  canonicalName: '鹦鹉螺号潜水艇',
                  kind: 'prop',
                }),
              ]),
            }),
          }),
        }),
      },
    })
  })
})

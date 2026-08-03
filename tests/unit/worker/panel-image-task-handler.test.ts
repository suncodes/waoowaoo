import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ storyboardModel: 'storyboard-model-1', artStyle: 'realistic' })),
  resolveImageSourceFromGeneration: vi.fn(),
  uploadImageSourceToCos: vi.fn(),
}))

const sharedMock = vi.hoisted(() => ({
  collectPanelVisualReferences: vi.fn(async () => [{
    assetId: 'asset-1',
    renderId: 'render-1',
    assetKind: 'character',
    assetName: 'Hero',
    url: 'https://signed.example/ref-1.png',
    role: 'primary_identity',
    usage: 'must_match',
    weight: 1,
    source: 'shot_spec',
  }]),
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '16:9',
    characters: [],
    locations: [
      {
        name: 'Old Town',
        images: [
          {
            isSelected: true,
            description: '雨夜街道',
            availableSlots: JSON.stringify([
              '街道左侧靠墙的留白位置',
            ]),
          },
        ],
      },
    ],
  })),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async () => ['normalized-ref-1']),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'panel-image-prompt'),
}))
const qualityMock = vi.hoisted(() => ({
  persistPanelCandidatesAndScheduleReview: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
  })),
}))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    collectPanelVisualReferences: sharedMock.collectPanelVisualReferences,
    resolveNovelData: sharedMock.resolveNovelData,
  }
})
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_SINGLE_PANEL_IMAGE: 'np_single_panel_image' },
  buildPrompt: promptMock.buildPrompt,
}))
vi.mock('@/lib/workers/handlers/panel-visual-quality-trigger', () => qualityMock)

import { handlePanelImageTask } from '@/lib/workers/handlers/panel-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'panel-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-panel-image-1',
      type: TASK_TYPE.IMAGE_PANEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker panel-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: 'dramatic',
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'default', slot: '街道左侧靠墙的留白位置' }]),
      srtSegment: '台词片段',
      photographyRules: null,
      actingNotes: null,
      visualType: 'book_cover',
      renderMode: 'composite',
      onScreenText: '准确标题由后期渲染',
      sketchImageUrl: null,
      imageUrl: null,
    })

    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-source-1')
      .mockResolvedValueOnce('generated-source-2')

    utilsMock.uploadImageSourceToCos
      .mockResolvedValueOnce('cos/panel-candidate-1.png')
      .mockResolvedValueOnce('cos/panel-candidate-2.png')
    qualityMock.persistPanelCandidatesAndScheduleReview.mockResolvedValue({
      imageUrl: 'cos/panel-candidate-1.png',
      mode: 'shadow',
      versionHash: 'version-panel-1',
      reviewScheduled: true,
      reviewTaskId: 'task-quality-1',
    })
  })

  it('missing panelId -> explicit error', async () => {
    const job = buildJob({}, '')
    await expect(handlePanelImageTask(job)).rejects.toThrow('panelId missing')
  })

  it('first generation -> persists main image and candidate list', async () => {
    const job = buildJob({ candidateCount: 2 })
    const result = await handlePanelImageTask(job)

    expect(result).toMatchObject({
      panelId: 'panel-1',
      candidateCount: 2,
      imageUrl: 'cos/panel-candidate-1.png',
      visualQualityMode: 'shadow',
      visualQualityVersionHash: 'version-panel-1',
      visualQualityReviewScheduled: true,
      visualQualityReviewTaskId: 'task-quality-1',
      promptSnapshot: expect.objectContaining({
        snapshotType: 'panel_image_prompt',
        targetId: 'panel-1',
      }),
    })

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'storyboard-model-1',
        prompt: 'panel-image-prompt',
        allowTaskExternalIdResume: false,
        options: expect.objectContaining({
          referenceImages: ['https://signed.example/ref-1.png'],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        render_brief: expect.stringContaining('特殊处理：生成无文字的干净底图或单个前景素材'),
      }),
    }))

    expect(qualityMock.persistPanelCandidatesAndScheduleReview).toHaveBeenCalledWith(expect.objectContaining({
      panel: expect.objectContaining({ id: 'panel-1' }),
      candidates: ['cos/panel-candidate-1.png', 'cos/panel-candidate-2.png'],
      isFirstGeneration: true,
    }))
  })

  it('regeneration branch -> keeps old image in previousImageUrl and stores candidates only', async () => {
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.uploadImageSourceToCos.mockReset()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up',
      imagePrompt: null,
      videoPrompt: 'dramatic',
      location: 'Old Town',
      characters: '[]',
      srtSegment: null,
      photographyRules: null,
      actingNotes: null,
      visualType: 'illustration',
      renderMode: 'generated_image',
      onScreenText: null,
      sketchImageUrl: null,
      imageUrl: 'cos/panel-old.png',
    })

    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-source-regen-1')
      .mockResolvedValueOnce('generated-source-regen-2')
    utilsMock.uploadImageSourceToCos
      .mockResolvedValueOnce('cos/panel-regenerated-1.png')
      .mockResolvedValueOnce('cos/panel-regenerated-2.png')
    qualityMock.persistPanelCandidatesAndScheduleReview.mockResolvedValueOnce({
      imageUrl: null,
      mode: 'auto',
      versionHash: 'version-panel-2',
      reviewScheduled: true,
      reviewTaskId: 'task-quality-2',
    })

    const job = buildJob({ candidateCount: 1 })
    const result = await handlePanelImageTask(job)

    expect(result).toMatchObject({
      panelId: 'panel-1',
      candidateCount: 2,
      imageUrl: null,
      visualQualityMode: 'auto',
      visualQualityVersionHash: 'version-panel-2',
      visualQualityReviewScheduled: true,
      visualQualityReviewTaskId: 'task-quality-2',
      promptSnapshot: expect.objectContaining({
        snapshotType: 'panel_image_prompt',
        targetId: 'panel-1',
      }),
    })

    expect(qualityMock.persistPanelCandidatesAndScheduleReview).toHaveBeenCalledWith(expect.objectContaining({
      candidates: ['cos/panel-regenerated-1.png', 'cos/panel-regenerated-2.png'],
      isFirstGeneration: false,
    }))
  })
})

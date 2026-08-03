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
  resolveImageSourceFromGeneration: vi.fn(),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
  uploadImageSourceToCos: vi.fn(),
}))

const qualityMock = vi.hoisted(() => ({
  persistPanelCandidatesAndScheduleReview: vi.fn(),
}))

const runRuntimeMock = vi.hoisted(() => ({
  createArtifact: vi.fn(),
}))

const preparedPromptMock = vi.hoisted(() => ({
  requirePreparedPrompt: vi.fn(),
  attachPreparedPromptToSnapshot: vi.fn((snapshot: Record<string, unknown>, artifactId: string) => ({
    ...snapshot,
    preparedPromptArtifactId: artifactId,
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/handlers/panel-visual-quality-trigger', () => qualityMock)
vi.mock('@/lib/run-runtime/service', () => runRuntimeMock)
vi.mock('@/lib/creative-quality/prepared-prompts', () => preparedPromptMock)

import { handlePanelImageTask } from '@/lib/workers/handlers/panel-image-task-handler'

function buildPreparedPrompt(overrides: Record<string, unknown> = {}) {
  const artifactId = typeof overrides.artifactId === 'string' ? overrides.artifactId : 'prepared-panel-image-1'
  const modelKey = typeof overrides.modelKey === 'string' ? overrides.modelKey : 'prepared-storyboard-model'
  const compiledPrompt = typeof overrides.compiledPrompt === 'string' ? overrides.compiledPrompt : '已固定的分镜图提示词'
  const referenceImages = Array.isArray(overrides.referenceImages)
    ? overrides.referenceImages
    : ['cos/fixed-panel-reference.png']
  const generationOptions = overrides.generationOptions && typeof overrides.generationOptions === 'object'
    ? overrides.generationOptions
    : { aspectRatio: '16:9', seed: 12 }
  return {
    artifactId,
    artifactType: 'prompt.panel_image.prepared',
    runId: 'run-prepared-panel-image',
    kind: 'panel_image',
    refId: 'panel-1',
    targetType: 'NovelPromotionPanel',
    targetId: 'panel-1',
    generationMode: null,
    generationOptions,
    snapshot: {
      schemaVersion: 1,
      snapshotType: 'panel_image_prompt',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      modelKey,
      promptTemplateId: 'panel-image-v2',
      promptHash: 'panel-image-prompt-hash',
      specHash: 'panel-image-spec-hash',
      inputHash: 'panel-image-input-hash',
      assetVersionHash: 'panel-image-assets-hash',
      referenceImages,
      promptSpec: { composition: 'fixed' },
      compiledPrompt,
      createdAt: '2026-08-03T00:00:00.000Z',
    },
    preparedAt: '2026-08-03T00:00:00.000Z',
  }
}

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
    runRuntimeMock.createArtifact.mockResolvedValue({ id: 'artifact-prompt-snapshot' })
    preparedPromptMock.requirePreparedPrompt.mockImplementation(async ({ artifactId }: { artifactId: string }) => {
      return buildPreparedPrompt({ artifactId })
    })

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
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

  it('缺少固定提示词版本时显式拒绝生成', async () => {
    await expect(handlePanelImageTask(buildJob({ candidateCount: 1 }))).rejects.toThrow(
      'PREPARED_PROMPT_REQUIRED: panel image generation requires a prepared prompt',
    )
    expect(preparedPromptMock.requirePreparedPrompt).not.toHaveBeenCalled()
  })

  it('严格使用固定快照提交所有分镜候选图', async () => {
    const prepared = buildPreparedPrompt({
      artifactId: 'prepared-panel-image-1',
      modelKey: 'frozen-storyboard-model',
      compiledPrompt: '这是已固定的分镜图提示词',
      referenceImages: ['cos/frozen-panel-reference.png'],
      generationOptions: { aspectRatio: '9:16', seed: 88 },
    })
    preparedPromptMock.requirePreparedPrompt.mockResolvedValueOnce(prepared)

    const result = await handlePanelImageTask(buildJob({
      candidateCount: 2,
      preparedPromptArtifactId: prepared.artifactId,
    }))

    expect(preparedPromptMock.requirePreparedPrompt).toHaveBeenCalledWith({
      artifactId: prepared.artifactId,
      projectId: 'project-1',
      targetId: 'panel-1',
      refId: 'panel-1',
      kind: 'panel_image',
      userId: 'user-1',
    })
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'frozen-storyboard-model',
        prompt: '这是已固定的分镜图提示词',
        allowTaskExternalIdResume: false,
        options: expect.objectContaining({
          referenceImages: ['https://signed.example/cos/frozen-panel-reference.png'],
          aspectRatio: '9:16',
          generationOptions: { aspectRatio: '9:16', seed: 88 },
        }),
      }),
    )
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: { promptSpec: { composition: 'fixed' } },
    })
    expect(qualityMock.persistPanelCandidatesAndScheduleReview).toHaveBeenCalledWith(expect.objectContaining({
      candidates: ['cos/panel-candidate-1.png', 'cos/panel-candidate-2.png'],
      isFirstGeneration: true,
    }))
    expect(result).toMatchObject({
      candidateCount: 2,
      preparedPromptArtifactId: prepared.artifactId,
      promptSnapshot: expect.objectContaining({
        compiledPrompt: '这是已固定的分镜图提示词',
        preparedPromptArtifactId: prepared.artifactId,
      }),
    })
  })

  it('重新生成保持旧图，并按候选数量下限生成候选图', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel-old.png',
    })
    utilsMock.resolveImageSourceFromGeneration
      .mockReset()
      .mockResolvedValueOnce('generated-source-regen-1')
      .mockResolvedValueOnce('generated-source-regen-2')
    utilsMock.uploadImageSourceToCos
      .mockReset()
      .mockResolvedValueOnce('cos/panel-regenerated-1.png')
      .mockResolvedValueOnce('cos/panel-regenerated-2.png')
    qualityMock.persistPanelCandidatesAndScheduleReview.mockResolvedValueOnce({
      imageUrl: null,
      mode: 'auto',
      versionHash: 'version-panel-2',
      reviewScheduled: true,
      reviewTaskId: 'task-quality-2',
    })

    const result = await handlePanelImageTask(buildJob({
      candidateCount: 1,
      preparedPromptArtifactId: 'prepared-panel-image-1',
    }))

    expect(result).toMatchObject({
      candidateCount: 2,
      imageUrl: null,
      visualQualityMode: 'auto',
    })
    expect(qualityMock.persistPanelCandidatesAndScheduleReview).toHaveBeenCalledWith(expect.objectContaining({
      candidates: ['cos/panel-regenerated-1.png', 'cos/panel-regenerated-2.png'],
      isFirstGeneration: false,
    }))
  })

  it('将实际使用的固定快照写入任务运行产物', async () => {
    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      runId: 'run-1',
      preparedPromptArtifactId: 'prepared-panel-image-1',
    }))

    expect(runRuntimeMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      artifactType: 'prompt.panel_image.snapshot',
      refId: 'panel-1',
      payload: expect.objectContaining({
        preparedPromptArtifactId: 'prepared-panel-image-1',
      }),
    }))
    expect(qualityMock.persistPanelCandidatesAndScheduleReview).toHaveBeenCalledWith(expect.objectContaining({
      promptSnapshot: expect.objectContaining({
        artifactId: 'artifact-prompt-snapshot',
        runId: 'run-1',
      }),
    }))
  })
})

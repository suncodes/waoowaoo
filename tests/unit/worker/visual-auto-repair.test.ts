import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVisualQualityState } from '@/lib/quality-workflow'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: { findUnique: vi.fn(), update: vi.fn(async () => undefined) },
}))
const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ analysisModel: 'google::gemini-3-flash-preview' })),
  resolveImageSourceFromGeneration: vi.fn(async () => 'generated-image-source'),
  uploadImageSourceToCos: vi.fn(async (_source: string, _prefix: string, key: string) => `${key}.png`),
}))
const sharedMock = vi.hoisted(() => ({
  collectPanelReferenceImages: vi.fn(async () => ['asset-reference.png']),
  resolveNovelData: vi.fn(async () => ({ videoRatio: '16:9' })),
}))
const taskMock = vi.hoisted(() => ({ submitTask: vi.fn(async () => ({ taskId: 'review-task-2' })) }))
const artifactMock = vi.hoisted(() => ({ createArtifact: vi.fn(async () => undefined) }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => sharedMock)
vi.mock('@/lib/visual-quality', () => ({ createVisualVersionHash: vi.fn(() => 'version-2') }))
vi.mock('@/lib/task/submitter', () => taskMock)
vi.mock('@/lib/run-runtime/service', () => artifactMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_VISUAL_AUTO_REPAIR: 'visual-auto-repair' },
  buildPrompt: vi.fn(() => 'repair-prompt'),
}))
vi.mock('@/lib/workers/handlers/planning-task-shared', () => ({
  readTaskRunId: vi.fn(() => 'run-repair-1'),
  toJsonRecord: (value: unknown) => value,
}))

import { handleVisualAutoRepairTask } from '@/lib/workers/handlers/visual-auto-repair'

function buildJob(versionHash = 'version-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-repair-1',
      type: TASK_TYPE.VISUAL_AUTO_REPAIR,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: {
        runId: 'run-repair-1',
        panelId: 'panel-1',
        versionHash,
        action: 'edit',
        sourceCandidateUrl: 'candidate-original.png',
        attempt: 1,
        imageModel: 'image::edit',
        targetSpec: { targetId: 'panel-1', aspectRatio: '16:9', intent: 'hero close-up' },
        promptPatch: { preserve: ['hero identity'], add: ['correct anatomy'] },
        candidateCount: 2,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker visual-auto-repair behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      imageUrl: 'approved-old.png',
      imagePrompt: 'base image prompt',
      description: 'hero close-up',
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'repairing',
        versionHash: 'version-1',
        candidateUrls: ['candidate-original.png'],
        attempt: 0,
        maxAttempts: 2,
      }),
    })
  })

  it('rejects stale repair work before spending another image generation', async () => {
    await expect(handleVisualAutoRepairTask(buildJob('stale-version'))).rejects.toThrow('VISUAL_VERSION_STALE')
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
  })

  it('persists an isolated repair candidate and schedules a fresh review', async () => {
    const result = await handleVisualAutoRepairTask(buildJob())

    expect(result).toEqual({
      panelId: 'panel-1',
      candidateUrls: ['panel-1-1-0.png', 'panel-1-1-1.png'],
      versionHash: 'version-2',
      attempt: 1,
      maxAttempts: 1,
    })
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(2)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'image::edit',
        options: expect.objectContaining({
          referenceImages: ['candidate-original.png', 'asset-reference.png'],
          aspectRatio: '16:9',
        }),
        allowTaskExternalIdResume: false,
      }),
    )
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        candidateImages: JSON.stringify(['candidate-original.png', 'panel-1-1-0.png', 'panel-1-1-1.png']),
        visualQualityState: expect.objectContaining({
          status: 'reviewing',
          versionHash: 'version-2',
          attempt: 1,
          activeCandidateUrl: 'approved-old.png',
          repairLineage: [expect.objectContaining({
            attempt: 1,
            repairVersionHash: 'version-2',
            scoreBefore: null,
          })],
        }),
      }),
    })
    expect(taskMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.VISUAL_QUALITY_REVIEW,
      payload: expect.objectContaining({
        candidateUrls: ['panel-1-1-0.png', 'panel-1-1-1.png'],
        versionHash: 'version-2',
        repairLineage: [expect.objectContaining({ repairVersionHash: 'version-2' })],
      }),
    }))
    expect(artifactMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactType: 'visual.repair.candidate',
      versionHash: 'version-2',
    }))
  })
})

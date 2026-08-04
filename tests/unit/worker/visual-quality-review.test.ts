import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVisualQualityState } from '@/lib/quality-workflow'
import { createVisualAutoRepairLineage } from '@/lib/creative-quality/contracts'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  novelPromotionProject: { findUnique: vi.fn() },
}))
const visualMock = vi.hoisted(() => ({
  decideVisualRepair: vi.fn(),
  review: {
    schemaVersion: 1 as const,
    versionHash: 'version-1',
    status: 'passed' as const,
    selectedCandidateIndex: 0,
    score: 95,
    confidence: 0.95,
    candidates: [{
      candidateIndex: 0,
      score: 95,
      confidence: 0.95,
      passed: true,
      strengths: ['composition'],
      issues: [],
    }],
    issueCodes: [],
    promptPatch: { preserve: [], add: [], remove: [], negative: [], rationale: '' },
    summary: 'passed',
  },
}))
const taskMock = vi.hoisted(() => ({ submitTask: vi.fn(async () => ({ taskId: 'repair-task-1' })) }))
const artifactMock = vi.hoisted(() => ({ createArtifact: vi.fn(async () => undefined) }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/visual-quality', () => ({
  assertVisionInputSupported: vi.fn(),
  createVisualVersionHash: vi.fn(() => 'version-1'),
  decideVisualRepair: visualMock.decideVisualRepair,
  enforceVisualQualityHardGates: vi.fn((review: unknown) => review),
  inspectVisualCandidates: vi.fn(async () => []),
  parseImageQualityReviewResult: vi.fn(() => visualMock.review),
}))
vi.mock('@/lib/workers/handlers/visual-quality-review-helpers', () => ({
  buildPanelImageTargetSpec: vi.fn(() => ({
    schemaVersion: 1,
    targetType: 'panel',
    targetId: 'panel-1',
    intent: 'hero close-up',
    aspectRatio: '16:9',
  })),
  mergeTechnicalChecks: vi.fn((review: unknown) => review),
  readCandidateUrls: vi.fn(() => []),
}))
vi.mock('@/lib/ai-runtime', () => ({ executeAiVisionStep: vi.fn(async () => ({ text: '{}' })) }))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, run: () => Promise<unknown>) => await run()),
}))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({})),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({ flush: vi.fn(async () => undefined) })),
}))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({
  resolveAnalysisModel: vi.fn(async () => 'google::gemini-3-flash-preview'),
}))
vi.mock('@/lib/task/submitter', () => taskMock)
vi.mock('@/lib/run-runtime/service', () => artifactMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: vi.fn(async () => undefined) }))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_VISUAL_QUALITY_REVIEW: 'visual-quality-review' },
  buildPrompt: vi.fn(() => 'visual-quality-prompt'),
}))

import { handleVisualQualityReviewTask } from '@/lib/workers/handlers/visual-quality-review'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-quality-1',
      type: TASK_TYPE.VISUAL_QUALITY_REVIEW,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: { runId: 'run-quality-1', panelId: 'panel-1', candidateUrls: ['candidate-1.png'] },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker visual-quality-review behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    visualMock.review.candidates[0].passed = true
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      imageUrl: null,
      previousImageUrl: null,
      candidateImages: JSON.stringify(['candidate-1.png']),
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'pending',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png'],
      }),
      linkedToNextPanel: false,
      storyboard: { episodeId: 'episode-1', episode: { productionBible: {} } },
    })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      videoProfile: { preset: 'ai_comic', qualityPolicy: { mode: 'auto' } },
      videoRatio: '16:9',
      artStyle: 'cinematic',
      artStylePrompt: null,
      analysisModel: 'google::gemini-3-flash-preview',
      editModel: 'image::edit',
      storyboardModel: 'image::storyboard',
    })
  })

  it('records an approved candidate as recommendation without committing the final image', async () => {
    visualMock.decideVisualRepair.mockReturnValue({
      action: 'approve',
      candidateIndex: 0,
      reason: 'quality threshold satisfied',
      promptPatch: visualMock.review.promptPatch,
    })

    const result = await handleVisualQualityReviewTask(buildJob())

    expect(result).toMatchObject({ panelId: 'panel-1', mode: 'auto', status: 'approved' })
    expect(prismaMock.novelPromotionPanel.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'panel-1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: expect.objectContaining({
        visualQualityState: expect.objectContaining({ status: 'approved', activeCandidateUrl: 'candidate-1.png' }),
      }),
    })
    expect(taskMock.submitTask).not.toHaveBeenCalled()
    expect(artifactMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactType: 'visual.quality.review',
      versionHash: 'version-1',
    }))
  })

  it('does not overwrite a manual approval completed while the review was running', async () => {
    const approvedState = createVisualQualityState({
      mode: 'auto',
      status: 'approved',
      versionHash: 'version-1',
      candidateUrls: ['candidate-1.png'],
      activeCandidateUrl: 'candidate-1.png',
      lastAction: 'select_candidate',
      humanConfirmedAt: '2026-07-22T10:00:00.000Z',
    })
    prismaMock.novelPromotionPanel.findUnique
      .mockResolvedValueOnce({
        id: 'panel-1',
        imageUrl: null,
        previousImageUrl: null,
        candidateImages: JSON.stringify(['candidate-1.png']),
        visualQualityState: createVisualQualityState({
          mode: 'auto',
          status: 'pending',
          versionHash: 'version-1',
          candidateUrls: ['candidate-1.png'],
        }),
        linkedToNextPanel: false,
        storyboard: { episodeId: 'episode-1', episode: { productionBible: {} } },
      })
      .mockResolvedValueOnce({ visualQualityState: approvedState })
    prismaMock.novelPromotionPanel.updateMany.mockResolvedValueOnce({ count: 0 })
    visualMock.decideVisualRepair.mockReturnValue({
      action: 'human_required',
      candidateIndex: 0,
      reason: 'manual review required',
      promptPatch: visualMock.review.promptPatch,
    })

    const result = await handleVisualQualityReviewTask(buildJob())

    expect(result).toMatchObject({ status: 'approved', superseded: true })
    expect(taskMock.submitTask).not.toHaveBeenCalled()
  })

  it('routes a repairable failure into a separate bounded repair task', async () => {
    visualMock.review.candidates[0].passed = false
    visualMock.decideVisualRepair.mockReturnValue({
      action: 'regenerate',
      candidateIndex: 0,
      reason: 'structural mismatch',
      promptPatch: { ...visualMock.review.promptPatch, add: ['restore the subject'] },
    })

    const result = await handleVisualQualityReviewTask(buildJob())

    expect(result).toMatchObject({ status: 'repairing' })
    expect(taskMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.VISUAL_AUTO_REPAIR,
      targetId: 'panel-1',
      payload: expect.objectContaining({
        runId: 'run-quality-1',
        action: 'regenerate',
        attempt: 1,
        versionHash: 'version-1',
        candidateCount: 2,
        scoreBefore: 95,
        repairLineage: [],
      }),
    }))
  })

  it('completes panel auto-repair lineage when a repaired candidate is approved', async () => {
    const lineage = createVisualAutoRepairLineage({
      targetType: 'panel',
      targetId: 'panel-1',
      attempt: 1,
      action: 'regenerate',
      candidateUrls: ['candidate-1.png'],
      previousVersionHash: 'version-0',
      repairVersionHash: 'version-1',
      scoreBefore: 58,
      promptPatch: { preserve: [], add: ['restore subject'], remove: [], negative: [], rationale: 'subject mismatch' },
      imageModel: 'image::storyboard',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      imageUrl: null,
      previousImageUrl: null,
      candidateImages: JSON.stringify(['candidate-1.png']),
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'reviewing',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png'],
        attempt: 1,
        maxAttempts: 2,
        repairLineage: [lineage],
      }),
      linkedToNextPanel: false,
      storyboard: { episodeId: 'episode-1', episode: { productionBible: {} } },
    })
    visualMock.decideVisualRepair.mockReturnValue({
      action: 'approve',
      candidateIndex: 0,
      reason: 'quality threshold satisfied',
      promptPatch: visualMock.review.promptPatch,
    })

    await handleVisualQualityReviewTask(buildJob())

    const updateManyCalls = prismaMock.novelPromotionPanel.updateMany.mock.calls as unknown as Array<[{
      data: { visualQualityState: { repairLineage: Array<Record<string, unknown>> } }
    }]>
    const updateArgs = updateManyCalls[updateManyCalls.length - 1][0]
    expect(updateArgs.data.visualQualityState.repairLineage[0]).toMatchObject({
      attempt: 1,
      repairVersionHash: 'version-1',
      scoreBefore: 58,
      scoreAfter: 95,
      accepted: true,
      acceptedCandidateUrl: 'candidate-1.png',
      stopReason: 'approved',
    })
    expect(artifactMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        repairLineage: [expect.objectContaining({
          scoreAfter: 95,
          accepted: true,
        })],
      }),
    }))
  })
})

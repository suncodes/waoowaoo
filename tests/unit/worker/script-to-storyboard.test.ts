import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionEpisode: { findUnique: vi.fn() },
}))
const orchestratorMock = vi.hoisted(() => vi.fn())
const buildVoiceRowsMock = vi.hoisted(() => vi.fn())
const persistStoryboardOutputsMock = vi.hoisted(() => vi.fn())
const createArtifactMock = vi.hoisted(() => vi.fn(async () => undefined))
const rebuildTimelineMock = vi.hoisted(() => vi.fn(async () => undefined))
const rebuildSpeechPlansMock = vi.hoisted(() => vi.fn(async () => ({ summary: {} })))
const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const workflowLeaseMock = vi.hoisted(() => ({
  assertWorkflowRunActive: vi.fn(async () => undefined),
  withWorkflowRunLease: vi.fn(async (params: { run: () => Promise<unknown> }) => ({
    claimed: true,
    result: await params.run(),
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => ({
  getUserWorkflowConcurrencyConfig: vi.fn(async () => ({ analysis: 1 })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({ reasoningEffort: 'high' })),
}))
vi.mock('@/lib/logging/semantic', () => ({ logAIAnalysis: vi.fn() }))
vi.mock('@/lib/logging/file-writer', () => ({ onProjectNameAvailable: vi.fn() }))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, run: () => Promise<unknown>) => await run()),
}))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({ flush: vi.fn(async () => undefined) })),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: {
    NP_AGENT_STORYBOARD_PLAN: 'plan',
    NP_AGENT_CINEMATOGRAPHER: 'cinematographer',
    NP_AGENT_ACTING_DIRECTION: 'acting',
    NP_AGENT_STORYBOARD_DETAIL: 'detail',
  },
  getPromptTemplate: vi.fn(() => 'prompt'),
}))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({
  resolveAnalysisModel: vi.fn(async () => 'llm::analysis-model'),
}))
vi.mock('@/lib/novel-promotion/script-to-storyboard/orchestrator', () => ({
  JsonParseError: class JsonParseError extends Error { rawText = '' },
  runScriptToStoryboardOrchestrator: orchestratorMock,
}))
vi.mock('@/lib/workers/handlers/script-to-storyboard-helpers', () => ({
  buildVoiceLineRowsFromClipPanels: buildVoiceRowsMock,
  parseEffort: vi.fn(() => null),
  parseTemperature: vi.fn(() => 0.7),
  persistStoryboardOutputs: persistStoryboardOutputsMock,
}))
vi.mock('@/lib/workers/handlers/script-to-storyboard-atomic-retry', () => ({
  parseStoryboardRetryTarget: vi.fn(() => null),
  runScriptToStoryboardAtomicRetry: vi.fn(),
}))
vi.mock('@/lib/novel-promotion/narration-timeline', () => ({ rebuildEpisodeNarrationTimeline: rebuildTimelineMock }))
vi.mock('@/lib/novel-promotion/speech-plan', () => ({ rebuildEpisodeSpeechPlans: rebuildSpeechPlansMock }))
vi.mock('@/lib/run-runtime/workflow-lease', () => workflowLeaseMock)
vi.mock('@/lib/run-runtime/service', () => ({ createArtifact: createArtifactMock }))

import { handleScriptToStoryboardTask } from '@/lib/workers/handlers/script-to-storyboard'

function buildJob(payload: Record<string, unknown>, episodeId: string | null = 'episode-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
      locale: 'zh',
      projectId: 'project-1',
      episodeId,
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload: { ...payload, runId: 'run-1' },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker script-to-storyboard speech contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findUnique.mockResolvedValue({ id: 'project-1', name: 'Project One' })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-model',
      characters: [],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'np-project-1',
      directorTreatment: null,
      productionBible: null,
      clips: [{
        id: 'clip-1',
        content: 'clip content',
        characters: '[]',
        location: null,
        props: null,
        screenplay: null,
        summary: 'clip summary',
      }],
    })
    orchestratorMock.mockResolvedValue({
      clipPanels: [{ clipId: 'clip-1', clipIndex: 0, finalPanels: [{ panel_number: 1 }] }],
      summary: { totalPanelCount: 1, totalStepCount: 4 },
    })
    buildVoiceRowsMock.mockReturnValue([{
      lineIndex: 1,
      speaker: '旁白',
      content: '镜头级台词。',
      emotionStrength: 0.2,
      matchedPanel: { storyboardId: 'clip-1', panelIndex: 0 },
    }])
    persistStoryboardOutputsMock.mockResolvedValue({
      persistedStoryboards: [{ storyboardId: 'storyboard-1' }],
      voiceLineCount: 1,
      panelSpeeches: [{
        id: 'speech-1',
        episodeId: 'episode-1',
        lineIndex: 1,
        speaker: '旁白',
        content: '镜头级台词。',
        matchedPanelId: 'panel-1',
      }],
    })
  })

  it('requires episodeId', async () => {
    await expect(handleScriptToStoryboardTask(buildJob({}, null))).rejects.toThrow('episodeId is required')
  })

  it('persists only storyboard-provided panel speech assignments', async () => {
    const result = await handleScriptToStoryboardTask(buildJob({ episodeId: 'episode-1' }))

    expect(result).toEqual({
      episodeId: 'episode-1',
      storyboardCount: 1,
      panelCount: 1,
      voiceLineCount: 1,
    })
    expect(persistStoryboardOutputsMock).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: 'episode-1',
      speechSource: 'storyboard',
      voiceLineRows: expect.arrayContaining([expect.objectContaining({
        matchedPanel: { storyboardId: 'clip-1', panelIndex: 0 },
      })]),
    }))
    expect(createArtifactMock).toHaveBeenCalledWith(expect.objectContaining({
      stepKey: 'voice_analyze',
      payload: expect.objectContaining({ source: 'storyboard' }),
    }))
  })

  it('rejects an incomplete storyboard contract instead of invoking legacy voice analysis', async () => {
    buildVoiceRowsMock.mockReturnValue(null)

    await expect(handleScriptToStoryboardTask(buildJob({ episodeId: 'episode-1' })))
      .rejects.toThrow('STORYBOARD_SPEECH_CONTRACT_MISSING')
    expect(persistStoryboardOutputsMock).not.toHaveBeenCalled()
  })

  it('rejects obsolete voice-analysis retries', async () => {
    await expect(handleScriptToStoryboardTask(buildJob({
      episodeId: 'episode-1',
      retryStepKey: 'voice_analyze',
    }))).rejects.toThrow('PANEL_SPEECH_REBUILD_REQUIRED')
  })
})

import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  novelPromotionEpisode: { findFirst: vi.fn() },
}))

const panelSpeechMock = vi.hoisted(() => ({
  listEpisodePanelSpeeches: vi.fn(),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const narrationTimelineMock = vi.hoisted(() => ({
  rebuildEpisodeNarrationTimeline: vi.fn(async () => undefined),
}))

const speechPlanMock = vi.hoisted(() => ({
  rebuildEpisodeSpeechPlans: vi.fn(async () => ({
    summary: {
      total: 1,
      ready: 1,
      invalid: 0,
      withSpeech: 1,
      silent: 0,
      missingVoiceSpeakers: [],
      warningCount: 0,
    },
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/novel-promotion/panel-speech', () => panelSpeechMock)
vi.mock('@/lib/novel-promotion/narration-timeline', () => narrationTimelineMock)
vi.mock('@/lib/novel-promotion/speech-plan', () => speechPlanMock)

import { handleVoiceAnalyzeTask } from '@/lib/workers/handlers/voice-analyze'

function buildJob(payload: Record<string, unknown>, episodeId: string | null = 'episode-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-voice-analyze-1',
      type: TASK_TYPE.VOICE_ANALYZE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId,
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker voice-analyze behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findUnique.mockResolvedValue({ id: 'project-1' })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      voiceLines: [],
    })
    panelSpeechMock.listEpisodePanelSpeeches.mockResolvedValue({
      available: true,
      speeches: [{ id: 'speech-1', speaker: '旁白', source: 'storyboard' }],
    })
  })

  it('missing episodeId -> explicit error', async () => {
    await expect(handleVoiceAnalyzeTask(buildJob({}, null))).rejects.toThrow('episodeId is required')
  })

  it('syncs canonical panel speech without invoking the legacy matcher', async () => {
    const result = await handleVoiceAnalyzeTask(buildJob({ episodeId: 'episode-1' }))

    expect(result).toEqual(expect.objectContaining({
      episodeId: 'episode-1',
      count: 1,
      matchedCount: 1,
      speakerStats: { 旁白: 1 },
    }))
    expect(narrationTimelineMock.rebuildEpisodeNarrationTimeline).toHaveBeenCalledWith('episode-1')
    expect(speechPlanMock.rebuildEpisodeSpeechPlans).toHaveBeenCalledWith('episode-1', 'storyboard')
  })

  it('accepts a canonical all-silent storyboard', async () => {
    panelSpeechMock.listEpisodePanelSpeeches.mockResolvedValue({
      available: true,
      speeches: [],
    })

    const result = await handleVoiceAnalyzeTask(buildJob({ episodeId: 'episode-1' }))

    expect(result).toEqual(expect.objectContaining({
      episodeId: 'episode-1',
      count: 0,
      matchedCount: 0,
      speakerStats: {},
    }))
  })

  it('requires a storyboard rebuild instead of rematching legacy voice lines', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      voiceLines: [{ id: 'legacy-line-1' }],
    })
    panelSpeechMock.listEpisodePanelSpeeches.mockResolvedValue({
      available: true,
      speeches: [],
    })

    await expect(handleVoiceAnalyzeTask(buildJob({ episodeId: 'episode-1' })))
      .rejects.toThrow('PANEL_SPEECH_REBUILD_REQUIRED')
    expect(narrationTimelineMock.rebuildEpisodeNarrationTimeline).not.toHaveBeenCalled()
  })
})

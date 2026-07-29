import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const parseSpeakerVoiceMapMock = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/prisma-error', () => ({ getPrismaErrorCode: vi.fn(() => null) }))
vi.mock('@/lib/voice/provider-voice-binding', () => ({
  hasAnyVoiceBinding: vi.fn(() => false),
  parseSpeakerVoiceMap: parseSpeakerVoiceMapMock,
}))

import { replaceEpisodePanelSpeeches } from '@/lib/novel-promotion/panel-speech'

describe('replaceEpisodePanelSpeeches', () => {
  const legacyDeleteManyMock = vi.fn(async () => undefined)
  const panelSpeechDeleteManyMock = vi.fn(async () => undefined)
  const panelSpeechCreateMock = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      speakerVoices: null,
      novelPromotionProject: {
        projectId: 'project-1',
        characters: [],
      },
      storyboards: [{
        clipId: 'clip-1',
        panels: [{
          id: 'panel-1',
          targetDurationMs: 4000,
        }],
      }],
    })
    prismaMock.$transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => await run({
      novelPromotionVoiceLine: {
        deleteMany: legacyDeleteManyMock,
      },
      novelPromotionPanelSpeech: {
        deleteMany: panelSpeechDeleteManyMock,
        create: panelSpeechCreateMock,
      },
    }))
  })

  it('clears legacy rows before replacing canonical panel speech', async () => {
    const result = await replaceEpisodePanelSpeeches({
      episodeId: 'episode-1',
      source: 'storyboard',
      assignments: [{
        panelId: 'panel-1',
        speaker: '旁白',
        content: '潜艇驶入幽暗海沟。',
        emotionStrength: 0.4,
      }],
    })

    expect(result).toEqual({ available: true, count: 1 })
    expect(legacyDeleteManyMock).toHaveBeenCalledWith({
      where: { episodeId: 'episode-1' },
    })
    expect(legacyDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      panelSpeechDeleteManyMock.mock.invocationCallOrder[0],
    )
    expect(panelSpeechCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        episodeId: 'episode-1',
        panelId: 'panel-1',
        speaker: '旁白',
        originalContent: '潜艇驶入幽暗海沟。',
      }),
    }))
  })
})

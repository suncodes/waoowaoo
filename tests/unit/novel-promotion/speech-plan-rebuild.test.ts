import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsertMock = vi.hoisted(() => vi.fn(async () => undefined))
const deleteManyMock = vi.hoisted(() => vi.fn(async () => undefined))
const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { rebuildEpisodeSpeechPlans } from '@/lib/novel-promotion/speech-plan'

describe('rebuildEpisodeSpeechPlans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      speakerVoices: null,
      novelPromotionProject: {
        projectId: 'project-1',
        characters: [],
      },
      voiceLines: [{
        id: 'line-1',
        lineIndex: 1,
        speaker: '旁白',
        content: '潜艇穿过海沟。',
        emotionPrompt: null,
        emotionStrength: 0.2,
        estimatedDurationMs: 1600,
        matchedPanelId: 'panel-1',
        matchedStoryboardId: 'storyboard-1',
        matchedPanelIndex: 0,
      }],
      storyboards: [{
        id: 'storyboard-1',
        clipId: 'clip-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        clip: {
          start: 0,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        panels: [{
          id: 'panel-1',
          storyboardId: 'storyboard-1',
          panelIndex: 0,
          duration: 4,
          targetDurationMs: 4000,
          speechPlan: {
            source: 'storyboard',
            linesJson: [{
              voiceLineId: 'line-1',
              voiceLineIds: ['line-1'],
              lineIndex: 1,
              order: 1,
              speaker: '旁白',
              content: '潜艇穿过海沟。',
              estimatedDurationMs: 1600,
              deliveryContent: '潜艇驶过幽暗海沟。',
              deliveryDurationMs: 1500,
              deliverySource: 'manual_delivery_generation',
            }],
          },
        }],
      }],
    })
    prismaMock.$transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => await run({
      novelPromotionPanelSpeechPlan: {
        deleteMany: deleteManyMock,
        upsert: upsertMock,
      },
    }))
  })

  it('preserves delivery text and storyboard provenance when the source line is unchanged', async () => {
    const result = await rebuildEpisodeSpeechPlans('episode-1', 'speaker_voice_update')

    expect(result.available).toBe(true)
    expect(result.plans[0]).toEqual(expect.objectContaining({ source: 'storyboard' }))
    expect(result.plans[0]?.linesJson[0]).toEqual(expect.objectContaining({
      deliveryContent: '潜艇驶过幽暗海沟。',
      deliveryDurationMs: 1500,
    }))
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ source: 'storyboard' }),
    }))
  })
})

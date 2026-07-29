import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      novelPromotionProject: {
        projectId: 'project-1',
      },
      voiceLines: [{
        id: 'line-1',
        matchedPanelId: 'panel-1',
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
          panelSpeech: {
            id: 'speech-1',
            speaker: '旁白',
            originalContent: '潜艇穿过海沟。',
            deliveryContent: '潜艇驶过幽暗海沟。',
            estimatedDurationMs: 1500,
            emotionPrompt: null,
            emotionStrength: 0.2,
            voiceConfigJson: {
              speaker: '旁白',
              hasVoice: true,
              source: 'speaker',
              provider: 'fal',
            },
            warningsJson: [],
            status: 'ready',
            source: 'storyboard',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        }],
      }],
    })
  })

  it('projects canonical panel speech without writing the legacy speech-plan table', async () => {
    const result = await rebuildEpisodeSpeechPlans('episode-1', 'speaker_voice_update')

    expect(result.available).toBe(true)
    expect(result.plans[0]).toEqual(expect.objectContaining({ source: 'storyboard' }))
    expect(result.plans[0]?.linesJson[0]).toEqual(expect.objectContaining({
      deliveryContent: '潜艇驶过幽暗海沟。',
      deliveryDurationMs: 1500,
    }))
  })
})

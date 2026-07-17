import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentPlanResult } from '@/lib/content-planning'

const txMock = vi.hoisted(() => ({
  novelPromotionEpisode: { update: vi.fn(async () => undefined) },
  novelPromotionClip: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(async () => ({ id: 'clip-1' })),
  },
}))
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { persistContentPlan } from '@/lib/workers/handlers/content-plan-helpers'

function buildGuideResult(): ContentPlanResult {
  return {
    creativeBrief: {
      schemaVersion: 1,
      profilePreset: 'book_guide',
      objective: 'guide',
      audience: 'readers',
      audiencePromise: 'understand the book',
      targetDurationSec: 180,
      tone: [],
      mustInclude: [],
      mustAvoid: [],
    },
    contentPlan: {
      schemaVersion: 1,
      planType: 'guide',
      title: 'Guide',
      thesis: 'Thesis',
      recommendationAngle: 'Angle',
      outline: [{ id: 'outline-1', title: 'Point', question: 'Why', takeaway: 'Answer' }],
      segments: [{
        id: 'segment-1',
        outlineId: 'outline-1',
        title: 'Point',
        narration: 'Narration',
        visualPurpose: 'Explain',
        visualHints: [],
        estimatedDurationSec: 20,
        spoilerLevel: 'light',
        sourceAnchor: { label: 'Chapter 1' },
      }],
    },
    contentReview: {
      schemaVersion: 1,
      status: 'approved',
      score: 90,
      profileFitScore: 90,
      sourceSupportScore: 90,
      issues: [],
      revisionInstructions: [],
    },
  }
}

describe('content plan persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (run: (tx: typeof txMock) => Promise<unknown>) => await run(txMock))
  })

  it('stores blocked review evidence without replacing downstream guide clips', async () => {
    await persistContentPlan({
      episodeId: 'episode-1',
      result: buildGuideResult(),
      commitGuideClips: false,
    })

    expect(txMock.novelPromotionEpisode.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'episode-1' },
    }))
    expect(txMock.novelPromotionClip.deleteMany).not.toHaveBeenCalled()
    expect(txMock.novelPromotionClip.create).not.toHaveBeenCalled()
  })

  it('replaces guide clips only after the content review passes', async () => {
    await persistContentPlan({
      episodeId: 'episode-1',
      result: buildGuideResult(),
      commitGuideClips: true,
    })

    expect(txMock.novelPromotionClip.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 'episode-1' } })
    expect(txMock.novelPromotionClip.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        episodeId: 'episode-1',
        summary: 'Point',
        duration: 20,
      }),
    }))
  })
})

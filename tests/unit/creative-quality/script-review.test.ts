import { describe, expect, it } from 'vitest'
import { reviewScriptDraftQuality } from '@/lib/creative-quality/script-review'

describe('script draft quality review', () => {
  it('passes a sourced screenplay with matched natural voice lines', () => {
    const review = reviewScriptDraftQuality({
      episodeId: 'episode-1',
      clips: [{
        id: 'clip-1',
        episodeId: 'episode-1',
        content: '主角推开门，看见雨夜里的证据。',
        screenplay: JSON.stringify({
          original_text: '主角推开门，看见雨夜里的证据。',
          scenes: [{
            scene: '雨夜门口',
            action: '主角推开门，看到地上的证据。',
            dialogue: '原来问题一直在这里。',
          }],
        }),
      }],
      voiceLines: [{
        id: 'voice-1',
        episodeId: 'episode-1',
        lineIndex: 0,
        speaker: '旁白',
        content: '他推开门，终于看见真正的证据。',
        matchedPanelId: 'panel-1',
      }],
      reviewedAt: '2026-07-23T00:00:00.000Z',
    })

    expect(review).toMatchObject({
      targetId: 'episode-1',
      targetType: 'script',
      reviewKind: 'script_draft',
      status: 'passed',
      route: 'NONE',
      clipCount: 1,
      screenplayCount: 1,
      voiceLineCount: 1,
    })
    expect(review.score).toBeGreaterThanOrEqual(82)
  })

  it('routes missing screenplay and weak voice copy to script revision', () => {
    const review = reviewScriptDraftQuality({
      episodeId: 'episode-2',
      clips: [{
        id: 'clip-1',
        episodeId: 'episode-2',
        content: '原文片段',
        screenplay: null,
      }],
      voiceLines: [
        {
          id: 'voice-1',
          episodeId: 'episode-2',
          lineIndex: 0,
          speaker: '旁白',
          content: '这是一条非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长且没有任何自然停顿的口播内容',
          matchedPanelId: null,
        },
        {
          id: 'voice-2',
          episodeId: 'episode-2',
          lineIndex: 1,
          speaker: '旁白',
          content: '这是一条非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长且没有任何自然停顿的口播内容',
          matchedPanelId: null,
        },
      ],
      reviewedAt: '2026-07-23T00:00:00.000Z',
    })

    expect(review.status).toBe('human_required')
    expect(review.route).toBe('SCRIPT_REVISE')
    expect(review.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'structure', targetId: 'clip-1' }),
      expect.objectContaining({ dimension: 'voice', targetId: 'voice-1' }),
      expect.objectContaining({ dimension: 'stability', targetId: 'voice-2' }),
      expect.objectContaining({ dimension: 'visualization', targetId: 'voice-1' }),
    ]))
  })
})

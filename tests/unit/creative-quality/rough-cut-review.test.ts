import { describe, expect, it } from 'vitest'
import { createVisualQualityState } from '@/lib/quality-workflow'
import { reviewRoughCutQuality } from '@/lib/creative-quality/rough-cut-review'

describe('rough cut quality review', () => {
  it('passes a traceable assembled episode', () => {
    const review = reviewRoughCutQuality({
      episodeId: 'episode-1',
      storyboards: [{
        id: 'storyboard-1',
        panels: [{
          id: 'panel-1',
          storyboardId: 'storyboard-1',
          panelIndex: 0,
          panelNumber: 1,
          description: '主角看向窗外',
          imagePrompt: '主角站在窗前',
          videoPrompt: '轻微转头',
          imageUrl: 'panel-1.png',
          videoUrl: 'panel-1.mp4',
          duration: 5,
          visualQualityState: createVisualQualityState({
            mode: 'auto',
            status: 'approved',
            versionHash: 'visual-1',
            candidateUrls: ['panel-1.png'],
            activeCandidateUrl: 'panel-1.png',
          }),
        }],
      }],
      voiceLines: [{
        id: 'voice-1',
        lineIndex: 0,
        content: '他终于意识到问题不在窗外。',
        audioUrl: 'voice-1.wav',
        audioDuration: 4800,
        matchedPanelId: 'panel-1',
      }],
      promptSnapshots: [
        { artifactType: 'prompt.panel_image.snapshot', refId: 'panel-1', payload: { targetId: 'panel-1' } },
        { artifactType: 'prompt.panel_video.snapshot', refId: 'panel-1', payload: { targetId: 'panel-1' } },
      ],
      reviewedAt: '2026-07-23T00:00:00.000Z',
    })

    expect(review).toMatchObject({
      targetId: 'episode-1',
      targetType: 'video',
      reviewKind: 'rough_cut',
      status: 'passed',
      route: 'NONE',
      panelCount: 1,
      voiceLineCount: 1,
      pickupItems: [],
    })
    expect(review.score).toBeGreaterThanOrEqual(85)
  })

  it('routes concrete pickup items to the layer that can fix them', () => {
    const review = reviewRoughCutQuality({
      episodeId: 'episode-2',
      storyboards: [{
        id: 'storyboard-1',
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          panelNumber: 1,
          description: '主角站在门口',
          imagePrompt: '主角站在门口',
          imageUrl: 'panel-1.png',
          videoUrl: null,
          duration: 18,
          visualQualityState: createVisualQualityState({
            mode: 'auto',
            status: 'human_required',
            versionHash: 'visual-1',
            candidateUrls: ['panel-1.png'],
          }),
        }],
      }],
      voiceLines: [{
        id: 'voice-1',
        lineIndex: 0,
        content: '一句很短的旁白。',
        audioUrl: null,
        audioDuration: 2000,
        matchedPanelId: null,
      }],
      promptSnapshots: [],
      reviewedAt: '2026-07-23T00:00:00.000Z',
    })

    expect(review.status).toBe('human_required')
    expect(review.route).toBe('HUMAN_REQUIRED')
    expect(review.pickupItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'assembly', route: 'VIDEO_REGENERATE', panelId: 'panel-1' }),
      expect.objectContaining({ category: 'visual_quality', route: 'HUMAN_REQUIRED', panelId: 'panel-1' }),
      expect.objectContaining({ category: 'prompt_trace', route: 'PROMPT_RECOMPILE', panelId: 'panel-1' }),
      expect.objectContaining({ category: 'voice_alignment', route: 'VOICE_REGENERATE', targetId: 'voice-1' }),
      expect.objectContaining({ category: 'timing', route: 'SHOT_REPLAN', panelId: 'panel-1' }),
    ]))
  })
})

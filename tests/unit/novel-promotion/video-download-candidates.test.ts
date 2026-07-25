import { describe, expect, it } from 'vitest'
import { collectOrderedVideoCandidates } from '@/lib/novel-promotion/video-download-candidates'

describe('collectOrderedVideoCandidates', () => {
  it('prefers raw panel video when timeline narration audio is applied', () => {
    const candidates = collectOrderedVideoCandidates([
      {
        clips: [{ id: 'clip-1' }],
        storyboards: [
          {
            id: 'storyboard-1',
            clipId: 'clip-1',
            panels: [
              {
                panelIndex: 0,
                description: '镜头一',
                videoUrl: 'raw.mp4',
                audioMixedVideoUrl: 'mixed.mp4',
                lipSyncVideoUrl: null,
              },
            ],
          },
        ],
      },
    ], {}, { preferRawVideo: true })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].videoUrl).toBe('raw.mp4')
    expect(candidates[0].sourceType).toBe('raw')
  })

  it('keeps processed-video priority for legacy merge without timeline audio', () => {
    const candidates = collectOrderedVideoCandidates([
      {
        clips: [{ id: 'clip-1' }],
        storyboards: [
          {
            id: 'storyboard-1',
            clipId: 'clip-1',
            panels: [
              {
                panelIndex: 0,
                description: '镜头一',
                videoUrl: 'raw.mp4',
                audioMixedVideoUrl: 'mixed.mp4',
                lipSyncVideoUrl: null,
              },
            ],
          },
        ],
      },
    ])

    expect(candidates).toHaveLength(1)
    expect(candidates[0].videoUrl).toBe('mixed.mp4')
    expect(candidates[0].sourceType).toBe('audio_mixed')
  })
})

import { describe, expect, it } from 'vitest'
import { buildVoiceLineRowsFromClipPanels } from '@/lib/workers/handlers/script-to-storyboard-helpers'

describe('script-to-storyboard direct speech lines', () => {
  it('uses the storyboard panel as the semantic voice binding for its one spoken line', () => {
    const rows = buildVoiceLineRowsFromClipPanels([
      {
        clipId: 'clip-1',
        clipIndex: 0,
        finalPanels: [
          {
            speech: { speaker: '旁白', content: '潜艇穿过海沟。', emotion_strength: 0.15 },
          },
          { speech: null },
        ],
      },
    ])

    expect(rows).toEqual([
      {
        lineIndex: 1,
        speaker: '旁白',
        content: '潜艇穿过海沟。',
        emotionStrength: 0.15,
        matchedPanel: {
          storyboardId: 'clip-1',
          panelIndex: 0,
        },
      },
    ])
  })

  it('falls back to voice analysis when any panel omits speech', () => {
    expect(buildVoiceLineRowsFromClipPanels([
      {
        clipId: 'clip-1',
        clipIndex: 0,
        finalPanels: [{}],
      },
    ])).toBeNull()
  })
})

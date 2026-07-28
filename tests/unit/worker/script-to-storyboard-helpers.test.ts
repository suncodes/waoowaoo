import { describe, expect, it } from 'vitest'
import { buildVoiceLineRowsFromClipPanels } from '@/lib/workers/handlers/script-to-storyboard-helpers'

describe('script-to-storyboard direct speech lines', () => {
  it('uses the storyboard panel as the semantic voice binding and merges continuous speakers', () => {
    const rows = buildVoiceLineRowsFromClipPanels([
      {
        clipId: 'clip-1',
        clipIndex: 0,
        finalPanels: [
          {
            speech_lines: [
              { speaker: '旁白', content: '潜艇穿过海沟。', emotion_strength: 0.15 },
              { speaker: '旁白', content: '阴影随即逼近。', emotion_strength: 0.3 },
            ],
          },
          { speech_lines: [] },
        ],
      },
    ])

    expect(rows).toEqual([
      {
        lineIndex: 1,
        speaker: '旁白',
        content: '潜艇穿过海沟。阴影随即逼近。',
        emotionStrength: 0.3,
        matchedPanel: {
          storyboardId: 'clip-1',
          panelIndex: 0,
        },
      },
    ])
  })

  it('falls back to legacy voice analysis when any panel omits speech_lines', () => {
    expect(buildVoiceLineRowsFromClipPanels([
      {
        clipId: 'clip-1',
        clipIndex: 0,
        finalPanels: [{}],
      },
    ])).toBeNull()
  })
})

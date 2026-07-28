import { describe, expect, it } from 'vitest'
import { resolveVoiceLinePanelBindings } from '@/lib/novel-promotion/voice-line-binding'

describe('voice line panel binding', () => {
  it('prefers the semantic storyboard binding over a conflicting timeline panel', () => {
    const bindings = resolveVoiceLinePanelBindings({
      matchedStoryboardId: 'storyboard-2',
      matchedPanelIndex: 1,
      matchedPanelId: 'panel-from-timeline',
      panelSpans: [{ panelId: 'panel-from-timeline' }],
    })

    expect(bindings).toEqual([{ storyboardId: 'storyboard-2', panelIndex: 1 }])
  })

  it('uses timeline spans only when semantic binding is unavailable', () => {
    const bindings = resolveVoiceLinePanelBindings({
      panelSpans: [
        { panelId: 'panel-1' },
        { panel: { storyboardId: 'storyboard-2', panelIndex: 0 } },
      ],
    })

    expect(bindings).toEqual([
      { panelId: 'panel-1' },
      { storyboardId: 'storyboard-2', panelIndex: 0 },
    ])
  })
})

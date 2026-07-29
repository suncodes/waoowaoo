import { describe, expect, it } from 'vitest'
import {
  buildAssDocument,
  buildSrtDocument,
  buildSubtitleTrackDraft,
  type SubtitlePanelSource,
  type SubtitleVideoSegment,
} from '@/lib/novel-promotion/subtitle-track'

function createPanels(): SubtitlePanelSource[] {
  return [
    {
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      duration: 4,
      targetDurationMs: 4000,
      speech: {
        id: 'speech-1',
        originalContent: '这是原始文稿中的长句。',
        deliveryContent: '水下传来低沉回响。',
        estimatedDurationMs: 4000,
        updatedAt: new Date('2026-07-28T00:00:00.000Z'),
      },
    },
    {
      id: 'panel-2',
      storyboardId: 'storyboard-1',
      panelIndex: 1,
      duration: 6,
      targetDurationMs: 6000,
      speech: {
        id: 'speech-2',
        originalContent: '潜艇驶入更深的海沟。',
        deliveryContent: null,
        estimatedDurationMs: 6000,
        updatedAt: new Date('2026-07-28T00:00:00.000Z'),
      },
    },
  ]
}

function createSegments(firstVideoUrl = 'panel-1.mp4'): SubtitleVideoSegment[] {
  return [
    {
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      videoUrl: firstVideoUrl,
      durationMs: 4000,
    },
    {
      storyboardId: 'storyboard-1',
      panelIndex: 1,
      videoUrl: 'panel-2.mp4',
      durationMs: 6000,
    },
  ]
}

describe('subtitle track', () => {
  it('uses delivery content and keeps each panel speech inside its assigned panel', () => {
    const draft = buildSubtitleTrackDraft({
      segments: createSegments(),
      panels: createPanels(),
    })

    expect(draft.cues).toHaveLength(2)
    expect(draft.cues.map((cue) => ({ text: cue.text, startMs: cue.startMs, endMs: cue.endMs }))).toEqual([
      { text: '水下传来低沉回响。', startMs: 0, endMs: 4000 },
      { text: '潜艇驶入更深的海沟。', startMs: 4000, endMs: 10000 },
    ])
    expect(draft.cues.every((cue) => !cue.text.includes('旁白'))).toBe(true)
  })

  it('changes the track source fingerprint when the selected video changes', () => {
    const panels = createPanels()
    const initial = buildSubtitleTrackDraft({ segments: createSegments(), panels })
    const changed = buildSubtitleTrackDraft({ segments: createSegments('panel-1-new.mp4'), panels })

    expect(changed.sourceVideoHash).not.toBe(initial.sourceVideoHash)
    expect(changed.sourceSpeechHash).toBe(initial.sourceSpeechHash)
  })

  it('renders SRT and ASS without speaker labels', () => {
    const draft = buildSubtitleTrackDraft({
      segments: createSegments(),
      panels: createPanels(),
      style: {
        preset: 'boxed',
        position: 'top',
        fontSize: 48,
        fontColor: '#FFFFFF',
        outlineColor: '#151515',
        outlineWidth: 3,
        backgroundOpacity: 0.55,
        verticalOffset: 0,
      },
    })
    const srt = buildSrtDocument(draft.cues)
    const ass = buildAssDocument({ cues: draft.cues, style: draft.style, width: 720, height: 1280 })

    expect(srt).toContain('00:00:00,000 --> 00:00:04,000')
    expect(srt).toContain('水下传来低沉回响。')
    expect(srt).not.toContain('旁白：')
    expect(ass).toContain('Style: Default,Noto Sans CJK SC,48')
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:04.00')
    expect(ass).not.toContain('尼摩：')
  })
})

import { describe, expect, it } from 'vitest'
import type { NovelPromotionPanel } from '@/types/project'
import {
  panelLinkedToNext,
  panelVideoUrl,
  resolveVideoStatus,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/studio/studio-produce-model'

function panel(overrides: Partial<NovelPromotionPanel> = {}): NovelPromotionPanel {
  return {
    id: 'panel-1',
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    panelNumber: 1,
    shotType: null,
    cameraMove: null,
    description: null,
    characters: null,
    location: null,
    props: null,
    srtSegment: null,
    srtStart: null,
    srtEnd: null,
    duration: null,
    imagePrompt: null,
    imageUrl: null,
    candidateImages: null,
    media: null,
    imageHistory: null,
    videoPrompt: null,
    videoUrl: null,
    videoMedia: null,
    lipSyncVideoUrl: null,
    lipSyncVideoMedia: null,
    sketchImageUrl: null,
    photographyRules: null,
    actingNotes: null,
    imageTaskRunning: false,
    videoTaskRunning: false,
    imageErrorMessage: null,
    ...overrides,
  }
}

describe('studio video production model', () => {
  it('prefers lip sync output for preview when available', () => {
    expect(panelVideoUrl(panel({ videoUrl: 'base.mp4', lipSyncVideoUrl: 'lip.mp4' }))).toBe('lip.mp4')
  })

  it('recovers generating state from persisted panel task state', () => {
    expect(resolveVideoStatus(panel({ imageUrl: 'frame.png', videoTaskRunning: true }))).toBe('generating')
  })

  it('reads persisted first-last-frame link state', () => {
    const linkedPanel = panel() as NovelPromotionPanel & { linkedToNextPanel: boolean }
    linkedPanel.linkedToNextPanel = true
    expect(panelLinkedToNext(linkedPanel)).toBe(true)
  })
})

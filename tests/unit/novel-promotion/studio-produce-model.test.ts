import { describe, expect, it } from 'vitest'
import type { NovelPromotionPanel } from '@/types/project'
import {
  buildBatchVideoPreflight,
  panelLinkedToNext,
  panelVideoUrl,
  resolveImageStatus,
  resolveVideoStatus,
  resolveVoiceStatus,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/studio/studio-produce-model'
import type { ProduceItem } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/studio/studio-produce-model'
import { createVisualQualityState } from '@/lib/quality-workflow'

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

  it('does not report a human-required image as confirmed', () => {
    expect(resolveImageStatus(panel({
      imageUrl: 'frame.png',
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'human_required',
        versionHash: 'version-1',
        candidateUrls: ['frame.png'],
      }),
    }))).toBe('needs_review')
  })

  it('prechecks normal and first-last-frame batch targets independently', () => {
    const readyState = createVisualQualityState({
      mode: 'auto',
      status: 'approved',
      versionHash: 'version-ready',
      candidateUrls: ['frame.png'],
      humanConfirmedAt: '2026-07-22T10:00:00.000Z',
    })
    const items = [0, 1, 2].map((index): ProduceItem => ({
      id: `panel-${index + 1}`,
      number: index + 1,
      storyboard: { id: 'storyboard-1' } as ProduceItem['storyboard'],
      panel: panel({
        id: `panel-${index + 1}`,
        panelIndex: index,
        imageUrl: `frame-${index + 1}.png`,
        visualQualityState: readyState,
      }),
    }))
    const links = new Map<string, boolean>([
      ['storyboard-1-0', true],
      ['storyboard-1-1', false],
    ])

    expect(buildBatchVideoPreflight(items, links, 'normal')).toMatchObject({
      eligibleCount: 3,
      skippedCount: 0,
    })
    expect(buildBatchVideoPreflight(items, links, 'firstlastframe')).toMatchObject({
      eligibleCount: 1,
      skippedCount: 2,
      reasonCounts: {
        not_linked: 1,
        last_panel: 1,
      },
    })

    items[0].panel.candidateImages = JSON.stringify(['frame-1.png', 'frame-1-alt.png'])
    items[0].panel.visualQualityState = createVisualQualityState({
      mode: 'auto',
      status: 'approved',
      versionHash: 'version-unconfirmed',
      candidateUrls: ['frame-1.png', 'frame-1-alt.png'],
    })
    expect(buildBatchVideoPreflight(items, links, 'normal')).toMatchObject({
      eligibleCount: 2,
      reasonCounts: { quality_not_ready: 1 },
    })
  })

  it('does not block video generation when lines have no speech plan', () => {
    const readyState = createVisualQualityState({
      mode: 'auto',
      status: 'approved',
      versionHash: 'version-ready',
      candidateUrls: ['frame.png'],
      humanConfirmedAt: '2026-07-22T10:00:00.000Z',
    })
    const item: ProduceItem = {
      id: 'panel-1',
      number: 1,
      storyboard: { id: 'storyboard-1' } as ProduceItem['storyboard'],
      panel: panel({
        id: 'panel-1',
        panelIndex: 0,
        imageUrl: 'frame.png',
        visualQualityState: readyState,
        speechPlan: null,
      }),
    }
    const links = new Map<string, boolean>()

    expect(buildBatchVideoPreflight([item], links, 'normal')).toMatchObject({
      eligibleCount: 1,
      skippedCount: 0,
    })
    expect(resolveVoiceStatus(item.panel, { hasVoiceLines: true })).toBe('locked')
  })

  it('does not block video generation when panels have no matched voice lines', () => {
    const readyState = createVisualQualityState({
      mode: 'auto',
      status: 'approved',
      versionHash: 'version-ready',
      candidateUrls: ['frame.png'],
      humanConfirmedAt: '2026-07-22T10:00:00.000Z',
    })
    const item: ProduceItem = {
      id: 'panel-1',
      number: 1,
      storyboard: { id: 'storyboard-1' } as ProduceItem['storyboard'],
      panel: panel({
        id: 'panel-1',
        panelIndex: 0,
        imageUrl: 'frame.png',
        visualQualityState: readyState,
        speechPlan: null,
      }),
    }
    const links = new Map<string, boolean>()

    expect(buildBatchVideoPreflight([item], links, 'normal')).toMatchObject({
      eligibleCount: 1,
      skippedCount: 0,
    })
    expect(resolveVoiceStatus(item.panel, { hasVoiceLines: false })).toBe('empty')
  })
})

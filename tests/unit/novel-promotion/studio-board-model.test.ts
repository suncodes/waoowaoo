import { describe, expect, it } from 'vitest'
import type { NovelPromotionPanel } from '@/types/project'
import { createVisualQualityState } from '@/lib/quality-workflow'
import type { StoryboardPanel } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardState'
import {
  isPanelReadyForProduction,
  resolvePanelStatus,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/studio/studio-board-model'

function sourcePanel(status: 'approved' | 'human_required', humanConfirmedAt?: string): NovelPromotionPanel {
  return {
    id: 'panel-1',
    imageUrl: 'frame.png',
    imageTaskRunning: false,
    imageErrorMessage: null,
    visualQualityState: createVisualQualityState({
      mode: 'auto',
      status,
      versionHash: 'version-1',
      candidateUrls: ['frame.png'],
      humanConfirmedAt,
    }),
  } as NovelPromotionPanel
}

const panel = {
  id: 'panel-1',
  imageUrl: 'frame.png',
  description: 'shot',
} as StoryboardPanel

describe('studio storyboard readiness', () => {
  it('keeps a human-required panel in review state', () => {
    const source = sourcePanel('human_required')

    expect(resolvePanelStatus({
      panel,
      sourcePanel: source,
      hasCandidates: false,
      submitting: false,
      modifying: false,
    })).toBe('needs_review')
    expect(isPanelReadyForProduction({
      panel,
      sourcePanel: source,
      hasCandidates: false,
      submitting: false,
      modifying: false,
    })).toBe(false)
  })

  it('keeps a machine-approved panel blocked until human confirmation', () => {
    const source = sourcePanel('approved')

    expect(resolvePanelStatus({
      panel,
      sourcePanel: source,
      hasCandidates: false,
      submitting: false,
      modifying: false,
    })).toBe('needs_review')
    expect(isPanelReadyForProduction({
      panel,
      sourcePanel: source,
      hasCandidates: false,
      submitting: false,
      modifying: false,
    })).toBe(false)
  })

  it('keeps retained candidates switchable without blocking a human-confirmed panel', () => {
    const source = sourcePanel('approved', '2026-07-22T10:00:00.000Z')

    expect(resolvePanelStatus({
      panel,
      sourcePanel: source,
      hasCandidates: true,
      submitting: false,
      modifying: false,
    })).toBe('locked')
    expect(isPanelReadyForProduction({
      panel,
      sourcePanel: source,
      hasCandidates: true,
      submitting: false,
      modifying: false,
    })).toBe(true)
  })
})

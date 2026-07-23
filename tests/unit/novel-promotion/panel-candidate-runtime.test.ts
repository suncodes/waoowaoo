import { describe, expect, it } from 'vitest'
import type { NovelPromotionPanel } from '@/types/project'
import { createVisualQualityState } from '@/lib/quality-workflow'
import {
  ensurePanelCandidatesInitialized,
  getPanelCandidatesFromRuntime,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/panel-candidate-runtime'

const candidateSystem = {
  getCandidateState: () => null,
  clearCandidates: () => undefined,
  initCandidates: () => undefined,
}

function panel(overrides: Partial<NovelPromotionPanel>): NovelPromotionPanel {
  return {
    id: 'panel-1',
    candidateImages: null,
    ...overrides,
  } as NovelPromotionPanel
}

describe('panel candidate runtime', () => {
  it('recovers candidates from a human-required quality state', () => {
    const result = getPanelCandidatesFromRuntime(panel({
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'human_required',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png', 'candidate-2.png'],
      }),
    }), candidateSystem)

    expect(result?.candidates).toEqual(['candidate-1.png', 'candidate-2.png'])
    expect(result?.selectedIndex).toBe(0)
    expect(result?.groups[0]?.label).toBe('原始候选')
  })

  it('keeps candidates visible while automatic review is running', () => {
    const result = getPanelCandidatesFromRuntime(panel({
      candidateImages: JSON.stringify(['candidate-1.png']),
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'reviewing',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png'],
      }),
    }), candidateSystem)

    expect(result?.candidates).toEqual(['candidate-1.png'])
    expect(result?.selectedIndex).toBe(0)
    expect(result?.groups[0]?.label).toBe('原始候选')
  })

  it('keeps candidates visible after human confirmation', () => {
    const result = getPanelCandidatesFromRuntime(panel({
      imageUrl: 'candidate-2.png',
      candidateImages: JSON.stringify(['candidate-1.png', 'candidate-2.png']),
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'approved',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png', 'candidate-2.png'],
        activeCandidateUrl: 'candidate-2.png',
        humanConfirmedAt: '2026-07-22T10:00:00.000Z',
      }),
    }), candidateSystem)

    expect(result?.candidates).toEqual(['candidate-1.png', 'candidate-2.png'])
  })

  it('restores the confirmed candidate index after media URLs are signed', () => {
    let initializedIndex = -1
    const runtime = {
      ...candidateSystem,
      initCandidates: (
        _id: string,
        _originalUrl: string | null,
        _candidates: string[],
        _previousUrl: string | null,
        selectedIndex = 0,
      ) => {
        initializedIndex = selectedIndex
      },
    }
    const sourcePanel = panel({
      imageUrl: 'https://media.test/candidate-2.png?expires=current',
      candidateImages: JSON.stringify([
        'https://media.test/candidate-1.png?expires=candidates',
        'https://media.test/candidate-2.png?expires=candidates',
      ]),
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'approved',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png', 'candidate-2.png'],
        activeCandidateUrl: 'candidate-2.png',
        humanConfirmedAt: '2026-07-22T10:00:00.000Z',
      }),
    })

    expect(ensurePanelCandidatesInitialized(sourcePanel, runtime)).toBe(true)
    expect(initializedIndex).toBe(1)
    expect(getPanelCandidatesFromRuntime(sourcePanel, candidateSystem)?.selectedIndex).toBe(1)
  })
})

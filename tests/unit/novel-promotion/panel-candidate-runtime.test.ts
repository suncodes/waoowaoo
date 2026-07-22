import { describe, expect, it } from 'vitest'
import type { NovelPromotionPanel } from '@/types/project'
import { createVisualQualityState } from '@/lib/quality-workflow'
import { getPanelCandidatesFromRuntime } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/panel-candidate-runtime'

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

    expect(result).toEqual({
      candidates: ['candidate-1.png', 'candidate-2.png'],
      selectedIndex: 0,
    })
  })

  it('does not allow manual selection while automatic review is running', () => {
    const result = getPanelCandidatesFromRuntime(panel({
      candidateImages: JSON.stringify(['candidate-1.png']),
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'reviewing',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png'],
      }),
    }), candidateSystem)

    expect(result).toBeNull()
  })
})

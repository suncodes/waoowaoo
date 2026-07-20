import { describe, expect, it } from 'vitest'
import {
  resolveStoryboardFooterAction,
  resolveVisualDesignFooterAction,
} from '@/lib/creation-workspace/stage-actions'

function visualInput(overrides: Partial<Parameters<typeof resolveVisualDesignFooterAction>[0]> = {}) {
  return {
    contentReady: true,
    stageStatus: 'attention' as const,
    hasPlan: true,
    taskRunning: false,
    assetsLoading: false,
    assetAnalysisRunning: false,
    missingAnchors: false,
    missingCoreCount: 0,
    ...overrides,
  }
}

describe('creation stage footer action ownership', () => {
  it('does not expose generation from the visual preparation footer', () => {
    expect(resolveVisualDesignFooterAction(visualInput({
      stageStatus: 'ready',
      hasPlan: false,
    }))).toEqual({ kind: 'none', reason: 'generation_required' })

    expect(resolveVisualDesignFooterAction(visualInput({
      stageStatus: 'stale',
    }))).toEqual({ kind: 'none', reason: 'generation_required' })
  })

  it('uses the visual preparation footer only for confirmation or continuing', () => {
    expect(resolveVisualDesignFooterAction(visualInput())).toEqual({
      kind: 'approve',
      disabled: false,
    })

    expect(resolveVisualDesignFooterAction(visualInput({
      stageStatus: 'completed',
    }))).toEqual({ kind: 'continue' })
  })

  it('keeps confirmation visible but disabled while core visuals are incomplete', () => {
    expect(resolveVisualDesignFooterAction(visualInput({
      missingCoreCount: 2,
    }))).toEqual({
      kind: 'approve',
      disabled: true,
      reason: 'missing_core_assets',
    })
  })

  it('shows storyboard continuation only after a storyboard exists', () => {
    expect(resolveStoryboardFooterAction({
      stageStatus: 'ready',
      taskRunning: false,
    })).toBe('none')
    expect(resolveStoryboardFooterAction({
      stageStatus: 'running',
      taskRunning: true,
    })).toBe('none')
    expect(resolveStoryboardFooterAction({
      stageStatus: 'completed',
      taskRunning: false,
    })).toBe('continue')
  })
})

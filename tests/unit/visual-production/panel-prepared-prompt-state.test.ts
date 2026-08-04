import { describe, expect, it } from 'vitest'
import {
  isPanelImagePromptCurrent,
  markPanelImagePromptCurrent,
  markPanelImagePromptStale,
} from '@/lib/visual-production/panel-prepared-prompt-state'

describe('panel prepared prompt state', () => {
  it('rejects a fixed prompt after its referenced asset version changes', () => {
    const current = markPanelImagePromptCurrent({
      referencePlan: { schemaVersion: 1, references: [] },
      artifactId: 'prepared-prompt-1',
      assetVersionHash: 'asset-version-1',
    })

    expect(isPanelImagePromptCurrent({
      referencePlan: current,
      artifactId: 'prepared-prompt-1',
      assetVersionHash: 'asset-version-1',
    })).toBe(true)
    expect(isPanelImagePromptCurrent({
      referencePlan: current,
      artifactId: 'prepared-prompt-1',
      assetVersionHash: 'asset-version-2',
    })).toBe(false)

    const stale = markPanelImagePromptStale(current, 'asset_final_image_changed')
    expect(isPanelImagePromptCurrent({
      referencePlan: stale,
      artifactId: 'prepared-prompt-1',
      assetVersionHash: 'asset-version-1',
    })).toBe(false)
  })
})

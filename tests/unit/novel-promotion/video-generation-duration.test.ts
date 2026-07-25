import { describe, expect, it } from 'vitest'
import {
  pickVideoDurationSeconds,
  readPanelTargetDurationMs,
} from '@/lib/video-generation-duration'

describe('video generation duration helpers', () => {
  it('uses the shortest supported duration that covers the target', () => {
    expect(pickVideoDurationSeconds({
      targetDurationMs: 6100,
      supportedDurations: [4, 6, 8],
    })).toBe(8)
  })

  it('falls back to the maximum supported duration when narration is longer than model limits', () => {
    expect(pickVideoDurationSeconds({
      targetDurationMs: 13_500,
      supportedDurations: [4, 6, 8],
    })).toBe(8)
  })

  it('returns undefined when the model has no duration capability', () => {
    expect(pickVideoDurationSeconds({
      targetDurationMs: 5000,
      supportedDurations: [],
    })).toBeUndefined()
  })

  it('prefers explicit targetDurationMs over legacy panel duration seconds', () => {
    expect(readPanelTargetDurationMs({
      targetDurationMs: 7200,
      duration: 4,
    })).toBe(7200)
  })

  it('converts legacy panel duration seconds to milliseconds', () => {
    expect(readPanelTargetDurationMs({
      duration: 4.5,
    })).toBe(4500)
  })
})

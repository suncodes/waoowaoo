import { describe, expect, it } from 'vitest'
import {
  parseImageQualityReviewResult,
  VISUAL_REVIEW_PASS_MIN_SCORE,
} from '@/lib/visual-quality'

describe('visual quality review parser', () => {
  it('downgrades model-passed candidates below the pass score floor', () => {
    const result = parseImageQualityReviewResult({
      status: 'passed',
      selectedCandidateIndex: 0,
      score: VISUAL_REVIEW_PASS_MIN_SCORE - 1,
      confidence: 0.9,
      candidates: [{
        candidateIndex: 0,
        score: VISUAL_REVIEW_PASS_MIN_SCORE - 1,
        confidence: 0.9,
        passed: true,
        issues: [],
      }],
      promptPatch: {},
    }, 'version-1')

    expect(result.candidates[0].passed).toBe(false)
    expect(result.status).toBe('repairable')
  })
})

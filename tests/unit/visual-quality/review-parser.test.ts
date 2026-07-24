import { describe, expect, it } from 'vitest'
import {
  enforceVisualQualityHardGates,
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

  it('enforces hard gates for subject mismatch even when model marks a candidate as passed', () => {
    const review = parseImageQualityReviewResult({
      status: 'passed',
      selectedCandidateIndex: 0,
      score: 92,
      confidence: 0.93,
      candidates: [{
        candidateIndex: 0,
        score: 92,
        confidence: 0.93,
        passed: true,
        issues: [{
          code: 'SUBJECT_MISMATCH',
          severity: 'major',
          message: '主体不是目标道具',
          evidence: '画面中心是另一件物体',
          repairHint: '重新生成主体',
        }],
      }],
      promptPatch: {},
    }, 'version-2')
    const gated = enforceVisualQualityHardGates(review, {
      schemaVersion: 1,
      targetType: 'panel',
      targetId: 'panel-1',
      intent: '黄铜罗盘特写',
      aspectRatio: '16:9',
      visualType: 'illustration',
      renderMode: 'generated_image',
      shotType: 'close-up',
      cameraMove: 'static',
      location: '',
      characters: [],
      props: ['黄铜罗盘'],
      requiredText: '',
      styleBaseline: 'cinematic',
      continuityRules: [],
      forbiddenPatterns: ['无文字'],
      riskLevel: 'high',
    })

    expect(gated.candidates[0].passed).toBe(false)
    expect(gated.status).toBe('repairable')
  })
})

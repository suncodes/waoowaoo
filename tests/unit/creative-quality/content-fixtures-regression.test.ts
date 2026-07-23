import { describe, expect, it } from 'vitest'
import { reviewContentPlanQuality } from '@/lib/content-planning/content-quality-review'
import type { ContentPlanResult } from '@/lib/content-planning'
import { resolveVideoProfile } from '@/lib/video-profile'
import fixtureData from '../../fixtures/creative-quality/content/cases.json'

interface ContentRegressionCase {
  id: string
  profile: Record<string, unknown>
  result: ContentPlanResult
  expect: {
    status: ReturnType<typeof reviewContentPlanQuality>['status']
    route: ReturnType<typeof reviewContentPlanQuality>['route']
    minScore: number
    requiredEvidenceIncludes: string[]
  }
}

function dimensionScore(review: ReturnType<typeof reviewContentPlanQuality>, name: string): number {
  return review.dimensions.find((dimension) => dimension.name === name)?.score ?? 0
}

describe('creative quality content regression fixtures', () => {
  const cases = fixtureData.cases as ContentRegressionCase[]

  it('keeps a representative fixed sample set', () => {
    expect(cases.map((item) => item.id)).toEqual([
      'sourced-guide-pass',
      'title-only-draft-source-gap',
      'unsupported-overlong-block',
      'narrative-plan-pass',
      'repetition-warning-visible',
    ])
  })

  it.each(cases)('$id satisfies its quality gate expectation', (testCase) => {
    const review = reviewContentPlanQuality({
      targetId: testCase.id,
      result: testCase.result,
      profile: resolveVideoProfile(testCase.profile),
      reviewedAt: '2026-07-23T00:00:00.000Z',
    })

    expect(review.status).toBe(testCase.expect.status)
    expect(review.route).toBe(testCase.expect.route)
    expect(review.score).toBeGreaterThanOrEqual(testCase.expect.minScore)
    for (const expectedEvidence of testCase.expect.requiredEvidenceIncludes) {
      expect(review.evidence.join('\n')).toContain(expectedEvidence)
    }
  })

  it('keeps title-only drafts visible as source risk instead of pretending they are sourced final copy', () => {
    const testCase = cases.find((item) => item.id === 'title-only-draft-source-gap')
    expect(testCase).toBeDefined()
    if (!testCase) return

    const review = reviewContentPlanQuality({
      targetId: testCase.id,
      result: testCase.result,
      profile: resolveVideoProfile(testCase.profile),
      reviewedAt: '2026-07-23T00:00:00.000Z',
    })

    expect(dimensionScore(review, 'source')).toBeLessThan(100)
    expect(review.evidence).toContain('source-title: 只有书名输入，事实细节需要用户材料确认。')
    expect(review.evidence).toContain('内容处于草稿模式，不应视为最终事实稿。')
  })
})

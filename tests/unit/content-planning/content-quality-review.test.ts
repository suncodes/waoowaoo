import { describe, expect, it } from 'vitest'
import { resolveVideoProfile } from '@/lib/video-profile'
import {
  mergeContentReviewWithQualityGate,
  reviewContentPlanQuality,
} from '@/lib/content-planning/content-quality-review'
import type { ContentPlanResult } from '@/lib/content-planning'

function guideResult(): ContentPlanResult {
  return {
    creativeBrief: {
      schemaVersion: 1,
      profilePreset: 'book_guide',
      objective: '导读',
      audience: 'general_readers',
      audiencePromise: '理解作品为什么值得读',
      targetDurationSec: 60,
      tone: [],
      mustInclude: [],
      mustAvoid: [],
    },
    contentPlan: {
      schemaVersion: 1,
      planType: 'guide',
      title: '海底两万里导读',
      thesis: '科学想象让冒险具有思想重量',
      hookPattern: 'question',
      recommendationAngle: '从深海探索切入',
      sourceLedger: [{
        id: 'source-1',
        label: '用户简介',
        sourceType: 'user_source',
        usage: '核心观点',
        confidence: 0.86,
        riskFlags: [],
      }],
      riskFlags: [],
      outline: [{ id: 'outline-1', title: '为什么值得读', question: '为什么经典', takeaway: '科学与冒险结合' }],
      segments: [{
        id: 'segment-1',
        outlineId: 'outline-1',
        title: '深海问题',
        narration: '这本书把深海未知、科学机器和人物选择放在同一个冒险里。',
        visualPurpose: '建立书籍主题和深海尺度',
        visualHints: ['书封', '潜艇', '深海尺度'],
        estimatedDurationSec: 12,
        spoilerLevel: 'light',
        sourceAnchor: { label: '用户简介', sourceType: 'user_source', confidence: 0.86 },
        riskFlags: [],
      }],
    },
    contentReview: {
      schemaVersion: 1,
      status: 'approved',
      score: 90,
      profileFitScore: 90,
      sourceSupportScore: 90,
      tensionScore: 90,
      visualizationScore: 90,
      pacingScore: 90,
      stabilityScore: 90,
      issues: [],
      revisionInstructions: [],
    },
  }
}

describe('content quality review', () => {
  it('passes a sourced and visualizable guide plan', () => {
    const result = guideResult()
    const review = reviewContentPlanQuality({
      targetId: 'episode-1',
      result,
      profile: resolveVideoProfile({ preset: 'book_guide', targetDurationSec: 60 }),
    })

    expect(review).toMatchObject({
      reviewKind: 'content_plan',
      planType: 'guide',
      status: 'passed',
      route: 'NONE',
      unitCount: 1,
    })
  })

  it('blocks plans with critical source and duration problems', () => {
    const result = guideResult()
    result.creativeBrief.targetDurationSec = 30
    result.contentPlan.sourceLedger[0].confidence = 0.4
    if (result.contentPlan.planType !== 'guide') throw new Error('expected guide plan')
    result.contentPlan.segments[0].estimatedDurationSec = 70
    const qualityReview = reviewContentPlanQuality({
      targetId: 'episode-1',
      result,
      profile: resolveVideoProfile({ preset: 'book_guide', targetDurationSec: 30 }),
    })
    const merged = mergeContentReviewWithQualityGate(result.contentReview, qualityReview)

    expect(qualityReview.status).toBe('human_required')
    expect(qualityReview.route).toBe('CONTENT_REVISE')
    expect(merged.status).toBe('blocked')
    expect(merged.issues.length).toBeGreaterThan(0)
    expect(merged.revisionInstructions[0]).toContain('修正文稿质量问题')
  })
})

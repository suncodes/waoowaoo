import { describe, expect, it } from 'vitest'
import { resolveVideoProfile } from '@/lib/video-profile'
import { reviewVisualPlanStoryboard } from '@/lib/visual-planning/storyboard-review'
import type { VisualPlanResult, VisualUnit } from '@/lib/visual-planning'

function visualUnit(overrides: Partial<VisualUnit> = {}): VisualUnit {
  return {
    id: 'unit-1',
    clipId: 'clip-1',
    panelNumber: 1,
    visualType: 'illustration',
    renderMode: 'generated_image',
    shotType: 'medium shot',
    cameraMove: 'locked camera',
    description: '尼摩船长站在潜艇舷窗前',
    imagePrompt: '尼摩船长站在潜艇舷窗前，无文字',
    videoPrompt: '轻微推进',
    durationSec: 8,
    assetRefs: [{ id: 'char-nemo', kind: 'character', name: '尼摩船长' }],
    shotSpec: {
      narrativeIntent: '建立主角压迫感',
      shotFunction: 'hook',
      primarySubject: '尼摩船长',
      visibleAssets: [{ id: 'char-nemo', kind: 'character', name: '尼摩船长' }],
      subjectIdentity: ['深色船长制服'],
      startState: '站立',
      actionBeats: ['凝视舷窗'],
      endState: '保持凝视',
      continuity: {
        fromPrevious: '开场',
        toNext: '引向潜艇内部',
        screenDirection: '面向画面右侧',
        lightingContinuity: '冷色舷窗光',
      },
      singleImageFeasibility: {
        status: 'feasible',
        reason: '单一时空单一动作',
        riskFlags: [],
      },
      spatialContinuity: '舷窗在背景右侧',
      camera: 'locked camera',
      sceneLightingBaseline: '冷色柔光',
      colorGrade: '深蓝与金属灰',
      dialogueAudio: '',
      constraints: ['无文字'],
      durationIntent: '8 seconds',
    },
    ...overrides,
  }
}

function result(unit: VisualUnit): VisualPlanResult {
  return {
    directorTreatment: {
      schemaVersion: 1,
      narrativeStrategy: '悬念开场',
      pacing: '由人物进入空间',
      cameraLanguage: '稳定镜头',
      transitionStrategy: '动作匹配',
      soundStrategy: '低频环境声',
    },
    productionBible: {
      schemaVersion: 1,
      visualStyle: '电影感插画',
      lightingBaseline: '冷色柔光',
      colorGrade: '深蓝与金属灰',
      compositionRules: ['主体明确'],
      continuityRules: ['光色一致'],
      forbiddenPatterns: ['乱码文字'],
    },
    shotPlan: {
      schemaVersion: 1,
      summary: '分镜计划',
      totalEstimatedDurationSec: 8,
      shotBudget: {
        totalShots: 1,
        averageDurationSec: 8,
        hookShots: 1,
        setupShots: 0,
        evidenceShots: 0,
        payoffShots: 0,
        breathShots: 0,
      },
      rhythmCurve: [{ label: 'hook', shotFunction: 'hook', intensity: 0.8, intent: '建立悬念' }],
      functionMix: [{ shotFunction: 'hook', count: 1 }],
      continuityChecks: ['光色一致'],
    },
    visualUnits: [unit],
  }
}

describe('storyboard review', () => {
  it('passes a feasible storyboard plan', () => {
    const review = reviewVisualPlanStoryboard({
      targetId: 'episode-1',
      result: result(visualUnit()),
      profile: resolveVideoProfile({ preset: 'book_guide', targetDurationSec: 8 }),
    })

    expect(review).toMatchObject({
      reviewKind: 'storyboard_plan',
      status: 'passed',
      route: 'NONE',
      visualUnitCount: 1,
    })
  })

  it('routes generated images with split-only shots back to shot replanning', () => {
    const unit = visualUnit({
      shotSpec: {
        ...visualUnit().shotSpec,
        singleImageFeasibility: {
          status: 'needs_split',
          reason: '同时展示童年和成年两个时间点',
          riskFlags: ['multi_moment'],
        },
      },
    })
    const review = reviewVisualPlanStoryboard({
      targetId: 'episode-1',
      result: result(unit),
      profile: resolveVideoProfile({ preset: 'book_guide', targetDurationSec: 8 }),
    })

    expect(review.status).toBe('repairable')
    expect(review.route).toBe('SHOT_REPLAN')
    expect(review.criticalIssues[0]).toContain('needs_split')
  })

  it('rejects overlong generated-image shots before image generation', () => {
    const review = reviewVisualPlanStoryboard({
      targetId: 'episode-1',
      result: result(visualUnit({ durationSec: 20 })),
      profile: resolveVideoProfile({ preset: 'book_guide', targetDurationSec: 20 }),
    })

    expect(review.status).toBe('repairable')
    expect(review.route).toBe('SHOT_REPLAN')
    expect(review.criticalIssues.join('\n')).toContain('过长')
  })

  it('rejects montage-like generated-image prompts as split candidates', () => {
    const review = reviewVisualPlanStoryboard({
      targetId: 'episode-1',
      result: result(visualUnit({
        description: '依次展示童年、成年和晚年的三段经历',
        imagePrompt: '同一画面拼接多个时期的经历，无文字',
      })),
      profile: resolveVideoProfile({ preset: 'book_guide', targetDurationSec: 8 }),
    })

    expect(review.status).toBe('repairable')
    expect(review.criticalIssues.join('\n')).toContain('混剪')
  })
})

import { describe, expect, it } from 'vitest'
import { resolveVideoProfile } from '@/lib/video-profile'
import {
  autoRepairVisualPlanStoryboard,
  type VisualPlanResult,
  type VisualUnit,
} from '@/lib/visual-planning'
import { reviewVisualPlanStoryboard } from '@/lib/visual-planning/storyboard-review'

function visualUnit(overrides: Partial<VisualUnit> = {}): VisualUnit {
  return {
    id: 'visual_1',
    clipId: 'clip-1',
    panelNumber: 1,
    visualType: 'illustration',
    renderMode: 'generated_image',
    shotType: 'medium shot',
    cameraMove: 'locked camera',
    description: '主角站在舷窗前',
    imagePrompt: '主角站在舷窗前，无文字',
    videoPrompt: '缓慢推进',
    durationSec: 8,
    assetRefs: [],
    shotSpec: {
      narrativeIntent: '建立情绪',
      shotFunction: 'hook',
      primarySubject: '主角',
      visibleAssets: [],
      subjectIdentity: ['深色剪影'],
      startState: '主角站定',
      actionBeats: ['主角凝视舷窗'],
      endState: '主角保持沉默',
      continuity: {
        fromPrevious: '开场',
        toNext: '进入下一镜',
        screenDirection: '看向画面右侧',
        lightingContinuity: '冷色柔光',
      },
      singleImageFeasibility: {
        status: 'feasible',
        reason: '单一时空单一动作',
        riskFlags: [],
      },
      spatialContinuity: '舷窗在右侧',
      camera: 'medium shot',
      sceneLightingBaseline: '冷色柔光',
      colorGrade: '深蓝灰',
      dialogueAudio: '',
      constraints: ['无文字'],
      durationIntent: '8s',
    },
    ...overrides,
  }
}

function visualPlan(unit: VisualUnit): VisualPlanResult {
  return {
    directorTreatment: {
      schemaVersion: 1,
      narrativeStrategy: '旁白驱动',
      pacing: '短镜头推进',
      cameraLanguage: '稳定镜头',
      transitionStrategy: '动作承接',
      soundStrategy: '低频氛围',
    },
    productionBible: {
      schemaVersion: 1,
      visualStyle: '电影感插画',
      lightingBaseline: '冷色柔光',
      colorGrade: '深蓝灰',
      compositionRules: ['主体明确'],
      continuityRules: ['光色一致'],
      forbiddenPatterns: ['乱码文字'],
    },
    shotPlan: {
      schemaVersion: 1,
      summary: '测试分镜',
      totalEstimatedDurationSec: unit.durationSec,
      shotBudget: {
        totalShots: 1,
        averageDurationSec: unit.durationSec,
        hookShots: 1,
        setupShots: 0,
        evidenceShots: 0,
        payoffShots: 0,
        breathShots: 0,
      },
      rhythmCurve: [{ label: 'hook', shotFunction: 'hook', intensity: 0.8, intent: '建立情绪' }],
      functionMix: [{ shotFunction: 'hook', count: 1 }],
      continuityChecks: ['光色一致'],
    },
    visualUnits: [unit],
  }
}

describe('storyboard auto repair', () => {
  it('splits overlong generated-image shots before storyboard review blocks the task', () => {
    const repaired = autoRepairVisualPlanStoryboard(visualPlan(visualUnit({ durationSec: 13 })))

    expect(repaired.appliedFixes.map((fix) => fix.code)).toContain('split_overlong_generated_image')
    expect(repaired.result.visualUnits).toHaveLength(2)
    expect(repaired.result.visualUnits.every((unit) => unit.durationSec <= 12)).toBe(true)
    expect(repaired.result.shotPlan.shotBudget.totalShots).toBe(2)

    const review = reviewVisualPlanStoryboard({
      targetId: 'episode-1',
      result: repaired.result,
      profile: resolveVideoProfile({ preset: 'book_guide', targetDurationSec: 13 }),
    })
    expect(review.criticalIssues).toEqual([])
    expect(review.status).toBe('passed')
  })

  it('splits generated-image shots that carry too many action beats', () => {
    const repaired = autoRepairVisualPlanStoryboard(visualPlan(visualUnit({
      durationSec: 12,
      shotSpec: {
        ...visualUnit().shotSpec,
        actionBeats: ['打开舱门', '看见海底城市', '转身示意同伴'],
      },
    })))

    expect(repaired.appliedFixes.map((fix) => fix.code)).toContain('split_multi_action_generated_image')
    expect(repaired.result.visualUnits).toHaveLength(3)
    expect(repaired.result.visualUnits.every((unit) => unit.shotSpec.actionBeats.length === 1)).toBe(true)
  })

  it('coerces complex single-image concepts into a non-blocking composite plan', () => {
    const repaired = autoRepairVisualPlanStoryboard(visualPlan(visualUnit({
      description: '依次展示三段经历的前后对比',
      imagePrompt: '同一画面拼接三个时期的经历，无文字',
      shotSpec: {
        ...visualUnit().shotSpec,
        actionBeats: ['主角凝视舷窗'],
      },
    })))

    expect(repaired.appliedFixes.map((fix) => fix.code)).toContain('coerce_complex_generated_image')
    expect(repaired.result.visualUnits).toHaveLength(1)
    expect(repaired.result.visualUnits[0].renderMode).toBe('composite')

    const review = reviewVisualPlanStoryboard({
      targetId: 'episode-1',
      result: repaired.result,
      profile: resolveVideoProfile({ preset: 'book_guide', targetDurationSec: 8 }),
    })
    expect(review.criticalIssues).toEqual([])
  })
})

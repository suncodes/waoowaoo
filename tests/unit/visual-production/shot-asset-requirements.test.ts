import { describe, expect, it } from 'vitest'
import {
  buildFallbackShotAssetRequirementPlan,
  normalizeShotAssetRequirementPlanResult,
  type ShotAssetRequirementPlan,
} from '@/lib/visual-production/shot-asset-requirements'
import type { VisualAssetRef, VisualUnit } from '@/lib/visual-planning'

const assets: VisualAssetRef[] = [
  { id: 'prop-nautilus', kind: 'prop', name: '鹦鹉螺号潜水艇' },
  { id: 'loc-cabin', kind: 'location', name: '鹦鹉螺号内部舱室' },
]

function buildUnit(overrides: Partial<VisualUnit> = {}): VisualUnit {
  return {
    id: 'visual_1',
    clipId: 'clip_1',
    panelNumber: 1,
    visualType: 'illustration',
    renderMode: 'generated_image',
    shotType: 'close-up',
    cameraMove: 'locked camera',
    description: '尼摩船长注视潜水艇设计图',
    imagePrompt: '无文字，尼摩船长注视桌上的潜水艇设计图',
    videoPrompt: '镜头缓慢推近设计图',
    durationSec: 5,
    shotSpec: {
      narrativeIntent: '建立潜水艇作为核心道具',
      shotFunction: 'setup',
      primarySubject: '鹦鹉螺号潜水艇',
      visibleAssets: [],
      subjectIdentity: [],
      startState: 'stable',
      actionBeats: [],
      endState: 'stable',
      continuity: {
        fromPrevious: '承接上一镜',
        toNext: '进入下一镜',
        screenDirection: 'left to right',
        lightingContinuity: 'same light',
      },
      singleImageFeasibility: {
        status: 'feasible',
        reason: 'single frame',
        riskFlags: [],
      },
      spatialContinuity: 'same space',
      camera: 'locked',
      sceneLightingBaseline: 'soft light',
      colorGrade: 'cool',
      dialogueAudio: '',
      constraints: [],
      durationIntent: '5 seconds',
    },
    assetRefs: [],
    ...overrides,
  }
}

describe('shot asset requirements', () => {
  it('normalizes llm-selected asset ids to available asset identity', () => {
    const result = normalizeShotAssetRequirementPlanResult({
      schemaVersion: 1,
      plans: [{
        panelId: 'visual_1',
        primarySubject: '银色现代潜水艇',
        subjectType: 'vehicle',
        visualIntent: 'prop_focus',
        referencePolicy: 'required',
        noReferenceAllowed: false,
        noReferenceReason: null,
        requirements: [{
          name: '银色现代潜水艇',
          kind: 'prop',
          assetId: 'prop-nautilus',
          role: 'prop_detail',
          required: true,
          mustLock: true,
          reuseExpected: true,
          reason: '需要锁定潜水艇外观',
        }],
        confidence: 0.9,
        source: 'llm',
        warnings: [],
      }],
    }, [buildUnit()], assets)

    expect(result.plans[0]).toMatchObject({
      source: 'llm',
      primarySubject: '银色现代潜水艇',
      requirements: [{
        assetId: 'prop-nautilus',
        name: '鹦鹉螺号潜水艇',
        kind: 'prop',
      }],
    })
  })

  it('builds a no-reference fallback for text cards without relying on prompt wording', () => {
    const plan: ShotAssetRequirementPlan = buildFallbackShotAssetRequirementPlan(buildUnit({
      visualType: 'quote_card',
      renderMode: 'text_card',
      onScreenText: '真正的冒险，从看见未知开始',
      imagePrompt: '无文字、无水印、无标志，深海背景留白',
    }))

    expect(plan.visualIntent).toBe('text_card')
    expect(plan.referencePolicy).toBe('clean_plate')
    expect(plan.noReferenceAllowed).toBe(true)
    expect(plan.requirements).toEqual([])
  })

  it('normalizes contradictory book clean-plate plans to no-reference clean plate', () => {
    const result = normalizeShotAssetRequirementPlanResult({
      schemaVersion: 1,
      plans: [{
        panelId: 'visual_1',
        primarySubject: '小说封面空白底图',
        subjectType: 'book',
        visualIntent: 'book_clean_plate',
        referencePolicy: 'required',
        noReferenceAllowed: false,
        noReferenceReason: null,
        requirements: [],
        confidence: 0.8,
        source: 'llm',
        warnings: [],
      }],
    }, [buildUnit({
      visualType: 'book_cover',
      renderMode: 'composite',
    })], assets)

    expect(result.plans[0]).toMatchObject({
      referencePolicy: 'clean_plate',
      noReferenceAllowed: true,
      noReferenceReason: 'clean_plate_or_text_card',
    })
  })
})

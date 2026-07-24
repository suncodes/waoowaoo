import { describe, expect, it } from 'vitest'
import { auditVisualAssetCoverage } from '@/lib/assets/asset-coverage-audit'
import type { VisualUnit } from '@/lib/visual-planning'
import type { ShotAssetRequirementPlanResult } from '@/lib/visual-production/shot-asset-requirements'

function buildVisualUnit(overrides: Partial<VisualUnit> = {}): VisualUnit {
  return {
    id: 'panel-1',
    clipId: 'clip-1',
    panelNumber: 1,
    visualType: 'illustration',
    renderMode: 'generated_image',
    shotType: 'wide',
    cameraMove: 'static',
    description: '银星号潜艇本体从深海雾光中浮现，不能用银星号内部替代。',
    imagePrompt: '银星号潜艇本体外观关键帧',
    videoPrompt: '轻微推进',
    durationSec: 5,
    shotSpec: {
      narrativeIntent: '锁定核心载具外观',
      shotFunction: 'hook',
      primarySubject: '银星号潜艇本体',
      visibleAssets: [{ id: 'loc-interior', kind: 'location', name: '银星号内部' }],
      subjectIdentity: ['银星号潜艇外观'],
      startState: '潜艇进入画面',
      actionBeats: ['潜艇从雾光中浮现'],
      endState: '潜艇轮廓稳定可读',
      continuity: {
        fromPrevious: '开场建立深海',
        toNext: '进入内部空间',
        screenDirection: '从左向右',
        lightingContinuity: '冷色深海光',
      },
      singleImageFeasibility: {
        status: 'feasible',
        reason: '单一主体',
        riskFlags: [],
      },
      spatialContinuity: '保持潜艇从左向右',
      camera: '远景侧前方',
      sceneLightingBaseline: '冷色背光',
      colorGrade: '蓝绿色',
      dialogueAudio: '',
      constraints: [],
      durationIntent: '5 seconds',
      promptBlueprint: {
        subject: ['银星号潜艇本体'],
        environment: ['深海'],
        action: ['浮现'],
        camera: ['远景'],
        lighting: ['冷色背光'],
        style: ['电影感'],
        negative: [],
      },
    },
    assetRefs: [{ id: 'loc-interior', kind: 'location', name: '银星号内部' }],
    ...overrides,
  }
}

describe('asset coverage audit', () => {
  it('blocks using an interior location as the core vehicle body', () => {
    const result = auditVisualAssetCoverage({
      targetId: 'project-1',
      generatedAt: '2026-07-24T00:00:00.000Z',
      visualUnits: [buildVisualUnit()],
      assets: [{
        id: 'loc-interior',
        kind: 'location',
        name: '银星号内部',
        semanticType: 'interior_location',
      }],
    })

    expect(result.status).toBe('blocking')
    expect(result.items[0]).toMatchObject({
      coverageStatus: 'covered_by_wrong_type',
      severity: 'blocking',
      expectedKind: 'prop',
      expectedSemanticType: 'vehicle',
      matchedAssetKind: 'location',
      matchedAssetSemanticType: 'interior_location',
      suggestedAction: 'change_binding',
    })
  })

  it('allows one-off text cards without a stable visual reference', () => {
    const result = auditVisualAssetCoverage({
      targetId: 'project-1',
      generatedAt: '2026-07-24T00:00:00.000Z',
      visualUnits: [buildVisualUnit({
        renderMode: 'text_card',
        visualType: 'quote_card',
        description: '章节标题文字卡',
        imagePrompt: '干净背景',
        shotSpec: {
          ...buildVisualUnit().shotSpec,
          primarySubject: '章节标题',
          visibleAssets: [],
        },
        assetRefs: [],
      })],
      assets: [],
    })

    expect(result.status).toBe('passed')
    expect(result.items[0]).toMatchObject({
      coverageStatus: 'one_off_allowed',
      severity: 'info',
      suggestedAction: 'mark_one_off',
    })
  })

  it('suggests non-equivalent relations between a body asset and its interior space', () => {
    const result = auditVisualAssetCoverage({
      targetId: 'project-1',
      visualUnits: [],
      assets: [
        { id: 'prop-body', kind: 'prop', name: '银星号本体', semanticType: 'vehicle' },
        { id: 'loc-interior', kind: 'location', name: '银星号内部', semanticType: 'interior_location' },
      ],
      generatedAt: '2026-07-24T00:00:00.000Z',
    })

    expect(result.relationSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromId: 'loc-interior',
        toId: 'prop-body',
        relation: 'not_equivalent',
      }),
      expect.objectContaining({
        fromId: 'prop-body',
        toId: 'loc-interior',
        relation: 'contains',
      }),
    ]))
  })

  it('uses shot asset requirements instead of inferring the expected kind from prompt text', () => {
    const shotAssetRequirementPlan: ShotAssetRequirementPlanResult = {
      schemaVersion: 1,
      plans: [{
        schemaVersion: 1,
        panelId: 'panel-1',
        primarySubject: '银星号内部结构',
        subjectType: 'environment',
        visualIntent: 'environment_plate',
        referencePolicy: 'required',
        noReferenceAllowed: false,
        noReferenceReason: null,
        requirements: [{
          name: '银星号内部结构',
          kind: 'location',
          semanticType: 'interior_location',
          assetId: 'loc-interior',
          role: 'environment',
          required: true,
          mustLock: false,
          reuseExpected: true,
          reason: '镜头需要复现内部空间',
        }],
        confidence: 0.92,
        source: 'llm',
        warnings: [],
      }],
    }
    const result = auditVisualAssetCoverage({
      targetId: 'project-1',
      generatedAt: '2026-07-24T00:00:00.000Z',
      visualUnits: [buildVisualUnit({
        description: '银星号潜艇内部结构展示',
        imagePrompt: '银星号潜艇内部结构的环境镜头',
        shotSpec: {
          ...buildVisualUnit().shotSpec,
          primarySubject: '银星号内部结构',
          visibleAssets: [{ id: 'loc-interior', kind: 'location', name: '银星号内部结构' }],
        },
        assetRefs: [{ id: 'loc-interior', kind: 'location', name: '银星号内部结构' }],
      })],
      assets: [{
        id: 'loc-interior',
        kind: 'location',
        name: '银星号内部结构',
        semanticType: 'interior_location',
      }],
      shotAssetRequirementPlan,
    })

    expect(result.status).toBe('passed')
    expect(result.items[0]).toMatchObject({
      coverageStatus: 'covered',
      expectedKind: 'location',
      expectedSemanticType: 'interior_location',
      matchedAssetKind: 'location',
    })
  })
})

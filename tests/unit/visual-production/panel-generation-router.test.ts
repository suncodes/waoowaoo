import { describe, expect, it } from 'vitest'
import {
  assertPanelGenerationRouteAllowed,
  decidePanelGenerationRoute,
  type PanelGenerationRouteDecision,
} from '@/lib/visual-production/panel-generation-router'
import type { PanelAssetBindingPlan } from '@/lib/visual-production/binding-plan'
import type { VisualReference } from '@/lib/visual-production/references'
import type { ShotAssetRequirementPlan } from '@/lib/visual-production/shot-asset-requirements'

function buildBindingPlan(overrides: Partial<PanelAssetBindingPlan> = {}): PanelAssetBindingPlan {
  return {
    schemaVersion: 1,
    primarySubject: '银星号潜艇本体',
    visualType: 'illustration',
    renderMode: 'generated_image',
    bindings: [],
    suppressed: [],
    warnings: [],
    complexity: {
      score: 10,
      level: 'low',
      recommendedAction: 'generate',
      riskFlags: [],
    },
    usedShotSpec: true,
    ...overrides,
  }
}

function buildPrimaryReference(): VisualReference {
  return {
    assetId: 'prop-body',
    renderId: 'render-1',
    assetKind: 'prop',
    assetName: '银星号潜艇本体',
    url: 'https://example.test/body.png',
    role: 'primary_identity',
    usage: 'must_match',
    weight: 0.9,
    source: 'shot_spec',
  }
}

function buildRequirementPlan(overrides: Partial<ShotAssetRequirementPlan> = {}): ShotAssetRequirementPlan {
  return {
    schemaVersion: 1,
    panelId: 'visual_1',
    primarySubject: '关键罗盘',
    subjectType: 'prop',
    visualIntent: 'prop_focus',
    referencePolicy: 'required',
    noReferenceAllowed: false,
    noReferenceReason: null,
    requirements: [{
      name: '关键罗盘',
      kind: 'prop',
      assetId: null,
      role: 'prop_detail',
      required: true,
      mustLock: true,
      reuseExpected: true,
      reason: '主道具需要稳定外观',
    }],
    confidence: 0.9,
    source: 'llm',
    warnings: [],
    ...overrides,
  }
}

describe('panel generation router', () => {
  it('blocks high-identity subjects when no reference image is available', () => {
    const decision = decidePanelGenerationRoute({
      panel: {
        id: 'panel-1',
        visualType: 'illustration',
        renderMode: 'generated_image',
        description: '核心载具外观镜头',
      },
      bindingPlan: buildBindingPlan(),
      references: [],
    })

    expect(decision).toMatchObject({
      route: 'asset_backfill',
      noReferenceReason: 'asset_missing_blocked',
      blockingAssetNames: ['银星号潜艇本体'],
    })
    expect(() => assertPanelGenerationRouteAllowed(decision)).toThrow('PANEL_GENERATION_BLOCKED')
  })

  it('allows direct generation when the primary identity reference exists', () => {
    const decision = decidePanelGenerationRoute({
      panel: { id: 'panel-1', visualType: 'illustration', renderMode: 'generated_image' },
      bindingPlan: buildBindingPlan({
        bindings: [{
          id: 'prop-body',
          kind: 'prop',
          name: '银星号潜艇本体',
          role: 'primary_identity',
          source: 'shot_spec',
          weight: 0.9,
        }],
      }),
      references: [buildPrimaryReference()],
    })

    expect(decision.route).toBe('generate')
    expect(() => assertPanelGenerationRouteAllowed(decision)).not.toThrow()
  })

  it('routes text and cover prone shots to clean-plate composition', () => {
    const decision = decidePanelGenerationRoute({
      panel: {
        id: 'panel-cover',
        visualType: 'book_cover',
        renderMode: 'composite',
        onScreenText: '书名标题',
      },
      bindingPlan: buildBindingPlan({
        primarySubject: '实体书封面',
        visualType: 'book_cover',
        renderMode: 'composite',
      }),
      references: [buildPrimaryReference()],
    })

    expect(decision).toMatchObject({
      route: 'composite',
      suggestedFix: '保持图片无文字，后期合成准确文案',
    })
  })

  it('keeps split recommendations explicit instead of overloading direct generation', () => {
    const decision: PanelGenerationRouteDecision = decidePanelGenerationRoute({
      panel: { id: 'panel-split', visualType: 'illustration', renderMode: 'generated_image' },
      bindingPlan: buildBindingPlan({
        bindings: [{
          id: 'prop-body',
          kind: 'prop',
          name: '银星号潜艇本体',
          role: 'primary_identity',
          source: 'shot_spec',
          weight: 0.9,
        }],
        complexity: {
          score: 75,
          level: 'high',
          recommendedAction: 'split',
          riskFlags: ['strong_action_or_comparison'],
        },
      }),
      references: [buildPrimaryReference()],
    })

    expect(decision.route).toBe('split')
    expect(decision.suggestedFix).toContain('拆分镜头规划')
  })

  it('uses requirement plans to route missing prop references to backfill', () => {
    const decision = decidePanelGenerationRoute({
      panel: {
        id: 'panel-prop',
        visualType: 'illustration',
        renderMode: 'generated_image',
        imagePrompt: '无文字，桌上的关键罗盘特写',
      },
      bindingPlan: buildBindingPlan({
        primarySubject: '关键罗盘',
        requirementPlan: buildRequirementPlan(),
        unresolvedRequirements: buildRequirementPlan().requirements,
      }),
      references: [],
    })

    expect(decision).toMatchObject({
      route: 'asset_backfill',
      noReferenceReason: 'asset_backfill_required',
      blockingAssetNames: ['关键罗盘'],
    })
  })

  it('uses requirement plans to route missing character references to human review', () => {
    const requirementPlan = buildRequirementPlan({
      primarySubject: '主角',
      subjectType: 'character',
      visualIntent: 'character_action',
      requirements: [{
        name: '主角',
        kind: 'character',
        assetId: 'character-1',
        role: 'primary_identity',
        required: true,
        mustLock: true,
        reuseExpected: true,
        reason: '角色脸和服装必须稳定',
      }],
    })
    const decision = decidePanelGenerationRoute({
      panel: { id: 'panel-character', visualType: 'character_action', renderMode: 'generated_image' },
      bindingPlan: buildBindingPlan({
        primarySubject: '主角',
        requirementPlan,
        unresolvedRequirements: [],
      }),
      references: [],
    })

    expect(decision).toMatchObject({
      route: 'human_required',
      noReferenceReason: 'character_reference_required',
      blockingAssetNames: ['主角'],
    })
  })

  it('does not treat negative text instructions as text-card routing when no reference is allowed', () => {
    const requirementPlan = buildRequirementPlan({
      primarySubject: '深海压力感',
      subjectType: 'abstract',
      visualIntent: 'one_off_broll',
      referencePolicy: 'no_reference_allowed',
      noReferenceAllowed: true,
      noReferenceReason: 'one_off_broll',
      requirements: [],
    })
    const decision = decidePanelGenerationRoute({
      panel: {
        id: 'panel-broll',
        visualType: 'illustration',
        renderMode: 'generated_image',
        imagePrompt: '无文字、无水印、无标志，深海中的压迫感抽象画面',
      },
      bindingPlan: buildBindingPlan({
        primarySubject: '深海压力感',
        requirementPlan,
        unresolvedRequirements: [],
      }),
      references: [],
    })

    expect(decision).toMatchObject({
      route: 'generate',
      noReferenceReason: 'one_off_broll',
    })
  })
})

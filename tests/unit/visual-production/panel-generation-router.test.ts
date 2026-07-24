import { describe, expect, it } from 'vitest'
import {
  assertPanelGenerationRouteAllowed,
  decidePanelGenerationRoute,
  type PanelGenerationRouteDecision,
} from '@/lib/visual-production/panel-generation-router'
import type { PanelAssetBindingPlan } from '@/lib/visual-production/binding-plan'
import type { VisualReference } from '@/lib/visual-production/references'

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
})

import { describe, expect, it } from 'vitest'
import {
  applyBackfillRequestsToRequirementPlan,
  planMissingAssetBackfill,
} from '@/lib/visual-production/missing-asset-backfill'
import type { PanelAssetBindingPlan } from '@/lib/visual-production/binding-plan'
import type { PanelGenerationRouteDecision } from '@/lib/visual-production/panel-generation-router'
import type { ShotAssetRequirementPlan } from '@/lib/visual-production/shot-asset-requirements'

function requirementPlan(): ShotAssetRequirementPlan {
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
      semanticType: 'tool',
      assetId: null,
      role: 'prop_detail',
      required: true,
      mustLock: true,
      reuseExpected: true,
      reason: '主道具需要跨镜保持外观一致',
    }],
    confidence: 0.88,
    source: 'llm',
    warnings: [],
  }
}

function bindingPlan(plan = requirementPlan()): PanelAssetBindingPlan {
  return {
    schemaVersion: 1,
    primarySubject: plan.primarySubject,
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
    requirementPlan: plan,
    unresolvedRequirements: plan.requirements,
  }
}

function routeDecision(route: 'asset_backfill' | 'human_required'): PanelGenerationRouteDecision {
  return {
    schemaVersion: 1,
    panelId: 'panel-1',
    route,
    reasons: ['缺少参考'],
    blockingAssetNames: ['关键罗盘'],
    noReferenceReason: 'asset_backfill_required',
  }
}

function characterRequirementPlan(): ShotAssetRequirementPlan {
  return {
    schemaVersion: 1,
    panelId: 'visual_2',
    primarySubject: '主角',
    subjectType: 'character',
    visualIntent: 'character_action',
    referencePolicy: 'required',
    noReferenceAllowed: false,
    noReferenceReason: null,
    requirements: [{
      name: '主角',
      kind: 'character',
      semanticType: 'person',
      assetId: null,
      role: 'primary_identity',
      required: true,
      mustLock: true,
      reuseExpected: true,
      reason: '主角需要跨镜保持外观一致',
    }],
    confidence: 0.9,
    source: 'llm',
    warnings: [],
  }
}

describe('missing asset backfill planner', () => {
  it('plans auto-generation for missing location-backed assets', () => {
    const plan = planMissingAssetBackfill({
      panelId: 'panel-1',
      bindingPlan: bindingPlan(),
      decision: routeDecision('asset_backfill'),
    })

    expect(plan).toMatchObject({
      status: 'queued',
      requests: [{
        name: '关键罗盘',
        kind: 'prop',
        autoGenerate: true,
        status: 'planned',
      }],
    })
  })

  it('writes back created asset ids to the requirement plan', () => {
    const original = requirementPlan()
    const updated = applyBackfillRequestsToRequirementPlan(original, [{
      name: '关键罗盘',
      kind: 'prop',
      semanticType: 'tool',
      summary: '关键罗盘',
      description: '关键罗盘参考图',
      sourcePanelIds: ['panel-1'],
      priority: 'blocking',
      autoGenerate: true,
      reason: '主道具需要跨镜保持外观一致',
      assetId: 'prop-created',
      status: 'created_asset_queued',
    }])

    expect(updated?.requirements[0].assetId).toBe('prop-created')
    expect(original.requirements[0].assetId).toBeNull()
  })

  it('plans auto-generation for missing stable character assets', () => {
    const characterPlan = characterRequirementPlan()
    const decision: PanelGenerationRouteDecision = {
      ...routeDecision('asset_backfill'),
      blockingAssetNames: ['主角'],
      noReferenceReason: 'character_asset_backfill_required',
    }
    const plan = planMissingAssetBackfill({
      panelId: 'panel-2',
      bindingPlan: bindingPlan(characterPlan),
      decision,
    })

    expect(plan).toMatchObject({
      status: 'queued',
      requests: [{
        name: '主角',
        kind: 'character',
        autoGenerate: true,
        status: 'planned',
      }],
    })
  })
})

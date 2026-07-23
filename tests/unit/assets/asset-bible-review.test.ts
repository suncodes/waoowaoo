import { describe, expect, it } from 'vitest'
import { reviewAssetBible } from '@/lib/assets/asset-bible-review'
import type { AssetBibleItem } from '@/lib/assets/asset-bible'

function asset(overrides: Partial<AssetBibleItem> = {}): AssetBibleItem {
  return {
    id: 'asset-1',
    kind: 'character',
    canonicalName: '尼摩船长',
    aliases: ['船长'],
    role: 'primary',
    narrativeFunction: '推动深海冒险的核心人物',
    evidence: [{ sourceId: 'segment-1', text: '尼摩船长驾驶潜艇', confidence: 0.85 }],
    visualInvariants: ['深色船长制服，冷峻神情，十九世纪幻想工业气质'],
    allowedVariants: [],
    forbiddenVariants: ['不要替换为现代军官'],
    firstAppearance: 'segment-1',
    usedByPanels: [],
    priority: 'must_lock',
    generationNeed: 'reference_required',
    ...overrides,
  }
}

describe('asset bible review', () => {
  it('passes a traceable and drawable asset bible', () => {
    const review = reviewAssetBible({
      targetId: 'episode-1',
      assetBible: [asset()],
      expectedAssetIds: ['asset-1'],
      reviewedAt: '2026-07-23T00:00:00.000Z',
    })

    expect(review).toMatchObject({
      reviewKind: 'asset_bible',
      status: 'passed',
      route: 'NONE',
      assetCount: 1,
      mustLockCount: 1,
    })
  })

  it('requires must-lock assets to have evidence and unique aliases', () => {
    const review = reviewAssetBible({
      targetId: 'episode-1',
      assetBible: [
        asset({ id: 'asset-1', evidence: [] }),
        asset({ id: 'asset-2', canonicalName: '船长', aliases: ['尼摩船长'] }),
      ],
      expectedAssetIds: ['asset-1', 'asset-2'],
    })

    expect(review.status).toBe('human_required')
    expect(review.route).toBe('ASSET_REPAIR')
    expect(review.criticalIssues).toEqual(expect.arrayContaining([
      expect.stringContaining('must_lock 资产缺少可追溯证据'),
      expect.stringContaining('存在重复名称或别名'),
    ]))
  })

  it('flags missing usage plan only when visual usage is required', () => {
    const review = reviewAssetBible({
      targetId: 'episode-1',
      assetBible: [asset({ usedByPanels: [] })],
      expectedAssetIds: ['asset-1'],
      requireUsagePlan: true,
    })

    expect(review.status).toBe('repairable')
    expect(review.route).toBe('ASSET_REPAIR')
    expect(review.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'usage_plan',
        issues: [expect.stringContaining('must_lock 资产缺少镜头使用计划')],
      }),
    ]))
  })
})

import { describe, expect, it } from 'vitest'
import {
  bindStoredVisualUnitsToAnchors,
  bindVisualUnitsToAnchors,
  buildVisualAnchors,
} from '@/lib/creation-workspace/visual-anchors'

describe('visual anchors', () => {
  it('classifies the Nautilus as a core vehicle and binds it by stable asset id', () => {
    const anchors = buildVisualAnchors({
      contentPlan: {
        planType: 'guide',
        segments: [{ id: 'segment-1', narration: '鹦鹉螺号带领读者进入海底世界。' }],
      },
      clips: [{ id: 'clip-1', content: '鹦鹉螺号带领读者进入海底世界。' }],
      characters: [],
      locations: [{
        id: 'asset-nautilus',
        name: '鹦鹉螺号',
        summary: '尼摩船长的潜水艇',
        assetKind: 'prop',
      }],
    })
    expect(anchors).toEqual([
      expect.objectContaining({
        assetId: 'asset-nautilus',
        assetKind: 'prop',
        semanticKind: 'vehicle',
        importance: 'core',
      }),
    ])

    const units = bindVisualUnitsToAnchors([{
      id: 'unit-1',
      clipId: 'clip-1',
      description: '鹦鹉螺号穿过海底峡谷',
    }], anchors)
    expect(units[0].assetRefs).toEqual([{
      id: 'asset-nautilus',
      kind: 'prop',
      name: '鹦鹉螺号',
    }])
  })

  it('rebinds a stored visual plan when an asset is identified later', () => {
    const anchors = [{
      id: 'prop:asset-nautilus',
      assetId: 'asset-nautilus',
      assetKind: 'prop' as const,
      semanticKind: 'vehicle' as const,
      name: '鹦鹉螺号',
      description: '尼摩船长的潜水艇',
      importance: 'core' as const,
      sourceUnitIds: ['clip-1'],
    }]
    const units = bindStoredVisualUnitsToAnchors([{
      id: 'unit-1',
      clipId: 'clip-1',
      description: '海底航行',
      assetRefs: [],
    }], anchors)
    expect(units).toEqual([
      expect.objectContaining({
        assetRefs: [{ id: 'asset-nautilus', kind: 'prop', name: '鹦鹉螺号' }],
      }),
    ])
  })

  it('uses stored character aliases when detecting and binding visual anchors', () => {
    const anchors = buildVisualAnchors({
      contentPlan: {
        planType: 'guide',
        segments: [{ id: 'segment-1', narration: '船长第一次走进深海指挥室。' }],
      },
      clips: [{ id: 'clip-1', content: '船长盯着仪表盘，没有说话。' }],
      characters: [{
        id: 'char-nemo',
        name: '尼摩船长',
        aliases: JSON.stringify(['船长', 'Nemo']),
        introduction: '神秘的潜艇指挥者',
      }],
      locations: [],
    })

    expect(anchors).toEqual([
      expect.objectContaining({
        assetId: 'char-nemo',
        aliases: ['船长', 'Nemo'],
        sourceUnitIds: ['segment-1', 'clip-1'],
      }),
    ])

    const units = bindVisualUnitsToAnchors([{
      id: 'unit-1',
      clipId: 'clip-2',
      description: 'Nemo 转身看向舷窗',
    }], anchors)
    expect(units[0].assetRefs).toEqual([{
      id: 'char-nemo',
      kind: 'character',
      name: '尼摩船长',
    }])
  })
})

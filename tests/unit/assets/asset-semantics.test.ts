import { describe, expect, it } from 'vitest'
import {
  buildAssetMeta,
  inferAssetSemanticType,
  inferAssetUsageScope,
} from '@/lib/assets/asset-semantics'

describe('asset semantics', () => {
  it('classifies vehicle-like core objects separately from interior locations', () => {
    expect(inferAssetSemanticType({
      assetKind: 'prop',
      name: '银星号潜艇本体',
      description: '长梭形金属船体，圆形舷窗，稳定外观需要跨镜头一致',
    })).toBe('vehicle')

    expect(inferAssetSemanticType({
      assetKind: 'location',
      name: '银星号内部驾驶舱',
      description: '金属仪表、舷窗、环形操作台组成的内部空间',
    })).toBe('interior_location')
  })

  it('builds a reusable meta contract for must-lock assets', () => {
    const meta = buildAssetMeta({
      assetKind: 'prop',
      name: '银星号潜艇本体',
      description: '核心载具外观',
      importance: 'core',
      sourceUnitIds: ['clip-1', 'clip-2'],
    })

    expect(meta).toEqual({
      semanticType: 'vehicle',
      assetTier: 'hero',
      usageScope: 'prop_detail',
    })
  })

  it('keeps symbols style-only unless an explicit scope overrides them', () => {
    expect(inferAssetUsageScope({
      assetKind: 'prop',
      semanticType: 'symbol',
    })).toBe('style_only')

    expect(inferAssetUsageScope({
      assetKind: 'prop',
      semanticType: 'symbol',
      explicitUsageScope: 'prop_detail',
    })).toBe('prop_detail')
  })

  it('preserves an explicit magic-item semantic type instead of matching narrative wording', () => {
    expect(inferAssetSemanticType({
      assetKind: 'prop',
      name: '飞行道具',
      description: '核心标志性道具，需要跨镜保持稳定外观',
      explicitSemanticType: 'magic_item',
    })).toBe('magic_item')
  })
})

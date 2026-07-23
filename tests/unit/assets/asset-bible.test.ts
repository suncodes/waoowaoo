import { describe, expect, it } from 'vitest'
import { buildAssetBible } from '@/lib/assets/asset-bible'

describe('asset bible', () => {
  it('keeps aliases, evidence and visual-unit usage for stable assets', () => {
    const assetBible = buildAssetBible({
      anchors: [{
        assetId: 'char-nemo',
        assetKind: 'character',
        name: '尼摩船长',
        aliases: ['船长', 'Nemo'],
        description: '神秘的潜艇指挥者',
        importance: 'core',
        sourceUnitIds: ['segment-1', 'clip-1'],
      }],
      contentPlan: {
        planType: 'guide',
        segments: [{
          id: 'segment-1',
          title: '深海冒险',
          narration: '船长驾驶潜艇进入深海。',
          visualPurpose: '锁定尼摩船长和潜艇',
        }],
      },
      clips: [{
        id: 'clip-1',
        content: 'Nemo 沉默地看向窗外。',
      }],
      visualUnits: [{
        id: 'unit-1',
        assetRefs: [{ id: 'char-nemo', kind: 'character', name: '尼摩船长' }],
      }, {
        id: 'unit-2',
        description: 'Nemo 转身看向舷窗',
      }],
    })

    expect(assetBible).toEqual([
      expect.objectContaining({
        id: 'char-nemo',
        canonicalName: '尼摩船长',
        aliases: ['尼摩船长', '船长', 'Nemo'],
        priority: 'must_lock',
        generationNeed: 'reference_required',
        usedByPanels: ['unit-1', 'unit-2'],
        evidence: expect.arrayContaining([
          expect.objectContaining({ sourceId: 'segment-1', confidence: 0.85 }),
          expect.objectContaining({ sourceId: 'clip-1', confidence: 0.85 }),
        ]),
        visualInvariants: expect.arrayContaining(['船长', 'Nemo', '神秘的潜艇指挥者']),
      }),
    ])
  })
})

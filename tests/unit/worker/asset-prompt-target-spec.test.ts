import { describe, expect, it } from 'vitest'
import { buildAssetPromptSpec } from '@/lib/prompt-compiler/asset-prompt-compiler'
import { buildAssetPromptTargetSpec } from '@/lib/workers/handlers/visual-quality-review-helpers'

describe('asset prompt quality target', () => {
  it('carries the generated render contract into the quality target', () => {
    const promptSpec = buildAssetPromptSpec({
      assetId: 'prop-1',
      assetKind: 'prop',
      assetName: '流体道具',
      description: '流动雾状的抽象道具',
      semanticType: 'magic_item',
      extractedFacts: {
        physicalForm: 'amorphous',
        orientation: 'non_directional',
        silhouetteLocks: ['流动雾状轮廓'],
      },
      styleText: '手绘动画',
      locale: 'zh',
    })

    const targetSpec = buildAssetPromptTargetSpec({
      targetId: 'render-1',
      promptSpec,
      aspectRatio: '3:2',
    })

    expect(targetSpec).toMatchObject({
      targetType: 'prop',
      targetId: 'render-1',
      templateKind: 'prop_single_reference',
      assetRenderContract: {
        subjectPolicy: 'object_only',
        physicalForm: 'amorphous',
        orientation: 'non_directional',
      },
      props: ['流体道具'],
    })
    expect(targetSpec?.continuityRules).toEqual(expect.arrayContaining([
      expect.stringContaining('不得使用角色转面'),
    ]))
  })
})

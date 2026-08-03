import { describe, expect, it } from 'vitest'
import {
  resolvePanelVisualReferenceSelection,
  selectPanelVisualReferences,
  visualReferencesForGenerationRoute,
  type VisualReference,
} from '@/lib/visual-production/references'

function reference(params: Partial<VisualReference> & Pick<VisualReference, 'assetName' | 'url'>): VisualReference {
  return {
    assetId: params.assetId || null,
    renderId: params.renderId || null,
    assetKind: params.assetKind || 'character',
    assetName: params.assetName,
    url: params.url,
    role: params.role || 'supporting_identity',
    usage: params.usage || 'must_match',
    weight: params.weight ?? 0.75,
    source: params.source || 'requirement_plan',
  }
}

describe('panel visual reference selection', () => {
  it('keeps the complete candidate set separate from the submission-limited selection', () => {
    const selection = resolvePanelVisualReferenceSelection({
      panel: {
        visualType: 'illustration',
        renderMode: 'generated_image',
        photographyRules: JSON.stringify({
          assetBindingPlan: {
            schemaVersion: 1,
            primarySubject: '唐僧师徒',
            visualType: 'illustration',
            renderMode: 'generated_image',
            bindings: [
              { id: 'character-1', kind: 'character', name: '唐僧', role: 'primary_identity', source: 'requirement_plan', weight: 1 },
              { id: 'character-2', kind: 'character', name: '孙悟空', role: 'supporting_identity', source: 'requirement_plan', weight: 0.75 },
              { id: 'character-3', kind: 'character', name: '猪八戒', role: 'supporting_identity', source: 'requirement_plan', weight: 0.75 },
              { id: 'character-4', kind: 'character', name: '白龙马', role: 'supporting_identity', source: 'requirement_plan', weight: 0.75 },
              { id: 'location-1', kind: 'location', name: '取经古道', role: 'environment', source: 'requirement_plan', weight: 0.6 },
            ],
            suppressed: [],
            warnings: [],
            complexity: { score: 0, level: 'low', recommendedAction: 'generate', riskFlags: [] },
            usedShotSpec: true,
            requirementPlan: null,
          },
        }),
      },
      projectData: {
        characters: [
          { id: 'character-1', name: '唐僧', appearances: [{ id: 'render-1', changeReason: null, imageUrls: '["tang.png"]', imageUrl: null, selectedIndex: 0 }] },
          { id: 'character-2', name: '孙悟空', appearances: [{ id: 'render-2', changeReason: null, imageUrls: '["sun.png"]', imageUrl: null, selectedIndex: 0 }] },
          { id: 'character-3', name: '猪八戒', appearances: [{ id: 'render-3', changeReason: null, imageUrls: '["zhu.png"]', imageUrl: null, selectedIndex: 0 }] },
          { id: 'character-4', name: '白龙马', appearances: [{ id: 'render-4', changeReason: null, imageUrls: '["horse.png"]', imageUrl: null, selectedIndex: 0 }] },
        ],
        locations: [{ id: 'location-1', name: '取经古道', images: [{ id: 'render-5', imageIndex: 0, isSelected: true, imageUrl: 'road.png' }] }],
      },
    })

    expect(selection.candidates.map((item) => item.assetName)).toEqual(['唐僧', '孙悟空', '猪八戒', '白龙马', '取经古道'])
    expect(selection.selected.map((item) => item.assetName)).toEqual(['唐僧', '孙悟空', '猪八戒', '白龙马'])
    expect(selection.dropped.map((item) => item.assetName)).toEqual(['取经古道'])
  })

  it('does not duplicate a reference when style and asset sources use the same image', () => {
    const selection = selectPanelVisualReferences({
      panel: { visualType: 'illustration', renderMode: 'generated_image' },
      candidates: [
        reference({ assetName: '视觉风格参考图', url: 'same.png', assetKind: 'style', role: 'style_only', source: 'style', weight: 0.35 }),
        reference({ assetName: '主角', url: 'same.png', assetId: 'character-1', weight: 1 }),
      ],
    })

    expect(selection.candidates).toHaveLength(1)
    expect(selection.selected).toHaveLength(1)
  })

  it('uses the configured maximum consistently for candidate trimming', () => {
    const selection = selectPanelVisualReferences({
      panel: { visualType: 'illustration', renderMode: 'generated_image' },
      maxReferences: 2,
      candidates: [
        reference({ assetName: '主角', url: 'hero.png', weight: 1 }),
        reference({ assetName: '场景', url: 'scene.png', assetKind: 'location', role: 'environment', usage: 'adapt', weight: 0.6 }),
        reference({ assetName: '道具', url: 'prop.png', assetKind: 'prop', role: 'prop_detail', weight: 0.7 }),
      ],
    })

    expect(selection.maxReferences).toBe(2)
    expect(selection.selected.map((item) => item.assetName)).toEqual(['主角', '道具'])
    expect(selection.dropped.map((item) => item.assetName)).toEqual(['场景'])
  })

  it('includes a style reference in the same capped selection as asset references', () => {
    const selection = resolvePanelVisualReferenceSelection({
      panel: { visualType: 'illustration', renderMode: 'generated_image' },
      projectData: {},
      options: {
        maxReferences: 2,
        styleReferenceEnabled: true,
        styleReferenceImage: 'style.png',
        styleReferenceName: '视觉风格参考图',
      },
      additionalReferences: [
        reference({ assetName: '主角', url: 'hero.png', weight: 1 }),
        reference({ assetName: '场景', url: 'scene.png', assetKind: 'location', role: 'environment', usage: 'adapt', weight: 0.6 }),
      ],
    })

    expect(selection.selected.map((item) => item.assetName)).toEqual(['主角', '场景'])
    expect(selection.dropped.map((item) => item.assetName)).toEqual(['视觉风格参考图'])
  })

  it('does not let a style reference satisfy generation-route asset coverage', () => {
    const styleReference = reference({
      assetName: '视觉风格参考图',
      url: 'style.png',
      assetKind: 'style',
      role: 'style_only',
      usage: 'avoid_copy',
      source: 'style',
      weight: 0.35,
    })

    expect(visualReferencesForGenerationRoute([styleReference])).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { resolveAssetRenderContract } from '@/lib/assets/asset-render-contract'

describe('asset render contract', () => {
  it('uses extracted physical form over a stale graphic semantic classification', () => {
    const contract = resolveAssetRenderContract({
      assetKind: 'prop',
      semanticType: 'symbol',
      extractedFacts: {
        physical_form: 'amorphous',
        orientation: 'non_directional',
      },
    })

    expect(contract).toMatchObject({
      subjectPolicy: 'object_only',
      physicalForm: 'amorphous',
      orientation: 'non_directional',
      templateKind: 'prop_single_reference',
      requiresTurnaround: false,
    })
  })

  it('uses a turnaround only for directional rigid objects', () => {
    expect(resolveAssetRenderContract({
      assetKind: 'prop',
      semanticType: 'generic_object',
      extractedFacts: {
        physical_form: 'rigid',
        orientation: 'directional',
      },
    }).templateKind).toBe('prop_turnaround')

    expect(resolveAssetRenderContract({
      assetKind: 'prop',
      semanticType: 'magic_item',
    }).templateKind).toBe('prop_single_reference')
  })
})

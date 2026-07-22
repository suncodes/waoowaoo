import type {
  AssetRenderSummary,
  AssetVariantSummary,
  VisualAssetSummary,
} from '@/lib/assets/contracts'

export function visualAssetSelectionIndex(
  asset: VisualAssetSummary,
  variant: AssetVariantSummary,
  render: AssetRenderSummary,
): number {
  return asset.kind === 'character' ? render.index : variant.index
}

export function buildVisualAssetSelectPayload(
  asset: VisualAssetSummary,
  variant: AssetVariantSummary,
  render: AssetRenderSummary,
): Record<string, unknown> {
  const selectedIndex = visualAssetSelectionIndex(asset, variant, render)
  if (asset.kind === 'character') {
    return {
      id: asset.id,
      appearanceId: variant.id,
      selectedIndex,
    }
  }
  return {
    id: asset.id,
    imageIndex: selectedIndex,
  }
}

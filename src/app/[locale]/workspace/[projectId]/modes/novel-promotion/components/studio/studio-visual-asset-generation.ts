import type { VisualAssetSummary } from '@/lib/assets/contracts'

export function buildVisualAssetGeneratePayload(asset: VisualAssetSummary, count: number) {
  const primaryVariant = asset.variants[0]
  if (asset.kind === 'character') {
    return {
      id: asset.id,
      appearanceId: primaryVariant?.id,
      appearanceIndex: primaryVariant?.index ?? 0,
      count,
    }
  }
  return { id: asset.id, count }
}

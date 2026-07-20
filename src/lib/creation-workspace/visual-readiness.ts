import type { VisualAssetSummary } from '@/lib/assets/contracts'
import type { VisualAnchor } from './artifact-state'

export type WorkspaceVisualAssetStatus = 'running' | 'failed' | 'confirmed' | 'candidate' | 'missing'

export function selectedVisualAssetImage(asset: VisualAssetSummary | undefined): string | null {
  if (!asset) return null
  for (const variant of asset.variants) {
    const selected = variant.renders.find((render) => render.isSelected)
      || variant.renders.find((render) => render.index === variant.selectionState.selectedRenderIndex)
    if (selected?.imageUrl) return selected.imageUrl
  }
  return null
}

export function resolveVisualAssetStatus(asset: VisualAssetSummary | undefined): WorkspaceVisualAssetStatus {
  if (!asset) return 'missing'
  if (asset.taskState.lastError || asset.variants.some((variant) => !!variant.taskState.lastError)) return 'failed'
  if (asset.taskState.isRunning || asset.variants.some((variant) => variant.taskState.isRunning)) return 'running'
  if (selectedVisualAssetImage(asset)) return 'confirmed'
  if (asset.variants.some((variant) => variant.renders.some((render) => !!render.imageUrl))) return 'candidate'
  return 'missing'
}

export function resolveVisualAnchorReadiness(
  anchors: VisualAnchor[],
  assets: VisualAssetSummary[],
) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const items = anchors.map((anchor) => {
    const asset = assetById.get(anchor.assetId)
    return {
      anchor,
      asset,
      status: resolveVisualAssetStatus(asset),
      imageUrl: selectedVisualAssetImage(asset),
    }
  })
  const coreItems = items.filter((item) => item.anchor.importance === 'core')
  const missingCoreItems = coreItems.filter((item) => item.status !== 'confirmed')
  return {
    items,
    coreItems,
    supportingItems: items.filter((item) => item.anchor.importance === 'supporting'),
    missingCoreItems,
    confirmedCount: items.filter((item) => item.status === 'confirmed').length,
  }
}

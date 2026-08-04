import type { VisualAssetSummary } from '@/lib/assets/contracts'
import type { VisualAnchor } from '@/lib/creation-workspace/artifact-state'
import {
  resolveVisualAnchorReadiness,
  selectedVisualAssetImage,
} from '@/lib/creation-workspace/visual-readiness'
import type { VisualKitItem } from './StudioVisualAssetInspector'
import { resolveVisualAssetWorkflowPresentation } from './studio-visual-asset-status'

function assetDescription(asset: VisualAssetSummary) {
  if (asset.kind === 'character') return asset.introduction || asset.variants[0]?.description || ''
  return asset.summary || asset.variants[0]?.description || ''
}

function assetItem(params: {
  asset: VisualAssetSummary
  importance: VisualKitItem['importance']
}): VisualKitItem {
  const { asset } = params
  const presentation = resolveVisualAssetWorkflowPresentation(asset)
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    importance: params.importance,
    description: assetDescription(asset),
    status: presentation.status,
    statusLabel: presentation.label,
    imageUrl: selectedVisualAssetImage(asset),
    sourceCount: 0,
    backfill: asset.backfill || null,
    asset,
  }
}

export function buildVisualKitItems(
  anchors: VisualAnchor[],
  assets: VisualAssetSummary[],
  requiredAssetIds: ReadonlySet<string>,
): VisualKitItem[] {
  const readiness = resolveVisualAnchorReadiness(anchors, assets)
  const anchoredItems = readiness.items.map((item): VisualKitItem => {
    const presentation = resolveVisualAssetWorkflowPresentation(item.asset)
    return {
      id: item.anchor.id,
      name: item.anchor.name,
      kind: item.anchor.semanticKind,
      importance: item.anchor.importance,
      description: item.anchor.description,
      status: presentation.status,
      statusLabel: presentation.label,
      imageUrl: item.imageUrl,
      sourceCount: item.anchor.sourceUnitIds.length,
      backfill: item.asset?.backfill || null,
      asset: item.asset,
    }
  })

  if (anchoredItems.length === 0) {
    const scopedAssets = requiredAssetIds.size > 0
      ? assets.filter((asset) => requiredAssetIds.has(asset.id) || !!asset.backfill)
      : assets
    return scopedAssets.map((asset) => assetItem({
      asset,
      importance: requiredAssetIds.has(asset.id) ? 'core' : 'supporting',
    }))
  }

  const anchoredAssetIds = new Set(
    anchoredItems.flatMap((item) => item.asset ? [item.asset.id] : []),
  )
  const unanchoredBackfillItems = assets
    .filter((asset) => !!asset.backfill && !anchoredAssetIds.has(asset.id))
    .map((asset) => assetItem({ asset, importance: 'supporting' }))

  return [...anchoredItems, ...unanchoredBackfillItems]
}

import { describe, expect, it } from 'vitest'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import type { VisualAnchor } from '@/lib/creation-workspace/artifact-state'
import { buildVisualKitItems } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/studio/studio-visual-kit-items'

function locationAsset(params: {
  id: string
  name: string
  backfill?: boolean
}): VisualAssetSummary {
  return {
    id: params.id,
    scope: 'project',
    kind: 'location',
    family: 'visual',
    name: params.name,
    folderId: null,
    capabilities: {
      canGenerate: true,
      canSelectRender: true,
      canRevertRender: true,
      canModifyRender: true,
      canUploadRender: true,
      canBindVoice: false,
      canCopyFromGlobal: false,
    },
    ...(params.backfill ? {
      backfill: {
        sourcePanelIds: ['panel-1'],
        reason: '分镜缺少稳定场景参考',
      },
    } : {}),
    taskRefs: [],
    taskState: { isRunning: false, lastError: null },
    variants: [{
      id: `${params.id}-image-1`,
      index: 0,
      label: '候选图',
      description: null,
      selectionState: { selectedRenderIndex: null },
      renders: [{
        id: `${params.id}-render-1`,
        index: 0,
        imageUrl: null,
        media: null,
        isSelected: false,
        previousImageUrl: null,
        previousMedia: null,
        taskRefs: [],
        taskState: { isRunning: false, lastError: null },
      }],
      taskRefs: [],
      taskState: { isRunning: false, lastError: null },
    }],
    summary: null,
    selectedVariantId: null,
  }
}

const anchor: VisualAnchor = {
  id: 'anchor-main-location',
  assetId: 'location-main',
  assetKind: 'location',
  semanticKind: 'location',
  name: '主场景',
  description: '主场景资产',
  importance: 'core',
  sourceUnitIds: ['clip-1'],
}

describe('studio visual kit items', () => {
  it('keeps system-backfilled assets visible when formal visual anchors exist', () => {
    const items = buildVisualKitItems(
      [anchor],
      [
        locationAsset({ id: 'location-main', name: '主场景' }),
        locationAsset({ id: 'location-backfill', name: '临时码头', backfill: true }),
      ],
      new Set(['location-main']),
    )

    expect(items.map((item) => item.id)).toEqual(['anchor-main-location', 'location-backfill'])
    expect(items[1]).toMatchObject({
      name: '临时码头',
      importance: 'supporting',
      sourceCount: 0,
      backfill: { sourcePanelIds: ['panel-1'] },
    })
  })

  it('does not duplicate a backfilled asset that is already represented by an anchor', () => {
    const backfillAnchor: VisualAnchor = {
      ...anchor,
      id: 'anchor-backfill-location',
      assetId: 'location-backfill',
      name: '临时码头',
    }
    const items = buildVisualKitItems(
      [backfillAnchor],
      [locationAsset({ id: 'location-backfill', name: '临时码头', backfill: true })],
      new Set(),
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('anchor-backfill-location')
  })
})

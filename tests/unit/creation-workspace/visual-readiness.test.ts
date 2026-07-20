import { describe, expect, it } from 'vitest'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import type { VisualAnchor } from '@/lib/creation-workspace/artifact-state'
import { resolveVisualAnchorReadiness } from '@/lib/creation-workspace/visual-readiness'

function anchor(id: string, importance: VisualAnchor['importance']): VisualAnchor {
  return {
    id: `prop:${id}`,
    assetId: id,
    assetKind: 'prop',
    semanticKind: 'vehicle',
    name: '鹦鹉螺号',
    description: '尼摩船长的潜水艇',
    importance,
    sourceUnitIds: ['segment-1'],
  }
}

function asset(selected: boolean): VisualAssetSummary {
  return {
    id: 'nautilus',
    scope: 'project',
    kind: 'prop',
    family: 'visual',
    name: '鹦鹉螺号',
    folderId: null,
    summary: '尼摩船长的潜水艇',
    selectedVariantId: selected ? 'variant-1' : null,
    capabilities: {
      canGenerate: true,
      canSelectRender: true,
      canRevertRender: true,
      canModifyRender: true,
      canUploadRender: true,
      canBindVoice: false,
      canCopyFromGlobal: false,
    },
    taskRefs: [],
    taskState: { isRunning: false, lastError: null },
    variants: [{
      id: 'variant-1',
      index: 0,
      label: '标准形象',
      description: null,
      selectionState: { selectedRenderIndex: selected ? 0 : null },
      taskRefs: [],
      taskState: { isRunning: false, lastError: null },
      renders: [{
        id: 'render-1',
        index: 0,
        imageUrl: 'nautilus.png',
        media: null,
        isSelected: selected,
        previousImageUrl: null,
        previousMedia: null,
        taskRefs: [],
        taskState: { isRunning: false, lastError: null },
      }],
    }],
  }
}

describe('visual anchor readiness', () => {
  it('blocks a core anchor until a final render is selected', () => {
    const result = resolveVisualAnchorReadiness([anchor('nautilus', 'core')], [asset(false)])
    expect(result.missingCoreItems.map((item) => item.anchor.name)).toEqual(['鹦鹉螺号'])
    expect(result.confirmedCount).toBe(0)
  })

  it('marks the same anchor ready after selecting the reference image', () => {
    const result = resolveVisualAnchorReadiness([anchor('nautilus', 'core')], [asset(true)])
    expect(result.missingCoreItems).toHaveLength(0)
    expect(result.confirmedCount).toBe(1)
    expect(result.items[0].imageUrl).toBe('nautilus.png')
  })
})

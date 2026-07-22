import { describe, expect, it } from 'vitest'
import type {
  AssetRenderSummary,
  AssetVariantSummary,
  VisualAssetSummary,
} from '@/lib/assets/contracts'
import {
  buildVisualAssetSelectPayload,
  visualAssetSelectionIndex,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/studio/studio-visual-asset-selection'

function variant(index: number, renderIndex: number): AssetVariantSummary {
  return {
    id: `variant-${index}`,
    index,
    label: `Variant ${index}`,
    description: null,
    selectionState: { selectedRenderIndex: null },
    renders: [render(renderIndex)],
    taskRefs: [],
    taskState: { isRunning: false, lastError: null },
  }
}

function render(index: number): AssetRenderSummary {
  return {
    id: `render-${index}`,
    index,
    imageUrl: `image-${index}.png`,
    media: null,
    isSelected: false,
    previousImageUrl: null,
    previousMedia: null,
    taskRefs: [],
    taskState: { isRunning: false, lastError: null },
  }
}

function asset(kind: 'character' | 'location' | 'prop'): VisualAssetSummary {
  const base = {
    id: `${kind}-1`,
    scope: 'project' as const,
    family: 'visual' as const,
    name: kind,
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
    taskRefs: [],
    taskState: { isRunning: false, lastError: null },
    variants: [],
  }
  if (kind === 'character') {
    return {
      ...base,
      kind,
      introduction: null,
      profileData: null,
      profileConfirmed: null,
      profileTaskRefs: [],
      profileTaskState: { isRunning: false, lastError: null },
      voice: { voiceType: null, voiceId: null, customVoiceUrl: null, media: null },
    }
  }
  return {
    ...base,
    kind,
    summary: null,
    selectedVariantId: null,
  }
}

describe('studio visual asset selection', () => {
  it('uses the render index for character candidate selection', () => {
    const targetVariant = variant(2, 4)
    const targetRender = targetVariant.renders[0]

    expect(visualAssetSelectionIndex(asset('character'), targetVariant, targetRender)).toBe(4)
    expect(buildVisualAssetSelectPayload(asset('character'), targetVariant, targetRender)).toEqual({
      id: 'character-1',
      appearanceId: 'variant-2',
      selectedIndex: 4,
    })
  })

  it.each(['location', 'prop'] as const)('uses the variant index for %s candidate selection', (kind) => {
    const targetVariant = variant(2, 0)
    const targetRender = targetVariant.renders[0]

    expect(visualAssetSelectionIndex(asset(kind), targetVariant, targetRender)).toBe(2)
    expect(buildVisualAssetSelectPayload(asset(kind), targetVariant, targetRender)).toEqual({
      id: `${kind}-1`,
      imageIndex: 2,
    })
  })
})

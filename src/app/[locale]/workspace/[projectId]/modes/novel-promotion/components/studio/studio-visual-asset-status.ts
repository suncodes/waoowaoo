'use client'

import type { AssetTaskState, VisualAssetSummary } from '@/lib/assets/contracts'
import { selectedVisualAssetImage } from '@/lib/creation-workspace/visual-readiness'
import {
  resolveVisualWorkflowPresentation,
  type VisualWorkflowPresentation,
} from '@/lib/visual-workflow/status'
import type { StudioProductStatus } from './studio-types'

export type VisualAssetWorkflowPresentation = VisualWorkflowPresentation & {
  status: StudioProductStatus
}

function hasVisualCandidate(asset: VisualAssetSummary) {
  return asset.variants.some((variant) =>
    variant.renders.some((render) => !!render.imageUrl),
  )
}

function collectTaskStates(asset: VisualAssetSummary): AssetTaskState[] {
  return [
    asset.taskState,
    ...asset.variants.flatMap((variant) => [
      variant.taskState,
      ...variant.renders.map((render) => render.taskState),
    ]),
  ]
}

export function resolveVisualAssetWorkflowPresentation(
  asset: VisualAssetSummary | undefined,
  options: { isSubmitting?: boolean } = {},
): VisualAssetWorkflowPresentation {
  if (options.isSubmitting) {
    return resolveVisualWorkflowPresentation({
      isSubmitting: true,
      emptyLabel: '未生成',
    }) as VisualAssetWorkflowPresentation
  }
  if (!asset) {
    return {
      status: 'empty',
      label: '未生成',
      blocksConfirmation: false,
      progress: null,
      phase: 'idle',
      activeTaskType: null,
    }
  }

  const states = collectTaskStates(asset)
  const hasError = states.some((state) => !!state.lastError)
  return resolveVisualWorkflowPresentation({
    isSubmitting: options.isSubmitting,
    taskStates: states,
    hasCandidates: hasVisualCandidate(asset),
    hasPrimaryImage: !!selectedVisualAssetImage(asset),
    hasError,
    emptyLabel: '未生成',
  }) as VisualAssetWorkflowPresentation
}

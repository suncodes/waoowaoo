'use client'

import type { AssetTaskState, VisualAssetSummary } from '@/lib/assets/contracts'
import { selectedVisualAssetImage } from '@/lib/creation-workspace/visual-readiness'
import type { StudioProductStatus } from './studio-types'

const IMAGE_TASK_TYPES = new Set([
  'image_character',
  'image_location',
  'modify_asset_image',
  'regenerate_group',
  'asset_hub_image',
  'asset_hub_modify',
])

const WAITING_REVIEW_GRACE_MS = 30_000

export type VisualAssetWorkflowPresentation = {
  status: StudioProductStatus
  label: string
  blocksConfirmation: boolean
  progress: number | null
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

function taskStateRank(state: AssetTaskState): number {
  if (state.phase === 'processing') return 5
  if (state.phase === 'queued') return 4
  if (state.phase === 'failed') return 3
  if (state.phase === 'completed') return 2
  return 1
}

function isNewerTaskState(current: AssetTaskState, candidate: AssetTaskState) {
  const currentTs = current.updatedAt ? Date.parse(current.updatedAt) : 0
  const candidateTs = candidate.updatedAt ? Date.parse(candidate.updatedAt) : 0
  return candidateTs > currentTs
}

function selectTaskState(states: AssetTaskState[]) {
  return states.reduce<AssetTaskState | null>((selected, state) => {
    if (!selected) return state
    const selectedRank = taskStateRank(selected)
    const stateRank = taskStateRank(state)
    if (stateRank !== selectedRank) return stateRank > selectedRank ? state : selected
    return isNewerTaskState(selected, state) ? state : selected
  }, null)
}

function isActiveTask(state: AssetTaskState | null) {
  return state?.phase === 'queued' || state?.phase === 'processing'
}

function isRecentImageGeneration(state: AssetTaskState | null) {
  if (!state || state.phase !== 'completed' || !state.taskType || !IMAGE_TASK_TYPES.has(state.taskType)) return false
  if (!state.updatedAt) return false
  const updatedAt = Date.parse(state.updatedAt)
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= WAITING_REVIEW_GRACE_MS
}

function repairRoundLabel(state: AssetTaskState | null) {
  if (!state?.attempt || state.attempt <= 0) return ''
  if (state.maxAttempts && state.maxAttempts > 0) return `（${state.attempt}/${state.maxAttempts}）`
  return `（第 ${state.attempt} 轮）`
}

function activeTaskLabel(state: AssetTaskState) {
  if (state.taskType === 'visual_quality_review') {
    if (state.phase === 'queued') return state.attempt && state.attempt > 0 ? '等待复查' : '等待检查'
    return state.attempt && state.attempt > 0
      ? `复查中${repairRoundLabel(state)}`
      : '检查中'
  }
  if (state.taskType === 'visual_auto_repair') {
    return state.phase === 'queued'
      ? `等待修复${repairRoundLabel(state)}`
      : `修复中${repairRoundLabel(state)}`
  }
  if (state.taskType && IMAGE_TASK_TYPES.has(state.taskType)) return '生成中'
  return state.phase === 'queued' ? '等待处理' : '处理中'
}

export function resolveVisualAssetWorkflowPresentation(
  asset: VisualAssetSummary | undefined,
  options: { isSubmitting?: boolean } = {},
): VisualAssetWorkflowPresentation {
  if (options.isSubmitting) {
    return {
      status: 'generating',
      label: '提交中',
      blocksConfirmation: true,
      progress: null,
    }
  }
  if (!asset) {
    return {
      status: 'empty',
      label: '未生成',
      blocksConfirmation: false,
      progress: null,
    }
  }

  const states = collectTaskStates(asset)
  const activeState = states.find(isActiveTask) || null
  const selectedState = activeState || selectTaskState(states)
  const hasError = states.some((state) => !!state.lastError)
  if (activeState) {
    return {
      status: 'generating',
      label: activeTaskLabel(activeState),
      blocksConfirmation: true,
      progress: activeState.progress ?? null,
    }
  }
  if (hasError) {
    return {
      status: 'failed',
      label: '失败',
      blocksConfirmation: false,
      progress: selectedState?.progress ?? null,
    }
  }
  if (isRecentImageGeneration(selectedState) && hasVisualCandidate(asset) && !selectedVisualAssetImage(asset)) {
    return {
      status: 'generating',
      label: '等待检查',
      blocksConfirmation: true,
      progress: null,
    }
  }
  if (selectedVisualAssetImage(asset)) {
    return {
      status: 'locked',
      label: '已确认',
      blocksConfirmation: false,
      progress: selectedState?.progress ?? null,
    }
  }
  if (hasVisualCandidate(asset)) {
    return {
      status: 'needs_review',
      label: '待确认',
      blocksConfirmation: false,
      progress: selectedState?.progress ?? null,
    }
  }
  return {
    status: 'empty',
    label: '未生成',
    blocksConfirmation: false,
    progress: selectedState?.progress ?? null,
  }
}

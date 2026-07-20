import type { CreationStageStatus } from './stages'

export type VisualDesignFooterBlockReason =
  | 'upstream_incomplete'
  | 'task_running'
  | 'generation_required'
  | 'checking_assets'
  | 'missing_anchors'
  | 'missing_core_assets'

export type VisualDesignFooterAction =
  | { kind: 'none'; reason: VisualDesignFooterBlockReason }
  | { kind: 'approve'; disabled: boolean; reason?: VisualDesignFooterBlockReason }
  | { kind: 'continue' }

interface ResolveVisualDesignFooterActionInput {
  contentReady: boolean
  stageStatus: CreationStageStatus
  hasPlan: boolean
  taskRunning: boolean
  assetsLoading: boolean
  assetAnalysisRunning: boolean
  missingAnchors: boolean
  missingCoreCount: number
}

export function resolveVisualDesignFooterAction({
  contentReady,
  stageStatus,
  hasPlan,
  taskRunning,
  assetsLoading,
  assetAnalysisRunning,
  missingAnchors,
  missingCoreCount,
}: ResolveVisualDesignFooterActionInput): VisualDesignFooterAction {
  if (!contentReady) return { kind: 'none', reason: 'upstream_incomplete' }
  if (taskRunning || stageStatus === 'running') return { kind: 'none', reason: 'task_running' }
  if (stageStatus === 'completed') return { kind: 'continue' }
  if (!hasPlan || stageStatus === 'ready' || stageStatus === 'failed' || stageStatus === 'stale') {
    return { kind: 'none', reason: 'generation_required' }
  }
  if (assetsLoading || assetAnalysisRunning) {
    return { kind: 'approve', disabled: true, reason: 'checking_assets' }
  }
  if (missingAnchors) {
    return { kind: 'approve', disabled: true, reason: 'missing_anchors' }
  }
  if (missingCoreCount > 0) {
    return { kind: 'approve', disabled: true, reason: 'missing_core_assets' }
  }
  return { kind: 'approve', disabled: false }
}

export function resolveStoryboardFooterAction({
  stageStatus,
  taskRunning,
}: {
  stageStatus: CreationStageStatus
  taskRunning: boolean
}): 'none' | 'continue' {
  if (taskRunning) return 'none'
  return stageStatus === 'completed' ? 'continue' : 'none'
}

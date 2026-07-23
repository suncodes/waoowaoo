import type { ImageQualityReviewResult, RepairAction } from '@/lib/visual-quality'

export type VisualCandidateGroupOrigin = 'initial' | 'repair'

export interface VisualCandidateGroup {
  id: string
  versionHash: string
  label: string
  origin: VisualCandidateGroupOrigin
  attempt: number
  candidateUrls: string[]
  sourceCandidateUrl: string | null
  action: Extract<RepairAction, 'edit' | 'regenerate'> | null
  createdAt: string
}

export interface VisualQualityState {
  schemaVersion: 1
  mode: 'shadow' | 'auto'
  // approved 表示机器审核通过并给出推荐候选；只有 humanConfirmedAt 非空才表示用户定稿。
  status: 'pending' | 'reviewing' | 'shadow_completed' | 'repairing' | 'approved' | 'human_required' | 'failed'
  versionHash: string
  candidateUrls: string[]
  candidateGroups: VisualCandidateGroup[]
  // 当前推荐/预览候选，不等同于最终定稿图。
  activeCandidateUrl: string | null
  attempt: number
  maxAttempts: number
  lastAction: RepairAction | null
  review: ImageQualityReviewResult | null
  humanConfirmedAt: string | null
  updatedAt: string
}

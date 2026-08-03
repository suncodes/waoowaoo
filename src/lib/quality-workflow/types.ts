import type { ImageQualityReviewResult, RepairAction } from '@/lib/visual-quality'
import type { VisualAutoRepairLineage } from '@/lib/creative-quality/contracts'

export type VisualCandidateGroupOrigin = 'initial' | 'repair'

export interface VisualCandidatePromptSnapshotRef {
  artifactId: string
  runId: string
  promptHash: string
  inputHash: string
  preparationHash: string | null
  createdAt: string
}

export interface VisualCandidateGroup {
  id: string
  versionHash: string
  label: string
  origin: VisualCandidateGroupOrigin
  attempt: number
  candidateUrls: string[]
  sourceCandidateUrl: string | null
  action: Extract<RepairAction, 'edit' | 'regenerate'> | null
  promptSnapshot: VisualCandidatePromptSnapshotRef | null
  createdAt: string
}

export interface VisualQualityState {
  schemaVersion: 1
  mode: 'shadow' | 'auto'
  // approved 表示机器审核通过并给出推荐候选；approved_by_user/approved_with_warnings 表示用户已定稿。
  // 只有 humanConfirmedAt 非空才表示用户定稿。
  status:
    | 'pending'
    | 'reviewing'
    | 'shadow_completed'
    | 'repairing'
    | 'approved'
    | 'approved_by_user'
    | 'approved_with_warnings'
    | 'human_required'
    | 'failed'
  versionHash: string
  candidateUrls: string[]
  candidateGroups: VisualCandidateGroup[]
  // 当前推荐/预览候选，不等同于最终定稿图。
  activeCandidateUrl: string | null
  attempt: number
  maxAttempts: number
  lastAction: RepairAction | null
  review: ImageQualityReviewResult | null
  repairLineage: VisualAutoRepairLineage[]
  humanConfirmedAt: string | null
  updatedAt: string
}

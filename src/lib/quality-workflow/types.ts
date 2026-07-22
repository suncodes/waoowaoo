import type { ImageQualityReviewResult, RepairAction } from '@/lib/visual-quality'

export interface VisualQualityState {
  schemaVersion: 1
  mode: 'shadow' | 'auto'
  status: 'pending' | 'reviewing' | 'shadow_completed' | 'repairing' | 'approved' | 'human_required' | 'failed'
  versionHash: string
  candidateUrls: string[]
  activeCandidateUrl: string | null
  attempt: number
  maxAttempts: number
  lastAction: RepairAction | null
  review: ImageQualityReviewResult | null
  humanConfirmedAt: string | null
  updatedAt: string
}

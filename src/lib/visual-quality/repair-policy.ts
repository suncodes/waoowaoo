export type VisualRepairAssetKind = 'character' | 'location' | 'prop'

export const VISUAL_REPAIR_MAX_ATTEMPTS = 1
export const VISUAL_REPAIR_CANDIDATE_COUNT = 2

export const VISUAL_REPAIR_ASSET_CANDIDATE_LIMIT: Record<VisualRepairAssetKind, number> = {
  character: 6,
  location: 5,
  prop: 5,
}

export const VISUAL_REPAIR_PANEL_CANDIDATE_LIMIT = 4

export function resolveVisualRepairCandidateCount(params: {
  currentCandidateCount: number
  maxCandidateCount: number
}): number {
  const remaining = Math.max(0, Math.floor(params.maxCandidateCount) - Math.max(0, Math.floor(params.currentCandidateCount)))
  return Math.min(VISUAL_REPAIR_CANDIDATE_COUNT, remaining)
}

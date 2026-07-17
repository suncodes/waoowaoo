import type { ImageQualityReviewResult, RepairAction } from '@/lib/visual-quality'
import type { VisualQualityState } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseVisualQualityState(value: unknown): VisualQualityState | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  const candidateUrls = Array.isArray(value.candidateUrls)
    ? value.candidateUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const allowedStatuses = new Set<VisualQualityState['status']>([
    'pending',
    'reviewing',
    'shadow_completed',
    'repairing',
    'approved',
    'human_required',
    'failed',
  ])
  const status = typeof value.status === 'string' && allowedStatuses.has(value.status as VisualQualityState['status'])
    ? value.status as VisualQualityState['status']
    : 'pending'
  return {
    schemaVersion: 1,
    mode: value.mode === 'auto' ? 'auto' : 'shadow',
    status,
    versionHash: typeof value.versionHash === 'string' ? value.versionHash : '',
    candidateUrls,
    activeCandidateUrl: typeof value.activeCandidateUrl === 'string' ? value.activeCandidateUrl : null,
    attempt: typeof value.attempt === 'number' && Number.isFinite(value.attempt) ? Math.max(0, Math.floor(value.attempt)) : 0,
    maxAttempts: typeof value.maxAttempts === 'number' && Number.isFinite(value.maxAttempts)
      ? Math.min(2, Math.max(0, Math.floor(value.maxAttempts)))
      : 2,
    lastAction: typeof value.lastAction === 'string' ? value.lastAction as RepairAction : null,
    review: isRecord(value.review) ? value.review as unknown as ImageQualityReviewResult : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
  }
}

export function createVisualQualityState(params: {
  mode: VisualQualityState['mode']
  status: VisualQualityState['status']
  versionHash: string
  candidateUrls: string[]
  activeCandidateUrl?: string | null
  attempt?: number
  maxAttempts?: number
  lastAction?: RepairAction | null
  review?: ImageQualityReviewResult | null
}): VisualQualityState {
  return {
    schemaVersion: 1,
    mode: params.mode,
    status: params.status,
    versionHash: params.versionHash,
    candidateUrls: Array.from(new Set(params.candidateUrls.filter(Boolean))),
    activeCandidateUrl: params.activeCandidateUrl || null,
    attempt: Math.max(0, Math.floor(params.attempt || 0)),
    maxAttempts: Math.min(2, Math.max(0, Math.floor(params.maxAttempts ?? 2))),
    lastAction: params.lastAction || null,
    review: params.review || null,
    updatedAt: new Date().toISOString(),
  }
}

export function approveSelectedVisualCandidate(
  value: unknown,
  selectedUrl: string,
): VisualQualityState | null {
  const state = parseVisualQualityState(value)
  if (!state || !selectedUrl.trim()) return null
  return createVisualQualityState({
    ...state,
    status: state.mode === 'auto' ? 'approved' : 'shadow_completed',
    activeCandidateUrl: selectedUrl.trim(),
    lastAction: 'select_candidate',
  })
}

export * from './types'

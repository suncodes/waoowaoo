import type { ImageQualityReviewResult, RepairAction } from '@/lib/visual-quality'
import type { VisualCandidateGroup, VisualQualityState } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.flatMap((item) =>
    typeof item === 'string' && item.trim().length > 0 ? [item.trim()] : [],
  )))
}

function parseStringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? uniqueStrings(parsed) : []
  } catch {
    return []
  }
}

function normalizeCandidateGroup(value: unknown): VisualCandidateGroup | null {
  if (!isRecord(value)) return null
  const candidateUrls = parseStringArrayValue(value.candidateUrls)
  if (candidateUrls.length === 0) return null
  const origin = value.origin === 'repair' ? 'repair' : 'initial'
  const attempt = typeof value.attempt === 'number' && Number.isFinite(value.attempt)
    ? Math.max(0, Math.floor(value.attempt))
    : origin === 'repair' ? 1 : 0
  const action = value.action === 'edit' || value.action === 'regenerate' ? value.action : null
  const versionHash = typeof value.versionHash === 'string' && value.versionHash.trim()
    ? value.versionHash.trim()
    : `${origin}:${attempt}`
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim()
    : `${origin}:${attempt}:${versionHash}`
  const label = typeof value.label === 'string' && value.label.trim()
    ? value.label.trim()
    : origin === 'repair' ? `第 ${attempt} 轮修复` : '原始候选'
  return {
    id,
    versionHash,
    label,
    origin,
    attempt,
    candidateUrls,
    sourceCandidateUrl: typeof value.sourceCandidateUrl === 'string' && value.sourceCandidateUrl.trim()
      ? value.sourceCandidateUrl.trim()
      : null,
    action,
    createdAt: typeof value.createdAt === 'string' && value.createdAt.trim()
      ? value.createdAt
      : new Date(0).toISOString(),
  }
}

function normalizeCandidateGroups(value: unknown): VisualCandidateGroup[] {
  if (!Array.isArray(value)) return []
  const groups: VisualCandidateGroup[] = []
  const seenIds = new Set<string>()
  for (const item of value) {
    const group = normalizeCandidateGroup(item)
    if (!group || seenIds.has(group.id)) continue
    seenIds.add(group.id)
    groups.push(group)
  }
  return groups
}

export function createVisualCandidateGroup(params: {
  versionHash: string
  label?: string
  origin: VisualCandidateGroup['origin']
  attempt?: number
  candidateUrls: string[]
  sourceCandidateUrl?: string | null
  action?: VisualCandidateGroup['action']
  createdAt?: string
}): VisualCandidateGroup {
  const attempt = Math.max(0, Math.floor(params.attempt || 0))
  const versionHash = params.versionHash.trim() || `${params.origin}:${attempt}`
  return {
    id: `${params.origin}:${attempt}:${versionHash}`,
    versionHash,
    label: params.label || (params.origin === 'repair' ? `第 ${attempt} 轮修复` : '原始候选'),
    origin: params.origin,
    attempt,
    candidateUrls: uniqueStrings(params.candidateUrls),
    sourceCandidateUrl: params.sourceCandidateUrl?.trim() || null,
    action: params.action || null,
    createdAt: params.createdAt || new Date().toISOString(),
  }
}

export function flattenVisualCandidateGroups(groups: VisualCandidateGroup[]): string[] {
  return uniqueStrings(groups.flatMap((group) => group.candidateUrls))
}

export function appendVisualCandidateGroup(
  groups: VisualCandidateGroup[] | null | undefined,
  group: VisualCandidateGroup,
): VisualCandidateGroup[] {
  const normalizedGroups = normalizeCandidateGroups(groups || [])
  const normalizedGroup = normalizeCandidateGroup(group)
  if (!normalizedGroup) return normalizedGroups
  const next = normalizedGroups.filter((item) => item.id !== normalizedGroup.id)
  next.push(normalizedGroup)
  return next
}

export function resolveVisualCandidateGroups(params: {
  visualQualityState?: unknown
  candidateImages?: unknown
}): VisualCandidateGroup[] {
  const state = parseVisualQualityState(params.visualQualityState)
  const groups = state?.candidateGroups.length ? state.candidateGroups : []
  const knownUrls = flattenVisualCandidateGroups(groups)
  const fallbackUrls = uniqueStrings([
    ...knownUrls,
    ...(state?.candidateUrls || []),
    ...parseStringArrayValue(params.candidateImages),
  ])
  if (groups.length === 0) {
    return fallbackUrls.length > 0
      ? [createVisualCandidateGroup({
        versionHash: state?.versionHash || 'legacy-candidates',
        origin: 'initial',
        attempt: 0,
        candidateUrls: fallbackUrls,
        createdAt: state?.updatedAt,
      })]
      : []
  }
  const missingUrls = fallbackUrls.filter((url) => !knownUrls.includes(url))
  if (missingUrls.length === 0) return groups
  return [
    ...groups,
    createVisualCandidateGroup({
      versionHash: `${state?.versionHash || 'legacy'}:extra`,
      label: '历史候选',
      origin: 'initial',
      attempt: 0,
      candidateUrls: missingUrls,
      createdAt: state?.updatedAt,
    }),
  ]
}

export function resolveVisualCandidateUrls(params: {
  visualQualityState?: unknown
  candidateImages?: unknown
}): string[] {
  return flattenVisualCandidateGroups(resolveVisualCandidateGroups(params))
}

export function parseVisualQualityState(value: unknown): VisualQualityState | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  const candidateUrls = Array.isArray(value.candidateUrls)
    ? value.candidateUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const candidateGroups = normalizeCandidateGroups(value.candidateGroups)
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
    candidateGroups,
    activeCandidateUrl: typeof value.activeCandidateUrl === 'string' ? value.activeCandidateUrl : null,
    attempt: typeof value.attempt === 'number' && Number.isFinite(value.attempt) ? Math.max(0, Math.floor(value.attempt)) : 0,
    maxAttempts: typeof value.maxAttempts === 'number' && Number.isFinite(value.maxAttempts)
      ? Math.min(2, Math.max(0, Math.floor(value.maxAttempts)))
      : 2,
    lastAction: typeof value.lastAction === 'string' ? value.lastAction as RepairAction : null,
    review: isRecord(value.review) ? value.review as unknown as ImageQualityReviewResult : null,
    humanConfirmedAt: typeof value.humanConfirmedAt === 'string' && value.humanConfirmedAt.trim()
      ? value.humanConfirmedAt
      : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
  }
}

export function createVisualQualityState(params: {
  mode: VisualQualityState['mode']
  status: VisualQualityState['status']
  versionHash: string
  candidateUrls: string[]
  candidateGroups?: VisualCandidateGroup[]
  activeCandidateUrl?: string | null
  attempt?: number
  maxAttempts?: number
  lastAction?: RepairAction | null
  review?: ImageQualityReviewResult | null
  humanConfirmedAt?: string | null
}): VisualQualityState {
  return {
    schemaVersion: 1,
    mode: params.mode,
    status: params.status,
    versionHash: params.versionHash,
    candidateUrls: uniqueStrings(params.candidateUrls),
    candidateGroups: normalizeCandidateGroups(params.candidateGroups),
    activeCandidateUrl: params.activeCandidateUrl || null,
    attempt: Math.max(0, Math.floor(params.attempt || 0)),
    maxAttempts: Math.min(2, Math.max(0, Math.floor(params.maxAttempts ?? 2))),
    lastAction: params.lastAction || null,
    review: params.review || null,
    humanConfirmedAt: params.humanConfirmedAt || null,
    updatedAt: new Date().toISOString(),
  }
}

export function approveSelectedVisualCandidate(
  value: unknown,
  selectedUrl: string,
  candidateUrls: string[] = [],
): VisualQualityState | null {
  const state = parseVisualQualityState(value)
  if (!selectedUrl.trim()) return null
  const baseState = state || createVisualQualityState({
    mode: 'shadow',
    status: 'shadow_completed',
    versionHash: 'manual-confirmation',
    candidateUrls,
    activeCandidateUrl: selectedUrl.trim(),
    maxAttempts: 0,
  })
  return createVisualQualityState({
    ...baseState,
    candidateUrls: baseState.candidateUrls.length > 0 ? baseState.candidateUrls : candidateUrls,
    candidateGroups: baseState.candidateGroups.length > 0
      ? baseState.candidateGroups
      : resolveVisualCandidateGroups({
        visualQualityState: baseState,
        candidateImages: candidateUrls,
      }),
    status: baseState.mode === 'auto' ? 'approved' : 'shadow_completed',
    activeCandidateUrl: selectedUrl.trim(),
    lastAction: 'select_candidate',
    humanConfirmedAt: new Date().toISOString(),
  })
}

export function isVisualQualityProcessing(value: unknown): boolean {
  const state = parseVisualQualityState(value)
  return state?.mode === 'auto'
    && (state.status === 'pending' || state.status === 'reviewing' || state.status === 'repairing')
}

export function hasUnconfirmedVisualCandidates(
  candidateImages: unknown,
  visualQualityState: unknown,
): boolean {
  const candidateCount = resolveVisualCandidateUrls({ visualQualityState, candidateImages }).length
  if (candidateCount === 0) return false
  return !parseVisualQualityState(visualQualityState)?.humanConfirmedAt
}

export * from './types'

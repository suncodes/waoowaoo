import {
  parseVisualQualityState,
  type VisualCandidateGroup,
  type VisualQualityState,
} from '@/lib/quality-workflow'
import { resolveMediaRefFromLegacyValue } from './service'

function isPendingToken(value: string) {
  return value.startsWith('PENDING:')
}

function isStableMediaUrl(value: string) {
  return value.startsWith('/m/')
}

export async function resolveMediaValueToUrl(value: unknown): Promise<string | null> {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (isPendingToken(trimmed) || isStableMediaUrl(trimmed)) return trimmed
  const media = await resolveMediaRefFromLegacyValue(trimmed)
  return media?.url || trimmed
}

export async function resolveMediaValuesToUrls(values: string[]): Promise<string[]> {
  const urls = await Promise.all(values.map((value) => resolveMediaValueToUrl(value)))
  return urls.filter((value): value is string => !!value)
}

async function resolveCandidateGroupMediaUrls(group: VisualCandidateGroup): Promise<VisualCandidateGroup> {
  return {
    ...group,
    candidateUrls: await resolveMediaValuesToUrls(group.candidateUrls),
    sourceCandidateUrl: await resolveMediaValueToUrl(group.sourceCandidateUrl),
  }
}

export async function resolveVisualQualityStateMediaUrls(value: unknown): Promise<unknown> {
  const state = parseVisualQualityState(value)
  if (!state) return value
  const candidateGroups = await Promise.all(state.candidateGroups.map(resolveCandidateGroupMediaUrls))
  return {
    ...state,
    candidateUrls: await resolveMediaValuesToUrls(state.candidateUrls),
    candidateGroups,
    activeCandidateUrl: await resolveMediaValueToUrl(state.activeCandidateUrl),
  } satisfies VisualQualityState
}

import { parseVisualQualityState } from '@/lib/quality-workflow'

export interface VisualReadinessResult {
  ready: boolean
  status: 'ready' | 'shadow' | 'pending' | 'blocked'
  reasons: string[]
}

export function evaluateVisualReadiness(rawState: unknown): VisualReadinessResult {
  const state = parseVisualQualityState(rawState)
  if (!state) {
    return { ready: true, status: 'shadow', reasons: ['quality_state_missing'] }
  }
  if (state.mode === 'shadow') {
    return { ready: true, status: 'shadow', reasons: state.status === 'failed' ? ['shadow_review_failed'] : [] }
  }
  if (state.humanConfirmedAt) {
    return {
      ready: true,
      status: 'ready',
      reasons: state.status === 'approved_with_warnings' ? ['approved_with_warnings'] : [],
    }
  }
  if (state.status === 'approved' || state.status === 'approved_by_user' || state.status === 'approved_with_warnings') {
    return { ready: false, status: 'blocked', reasons: ['awaiting_human_confirmation'] }
  }
  if (state.status === 'human_required' || state.status === 'failed') {
    return { ready: false, status: 'blocked', reasons: [state.status] }
  }
  return { ready: false, status: 'pending', reasons: [state.status] }
}

import type {
  CandidateQualityReview,
  ImageQualityReviewResult,
  PromptPatch,
  RepairDecision,
  VisualQualityIssue,
  VisualQualityIssueCode,
} from './types'

type JsonRecord = Record<string, unknown>

const ISSUE_CODES = new Set<VisualQualityIssueCode>([
  'EMPTY_IMAGE',
  'UNREADABLE_IMAGE',
  'ASPECT_RATIO_MISMATCH',
  'DUPLICATE_CANDIDATE',
  'SUBJECT_MISMATCH',
  'CHARACTER_INCONSISTENT',
  'PROP_INCONSISTENT',
  'SCENE_INCONSISTENT',
  'COMPOSITION_ERROR',
  'TEXT_ERROR',
  'ANATOMY_ERROR',
  'STYLE_MISMATCH',
  'CONTINUITY_ERROR',
  'LOW_TECHNICAL_QUALITY',
])

export const VISUAL_REVIEW_PASS_MIN_SCORE = 80

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function parsePromptPatch(value: unknown): PromptPatch {
  const raw = isRecord(value) ? value : {}
  return {
    preserve: stringArray(raw.preserve),
    add: stringArray(raw.add),
    remove: stringArray(raw.remove),
    negative: stringArray(raw.negative),
    rationale: readString(raw.rationale),
  }
}

function parseIssue(value: unknown, index: number): VisualQualityIssue {
  if (!isRecord(value)) throw new Error(`VISUAL_REVIEW_INVALID: issue ${index} must be object`)
  const code = typeof value.code === 'string' && ISSUE_CODES.has(value.code as VisualQualityIssueCode)
    ? value.code as VisualQualityIssueCode
    : 'LOW_TECHNICAL_QUALITY'
  const severity = value.severity === 'critical' || value.severity === 'minor'
    ? value.severity
    : 'major'
  return {
    code,
    severity,
    message: readString(value.message, code),
    evidence: readString(value.evidence),
    repairHint: readString(value.repairHint),
  }
}

function parseCandidate(value: unknown, index: number): CandidateQualityReview {
  if (!isRecord(value)) throw new Error(`VISUAL_REVIEW_INVALID: candidate ${index} must be object`)
  const issues = (Array.isArray(value.issues) ? value.issues : []).map(parseIssue)
  const score = Math.round(boundedNumber(value.score, 0, 0, 100))
  const hasCriticalIssue = issues.some((issue) => issue.severity === 'critical')
  return {
    candidateIndex: Math.round(boundedNumber(value.candidateIndex, index, 0, 999)),
    score,
    confidence: boundedNumber(value.confidence, 0.5, 0, 1),
    passed: value.passed === true && score >= VISUAL_REVIEW_PASS_MIN_SCORE && !hasCriticalIssue,
    strengths: stringArray(value.strengths),
    issues,
  }
}

export function parseImageQualityReviewResult(
  value: unknown,
  versionHash: string,
): ImageQualityReviewResult {
  if (!isRecord(value)) throw new Error('VISUAL_REVIEW_INVALID: response must be object')
  const candidates = (Array.isArray(value.candidates) ? value.candidates : []).map(parseCandidate)
  if (candidates.length === 0) throw new Error('VISUAL_REVIEW_INVALID: candidates are required')
  const selectedCandidateIndex = typeof value.selectedCandidateIndex === 'number'
    ? Math.max(0, Math.floor(value.selectedCandidateIndex))
    : null
  const selected = selectedCandidateIndex === null
    ? null
    : candidates.find((candidate) => candidate.candidateIndex === selectedCandidateIndex) || null
  const issueCodes = Array.from(new Set(candidates.flatMap((candidate) => candidate.issues.map((issue) => issue.code))))
  const requestedStatus = value.status === 'passed' || value.status === 'human_required'
    ? value.status
    : 'repairable'
  const status = selected?.passed ? 'passed' : requestedStatus === 'passed' ? 'repairable' : requestedStatus
  return {
    schemaVersion: 1,
    versionHash,
    status,
    selectedCandidateIndex,
    score: Math.round(boundedNumber(value.score, selected?.score || 0, 0, 100)),
    confidence: boundedNumber(value.confidence, selected?.confidence || 0.5, 0, 1),
    candidates,
    issueCodes,
    promptPatch: parsePromptPatch(value.promptPatch),
    summary: readString(value.summary),
  }
}

export function decideVisualRepair(params: {
  review: ImageQualityReviewResult
  attempt: number
  maxAttempts: number
  autoApproveThreshold: number
  minConfidence: number
  editModelAvailable: boolean
}): RepairDecision {
  const { review } = params
  const selected = review.selectedCandidateIndex === null
    ? null
    : review.candidates.find((candidate) => candidate.candidateIndex === review.selectedCandidateIndex) || null

  if (
    review.status === 'passed'
    && selected?.passed
    && review.score >= params.autoApproveThreshold
    && review.confidence >= params.minConfidence
  ) {
    return {
      action: review.candidates.length > 1 ? 'select_candidate' : 'approve',
      candidateIndex: selected.candidateIndex,
      reason: 'quality threshold satisfied',
      promptPatch: review.promptPatch,
    }
  }

  if (review.status === 'human_required' || params.attempt >= params.maxAttempts) {
    return {
      action: 'human_required',
      candidateIndex: review.selectedCandidateIndex,
      reason: review.status === 'human_required' ? 'review requires human judgment' : 'repair attempts exhausted',
      promptPatch: review.promptPatch,
    }
  }

  const requiresRegeneration = review.issueCodes.some((code) => (
    code === 'EMPTY_IMAGE'
    || code === 'UNREADABLE_IMAGE'
    || code === 'SUBJECT_MISMATCH'
    || code === 'CONTINUITY_ERROR'
  ))
  return {
    action: params.editModelAvailable && !requiresRegeneration ? 'edit' : 'regenerate',
    candidateIndex: review.selectedCandidateIndex,
    reason: requiresRegeneration ? 'structural mismatch requires regeneration' : 'localized defects can be edited',
    promptPatch: review.promptPatch,
  }
}

export * from './types'
export { createVisualVersionHash } from './version'
export { assertVisionInputSupported } from './model-capability'
export { inspectVisualCandidates } from './technical-checks'
export type { VisualTechnicalCheck, VisualTechnicalIssue } from './technical-checks'

import type { VideoProfile } from '@/lib/video-profile'
import type {
  ContentPlan,
  ContentPlanResult,
  ContentReview,
  ContentReviewIssue,
  CreativeBrief,
  GuideContentPlan,
  GuideOutlineItem,
  GuideSegment,
  NarrativeBeat,
  NarrativeContentPlan,
  SourceAnchor,
} from './types'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`CONTENT_PLAN_INVALID: ${field} is required`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readSourceType(value: unknown): SourceAnchor['sourceType'] | undefined {
  if (
    value === 'model_knowledge' ||
    value === 'verified_source' ||
    value === 'user_source' ||
    value === 'reference_summary'
  ) {
    return value
  }
  return undefined
}

function parseSourceAnchor(value: unknown, field: string, required: boolean): SourceAnchor | undefined {
  if (!isRecord(value)) {
    if (required) throw new Error(`CONTENT_PLAN_INVALID: ${field} is required`)
    return undefined
  }
  const label = requiredString(value.label, `${field}.label`)
  const sourceType = readSourceType(value.sourceType)
  return {
    label,
    ...(optionalString(value.quote) ? { quote: optionalString(value.quote) } : {}),
    ...(optionalString(value.startText) ? { startText: optionalString(value.startText) } : {}),
    ...(optionalString(value.endText) ? { endText: optionalString(value.endText) } : {}),
    ...(optionalString(value.chapter) ? { chapter: optionalString(value.chapter) } : {}),
    ...(stringArray(value.visualAssetIds).length > 0
      ? { visualAssetIds: stringArray(value.visualAssetIds) }
      : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? { confidence: boundedNumber(value.confidence, 0.7, 0, 1) }
      : {}),
  }
}

function parseCreativeBrief(value: unknown, profile: VideoProfile): CreativeBrief {
  if (!isRecord(value)) throw new Error('CONTENT_PLAN_INVALID: creativeBrief is required')
  return {
    schemaVersion: 1,
    profilePreset: profile.preset,
    objective: requiredString(value.objective, 'creativeBrief.objective'),
    audience: optionalString(value.audience) || profile.audience,
    audiencePromise: requiredString(value.audiencePromise, 'creativeBrief.audiencePromise'),
    targetDurationSec: Math.round(boundedNumber(
      value.targetDurationSec,
      profile.targetDurationSec,
      15,
      3600,
    )),
    tone: stringArray(value.tone),
    mustInclude: stringArray(value.mustInclude),
    mustAvoid: stringArray(value.mustAvoid),
  }
}

function parseNarrativePlan(value: JsonRecord): NarrativeContentPlan {
  const rawBeats = Array.isArray(value.beats) ? value.beats : []
  const beats: NarrativeBeat[] = rawBeats.map((item, index) => {
    if (!isRecord(item)) throw new Error(`CONTENT_PLAN_INVALID: beats.${index} must be object`)
    const sourceAnchor = parseSourceAnchor(item.sourceAnchor, `beats.${index}.sourceAnchor`, false)
    return {
      id: optionalString(item.id) || `beat_${index + 1}`,
      title: requiredString(item.title, `beats.${index}.title`),
      purpose: requiredString(item.purpose, `beats.${index}.purpose`),
      summary: requiredString(item.summary, `beats.${index}.summary`),
      estimatedDurationSec: Math.round(boundedNumber(item.estimatedDurationSec, 15, 2, 600)),
      ...(sourceAnchor ? { sourceAnchor } : {}),
    }
  })
  if (beats.length === 0) throw new Error('CONTENT_PLAN_INVALID: narrative beats are required')
  return {
    schemaVersion: 1,
    planType: 'narrative',
    title: requiredString(value.title, 'contentPlan.title'),
    logline: requiredString(value.logline, 'contentPlan.logline'),
    themes: stringArray(value.themes),
    beats,
  }
}

function parseGuidePlan(value: JsonRecord): GuideContentPlan {
  const rawOutline = Array.isArray(value.outline) ? value.outline : []
  const outline: GuideOutlineItem[] = rawOutline.map((item, index) => {
    if (!isRecord(item)) throw new Error(`CONTENT_PLAN_INVALID: outline.${index} must be object`)
    return {
      id: optionalString(item.id) || `outline_${index + 1}`,
      title: requiredString(item.title, `outline.${index}.title`),
      question: requiredString(item.question, `outline.${index}.question`),
      takeaway: requiredString(item.takeaway, `outline.${index}.takeaway`),
    }
  })
  const outlineIds = new Set(outline.map((item) => item.id))
  const rawSegments = Array.isArray(value.segments) ? value.segments : []
  const segments: GuideSegment[] = rawSegments.map((item, index) => {
    if (!isRecord(item)) throw new Error(`CONTENT_PLAN_INVALID: segments.${index} must be object`)
    const outlineId = optionalString(item.outlineId) || outline[index]?.id || outline[0]?.id
    if (!outlineId || !outlineIds.has(outlineId)) {
      throw new Error(`CONTENT_PLAN_INVALID: segments.${index}.outlineId is invalid`)
    }
    const spoilerLevel = item.spoilerLevel === 'none' || item.spoilerLevel === 'full'
      ? item.spoilerLevel
      : 'light'
    const onScreenText = optionalString(item.onScreenText)
    return {
      id: optionalString(item.id) || `segment_${index + 1}`,
      outlineId,
      title: requiredString(item.title, `segments.${index}.title`),
      narration: requiredString(item.narration, `segments.${index}.narration`),
      visualPurpose: requiredString(item.visualPurpose, `segments.${index}.visualPurpose`),
      visualHints: stringArray(item.visualHints),
      ...(onScreenText ? { onScreenText } : {}),
      estimatedDurationSec: Math.round(boundedNumber(item.estimatedDurationSec, 20, 3, 600)),
      spoilerLevel,
      sourceAnchor: parseSourceAnchor(item.sourceAnchor, `segments.${index}.sourceAnchor`, true)!,
    }
  })
  if (outline.length === 0 || segments.length === 0) {
    throw new Error('CONTENT_PLAN_INVALID: guide outline and segments are required')
  }
  return {
    schemaVersion: 1,
    planType: 'guide',
    title: requiredString(value.title, 'contentPlan.title'),
    thesis: requiredString(value.thesis, 'contentPlan.thesis'),
    recommendationAngle: requiredString(value.recommendationAngle, 'contentPlan.recommendationAngle'),
    outline,
    segments,
  }
}

export function parseContentPlan(value: unknown, profile: VideoProfile): ContentPlan {
  if (!isRecord(value)) throw new Error('CONTENT_PLAN_INVALID: contentPlan is required')
  if (profile.contentDomain === 'book' && profile.communicationGoal === 'explain') {
    return parseGuidePlan(value)
  }
  return parseNarrativePlan(value)
}

function parseReviewIssue(value: unknown, index: number): ContentReviewIssue {
  if (!isRecord(value)) throw new Error(`CONTENT_REVIEW_INVALID: issues.${index} must be object`)
  const allowedCodes = new Set<ContentReviewIssue['code']>([
    'PROFILE_MISMATCH',
    'STRUCTURE_WEAK',
    'DURATION_OVERFLOW',
    'REPETITION',
    'SOURCE_UNSUPPORTED',
    'SPOILER_POLICY_VIOLATION',
    'VISUAL_PURPOSE_MISSING',
  ])
  const code = typeof value.code === 'string' && allowedCodes.has(value.code as ContentReviewIssue['code'])
    ? value.code as ContentReviewIssue['code']
    : 'STRUCTURE_WEAK'
  const segmentId = optionalString(value.segmentId)
  return {
    code,
    severity: value.severity === 'blocking' ? 'blocking' : 'warning',
    message: requiredString(value.message, `issues.${index}.message`),
    ...(segmentId ? { segmentId } : {}),
  }
}

export function parseContentReview(value: unknown): ContentReview {
  if (!isRecord(value)) throw new Error('CONTENT_REVIEW_INVALID: review is required')
  const issues = (Array.isArray(value.issues) ? value.issues : []).map(parseReviewIssue)
  const requestedStatus = value.status === 'blocked' || value.status === 'warning'
    ? value.status
    : 'approved'
  const status = issues.some((issue) => issue.severity === 'blocking') ? 'blocked' : requestedStatus
  return {
    schemaVersion: 1,
    status,
    score: Math.round(boundedNumber(value.score, 70, 0, 100)),
    profileFitScore: Math.round(boundedNumber(value.profileFitScore, 70, 0, 100)),
    sourceSupportScore: Math.round(boundedNumber(value.sourceSupportScore, 70, 0, 100)),
    issues,
    revisionInstructions: stringArray(value.revisionInstructions),
  }
}

export function parseContentPlanResult(
  planPayload: unknown,
  reviewPayload: unknown,
  profile: VideoProfile,
): ContentPlanResult {
  if (!isRecord(planPayload)) throw new Error('CONTENT_PLAN_INVALID: response must be object')
  return {
    creativeBrief: parseCreativeBrief(planPayload.creativeBrief, profile),
    contentPlan: parseContentPlan(planPayload.contentPlan, profile),
    contentReview: parseContentReview(reviewPayload),
  }
}

export * from './types'

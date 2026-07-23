import type { VideoProfile } from '@/lib/video-profile'
import type {
  ContentPlan,
  ContentPlanResult,
  ContentReview,
  ContentReviewIssue,
  ContentRiskCode,
  ContentRiskFlag,
  CreativeBrief,
  GuideContentPlan,
  GuideOutlineItem,
  GuideSegment,
  HookPattern,
  NarrativeBeat,
  NarrativeContentPlan,
  SourceAnchor,
  SourceLedgerEntry,
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

export function normalizeGuideUserFacingTitle(value: unknown, field = 'guide.title'): string {
  const title = requiredString(value, field)
  return title
    .replace(/开头钩子/gi, '开场问题')
    .replace(/基础设定科普/gi, '背景与基本设定')
    .replace(/\bCTA\b/gi, '结尾提示')
    .replace(/钩子/g, '开场引导')
    .replace(/冷启动/g, '开场说明')
    .replace(/信息增益/g, '核心信息')
    .replace(/转化引导/g, '结尾提示')
    .replace(/\bhook\b/gi, 'opening question')
    .replace(/\bcold open\b/gi, 'opening context')
    .replace(/\bconversion\b/gi, 'closing guidance')
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
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

function readHookPattern(value: unknown, fallback: HookPattern): HookPattern {
  if (
    value === 'contrast' ||
    value === 'reversal' ||
    value === 'question' ||
    value === 'visual_wonder' ||
    value === 'identity_filter'
  ) {
    return value
  }
  return fallback
}

function readRiskCode(value: unknown): ContentRiskCode {
  if (
    value === 'source_gap' ||
    value === 'fact_claim' ||
    value === 'spoiler_risk' ||
    value === 'overclaim' ||
    value === 'visualization_gap' ||
    value === 'duration_risk' ||
    value === 'structure_drift'
  ) {
    return value
  }
  return 'structure_drift'
}

function parseRiskFlag(value: unknown, index: number, sourceId?: string): ContentRiskFlag {
  if (typeof value === 'string' && value.trim()) {
    return {
      code: 'structure_drift',
      severity: 'warning',
      message: value.trim(),
      ...(sourceId ? { sourceId } : {}),
    }
  }
  if (!isRecord(value)) {
    return {
      code: 'structure_drift',
      severity: 'warning',
      message: `risk flag ${index + 1}`,
      ...(sourceId ? { sourceId } : {}),
    }
  }
  const severity = value.severity === 'critical' || value.severity === 'info'
    ? value.severity
    : 'warning'
  return {
    code: readRiskCode(value.code),
    severity,
    message: optionalString(value.message) || `risk flag ${index + 1}`,
    ...(optionalString(value.sourceId) ? { sourceId: optionalString(value.sourceId) } : sourceId ? { sourceId } : {}),
  }
}

function parseRiskFlags(value: unknown, sourceId?: string): ContentRiskFlag[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => parseRiskFlag(item, index, sourceId))
}

function mergeRiskFlags(...groups: ContentRiskFlag[][]): ContentRiskFlag[] {
  const seen = new Set<string>()
  const merged: ContentRiskFlag[] = []
  for (const group of groups) {
    for (const flag of group) {
      const key = `${flag.code}:${flag.severity}:${flag.message}:${flag.sourceId || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(flag)
    }
  }
  return merged
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

function buildLedgerFromAnchors(anchors: Array<{ id: string; anchor?: SourceAnchor }>): SourceLedgerEntry[] {
  const byKey = new Map<string, SourceLedgerEntry>()
  for (const item of anchors) {
    if (!item.anchor) continue
    const sourceType = item.anchor.sourceType || 'user_source'
    const confidence = boundedNumber(
      item.anchor.confidence,
      sourceType === 'model_knowledge' ? 0.7 : 0.85,
      0,
      1,
    )
    const key = `${sourceType}:${item.anchor.label}:${item.anchor.chapter || ''}`
    const current = byKey.get(key)
    const usage = current
      ? uniqueStrings([current.usage, item.id]).join(',')
      : item.id
    byKey.set(key, {
      id: current?.id || `source_${byKey.size + 1}`,
      label: item.anchor.label,
      sourceType,
      usage,
      confidence,
      ...(item.anchor.quote ? { quote: item.anchor.quote } : {}),
      riskFlags: current?.riskFlags || [],
    })
  }
  return Array.from(byKey.values())
}

function parseSourceLedger(
  value: unknown,
  fallbackAnchors: Array<{ id: string; anchor?: SourceAnchor }>,
): SourceLedgerEntry[] {
  if (!Array.isArray(value)) return buildLedgerFromAnchors(fallbackAnchors)
  const entries = value.flatMap((item, index): SourceLedgerEntry[] => {
    if (!isRecord(item)) return []
    const label = optionalString(item.label)
    if (!label) return []
    const sourceType = readSourceType(item.sourceType) || 'user_source'
    const id = optionalString(item.id) || `source_${index + 1}`
    return [{
      id,
      label,
      sourceType,
      usage: optionalString(item.usage) || 'content planning',
      confidence: boundedNumber(item.confidence, sourceType === 'model_knowledge' ? 0.7 : 0.85, 0, 1),
      ...(optionalString(item.quote) ? { quote: optionalString(item.quote) } : {}),
      riskFlags: parseRiskFlags(item.riskFlags, id),
    }]
  })
  return entries.length > 0 ? entries : buildLedgerFromAnchors(fallbackAnchors)
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
      riskFlags: parseRiskFlags(item.riskFlags, optionalString(item.id) || `beat_${index + 1}`),
    }
  })
  if (beats.length === 0) throw new Error('CONTENT_PLAN_INVALID: narrative beats are required')
  const sourceLedger = parseSourceLedger(
    value.sourceLedger,
    beats.map((beat) => ({ id: beat.id, anchor: beat.sourceAnchor })),
  )
  return {
    schemaVersion: 1,
    planType: 'narrative',
    title: requiredString(value.title, 'contentPlan.title'),
    logline: requiredString(value.logline, 'contentPlan.logline'),
    hookPattern: readHookPattern(value.hookPattern, 'contrast'),
    themes: stringArray(value.themes),
    sourceLedger,
    riskFlags: mergeRiskFlags(parseRiskFlags(value.riskFlags), ...beats.map((beat) => beat.riskFlags)),
    beats,
  }
}

function parseGuidePlan(value: JsonRecord): GuideContentPlan {
  const rawOutline = Array.isArray(value.outline) ? value.outline : []
  const outline: GuideOutlineItem[] = rawOutline.map((item, index) => {
    if (!isRecord(item)) throw new Error(`CONTENT_PLAN_INVALID: outline.${index} must be object`)
    return {
      id: optionalString(item.id) || `outline_${index + 1}`,
      title: normalizeGuideUserFacingTitle(item.title, `outline.${index}.title`),
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
      title: normalizeGuideUserFacingTitle(item.title, `segments.${index}.title`),
      narration: requiredString(item.narration, `segments.${index}.narration`),
      visualPurpose: requiredString(item.visualPurpose, `segments.${index}.visualPurpose`),
      visualHints: stringArray(item.visualHints),
      ...(onScreenText ? { onScreenText } : {}),
      estimatedDurationSec: Math.round(boundedNumber(item.estimatedDurationSec, 20, 3, 600)),
      spoilerLevel,
      sourceAnchor: parseSourceAnchor(item.sourceAnchor, `segments.${index}.sourceAnchor`, true)!,
      riskFlags: parseRiskFlags(item.riskFlags, optionalString(item.id) || `segment_${index + 1}`),
    }
  })
  if (outline.length === 0 || segments.length === 0) {
    throw new Error('CONTENT_PLAN_INVALID: guide outline and segments are required')
  }
  const sourceLedger = parseSourceLedger(
    value.sourceLedger,
    segments.map((segment) => ({ id: segment.id, anchor: segment.sourceAnchor })),
  )
  return {
    schemaVersion: 1,
    planType: 'guide',
    title: normalizeGuideUserFacingTitle(value.title, 'contentPlan.title'),
    thesis: requiredString(value.thesis, 'contentPlan.thesis'),
    hookPattern: readHookPattern(value.hookPattern, 'question'),
    recommendationAngle: requiredString(value.recommendationAngle, 'contentPlan.recommendationAngle'),
    sourceLedger,
    riskFlags: mergeRiskFlags(parseRiskFlags(value.riskFlags), ...segments.map((segment) => segment.riskFlags)),
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
    'HOOK_WEAK',
    'LOW_TENSION',
    'LOW_VISUALIZATION',
    'STABILITY_DRIFT',
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
  const score = Math.round(boundedNumber(value.score, 70, 0, 100))
  return {
    schemaVersion: 1,
    status,
    score,
    profileFitScore: Math.round(boundedNumber(value.profileFitScore, 70, 0, 100)),
    sourceSupportScore: Math.round(boundedNumber(value.sourceSupportScore, 70, 0, 100)),
    tensionScore: Math.round(boundedNumber(value.tensionScore, score, 0, 100)),
    visualizationScore: Math.round(boundedNumber(value.visualizationScore, score, 0, 100)),
    pacingScore: Math.round(boundedNumber(value.pacingScore, score, 0, 100)),
    stabilityScore: Math.round(boundedNumber(value.stabilityScore, score, 0, 100)),
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

import type { BookGuideSourceMode } from '@/lib/book-guide/seed'
import type { SpoilerLevel, VideoProfile } from '@/lib/video-profile'

export interface SourceAnchor {
  label: string
  quote?: string
  startText?: string
  endText?: string
  chapter?: string
  visualAssetIds?: string[]
  sourceType?: BookGuideSourceMode | 'reference_summary'
  confidence?: number
}

export type HookPattern =
  | 'contrast'
  | 'reversal'
  | 'question'
  | 'visual_wonder'
  | 'identity_filter'

export type ContentRiskCode =
  | 'source_gap'
  | 'fact_claim'
  | 'spoiler_risk'
  | 'overclaim'
  | 'visualization_gap'
  | 'duration_risk'
  | 'structure_drift'

export interface ContentRiskFlag {
  code: ContentRiskCode
  severity: 'info' | 'warning' | 'critical'
  message: string
  sourceId?: string
}

export interface SourceLedgerEntry {
  id: string
  label: string
  sourceType: NonNullable<SourceAnchor['sourceType']>
  usage: string
  confidence: number
  quote?: string
  riskFlags: ContentRiskFlag[]
}

export interface CreativeBrief {
  schemaVersion: 1
  profilePreset: VideoProfile['preset']
  objective: string
  audience: string
  audiencePromise: string
  targetDurationSec: number
  tone: string[]
  mustInclude: string[]
  mustAvoid: string[]
  hookCandidates?: HookCandidate[]
}

export type VoiceBeatRole =
  | 'opening_question'
  | 'promise'
  | 'setup'
  | 'conflict'
  | 'turn'
  | 'evidence'
  | 'payoff'
  | 'closing'

export interface HookCandidate {
  id: string
  pattern: HookPattern
  line: string
  promise: string
  sourceBoundary: string
  riskFlags: ContentRiskFlag[]
}

export interface VoiceRhythm {
  role: VoiceBeatRole
  voiceIntent: string
  emotion: string
  pacing: 'fast' | 'steady' | 'slow'
  pauseAfterSec: number
}

export interface SourceBoundary {
  factualBasis: 'verified' | 'user_provided' | 'model_knowledge' | 'interpretation'
  allowedExpression: string
  forbiddenExpression: string[]
}

export interface NarrativeBeat {
  id: string
  title: string
  purpose: string
  summary: string
  estimatedDurationSec: number
  sourceAnchor?: SourceAnchor
  voiceRhythm?: VoiceRhythm
  sourceBoundary?: SourceBoundary
  riskFlags: ContentRiskFlag[]
}

export interface NarrativeContentPlan {
  schemaVersion: 1
  planType: 'narrative'
  title: string
  logline: string
  hookPattern: HookPattern
  themes: string[]
  sourceLedger: SourceLedgerEntry[]
  riskFlags: ContentRiskFlag[]
  beats: NarrativeBeat[]
}

export interface GuideOutlineItem {
  id: string
  title: string
  question: string
  takeaway: string
}

export interface GuideSegment {
  id: string
  outlineId: string
  title: string
  narration: string
  visualPurpose: string
  visualHints: string[]
  onScreenText?: string
  estimatedDurationSec: number
  spoilerLevel: SpoilerLevel
  sourceAnchor: SourceAnchor
  voiceRhythm?: VoiceRhythm
  sourceBoundary?: SourceBoundary
  riskFlags: ContentRiskFlag[]
}

export interface GuideContentPlan {
  schemaVersion: 1
  planType: 'guide'
  title: string
  thesis: string
  hookPattern: HookPattern
  recommendationAngle: string
  sourceLedger: SourceLedgerEntry[]
  riskFlags: ContentRiskFlag[]
  outline: GuideOutlineItem[]
  segments: GuideSegment[]
}

export type ContentPlan = NarrativeContentPlan | GuideContentPlan

export type ContentReviewIssueCode =
  | 'PROFILE_MISMATCH'
  | 'STRUCTURE_WEAK'
  | 'DURATION_OVERFLOW'
  | 'REPETITION'
  | 'SOURCE_UNSUPPORTED'
  | 'SPOILER_POLICY_VIOLATION'
  | 'VISUAL_PURPOSE_MISSING'
  | 'HOOK_WEAK'
  | 'LOW_TENSION'
  | 'LOW_VISUALIZATION'
  | 'STABILITY_DRIFT'

export interface ContentReviewIssue {
  code: ContentReviewIssueCode
  severity: 'warning' | 'blocking'
  message: string
  segmentId?: string
}

export interface ContentReview {
  schemaVersion: 1
  status: 'approved' | 'warning' | 'blocked'
  score: number
  profileFitScore: number
  sourceSupportScore: number
  tensionScore: number
  visualizationScore: number
  pacingScore: number
  stabilityScore: number
  issues: ContentReviewIssue[]
  revisionInstructions: string[]
}

export interface ContentPlanResult {
  creativeBrief: CreativeBrief
  contentPlan: ContentPlan
  contentReview: ContentReview
}

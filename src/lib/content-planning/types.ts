import type { SpoilerLevel, VideoProfile } from '@/lib/video-profile'

export interface SourceAnchor {
  label: string
  quote?: string
  startText?: string
  endText?: string
  chapter?: string
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
}

export interface NarrativeBeat {
  id: string
  title: string
  purpose: string
  summary: string
  estimatedDurationSec: number
  sourceAnchor?: SourceAnchor
}

export interface NarrativeContentPlan {
  schemaVersion: 1
  planType: 'narrative'
  title: string
  logline: string
  themes: string[]
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
}

export interface GuideContentPlan {
  schemaVersion: 1
  planType: 'guide'
  title: string
  thesis: string
  recommendationAngle: string
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
  issues: ContentReviewIssue[]
  revisionInstructions: string[]
}

export interface ContentPlanResult {
  creativeBrief: CreativeBrief
  contentPlan: ContentPlan
  contentReview: ContentReview
}

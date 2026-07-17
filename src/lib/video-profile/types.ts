export const VIDEO_PROFILE_SCHEMA_VERSION = 1 as const

export const VIDEO_PROFILE_PRESET = {
  AI_COMIC: 'ai_comic',
  BOOK_GUIDE: 'book_guide',
} as const

export type VideoProfilePreset = (typeof VIDEO_PROFILE_PRESET)[keyof typeof VIDEO_PROFILE_PRESET]
export type VideoCommunicationGoal = 'narrative' | 'explain'
export type VideoContentDomain = 'fiction' | 'book'
export type VideoVisualForm = 'ai_comic' | 'mixed_media'
export type VisualQualityMode = 'shadow' | 'auto'
export type SpoilerLevel = 'none' | 'light' | 'full'

export interface VideoProfile {
  schemaVersion: typeof VIDEO_PROFILE_SCHEMA_VERSION
  preset: VideoProfilePreset
  communicationGoal: VideoCommunicationGoal
  contentDomain: VideoContentDomain
  visualForm: VideoVisualForm
  audience: string
  platform: string
  targetDurationSec: number
  sourcePolicy: {
    requireAnchors: boolean
    spoilerLevel: SpoilerLevel
  }
  qualityPolicy: {
    mode: VisualQualityMode
    maxRepairAttempts: number
    autoApproveThreshold: number
    minConfidence: number
  }
}

export type VideoProfileInput = Partial<VideoProfile> & {
  preset?: VideoProfilePreset
}

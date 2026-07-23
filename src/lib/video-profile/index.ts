import {
  VIDEO_PROFILE_PRESET,
  VIDEO_PROFILE_SCHEMA_VERSION,
  type SpoilerLevel,
  type VideoProfile,
  type VideoProfileInput,
  type VideoProfilePreset,
  type VisualQualityMode,
} from './types'
import { VISUAL_REPAIR_MAX_ATTEMPTS } from '@/lib/visual-quality/repair-policy'

const DEFAULT_PROFILE_BY_PRESET: Record<VideoProfilePreset, VideoProfile> = {
  [VIDEO_PROFILE_PRESET.AI_COMIC]: {
    schemaVersion: VIDEO_PROFILE_SCHEMA_VERSION,
    preset: VIDEO_PROFILE_PRESET.AI_COMIC,
    communicationGoal: 'narrative',
    contentDomain: 'fiction',
    visualForm: 'ai_comic',
    audience: 'general',
    platform: 'short_video',
    targetDurationSec: 90,
    sourcePolicy: {
      requireAnchors: false,
      spoilerLevel: 'full',
    },
    qualityPolicy: {
      mode: 'shadow',
      maxRepairAttempts: VISUAL_REPAIR_MAX_ATTEMPTS,
      autoApproveThreshold: 85,
      minConfidence: 0.82,
    },
  },
  [VIDEO_PROFILE_PRESET.BOOK_GUIDE]: {
    schemaVersion: VIDEO_PROFILE_SCHEMA_VERSION,
    preset: VIDEO_PROFILE_PRESET.BOOK_GUIDE,
    communicationGoal: 'explain',
    contentDomain: 'book',
    visualForm: 'mixed_media',
    audience: 'general_readers',
    platform: 'short_video',
    targetDurationSec: 180,
    sourcePolicy: {
      requireAnchors: true,
      spoilerLevel: 'light',
    },
    qualityPolicy: {
      mode: 'shadow',
      maxRepairAttempts: VISUAL_REPAIR_MAX_ATTEMPTS,
      autoApproveThreshold: 88,
      minConfidence: 0.86,
    },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readString(value: unknown, fallback: string, maxLength = 200): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : fallback
}

function readPreset(value: unknown): VideoProfilePreset {
  return value === VIDEO_PROFILE_PRESET.BOOK_GUIDE
    ? VIDEO_PROFILE_PRESET.BOOK_GUIDE
    : VIDEO_PROFILE_PRESET.AI_COMIC
}

function readQualityMode(value: unknown, fallback: VisualQualityMode): VisualQualityMode {
  return value === 'auto' || value === 'shadow' ? value : fallback
}

function readSpoilerLevel(value: unknown, fallback: SpoilerLevel): SpoilerLevel {
  return value === 'none' || value === 'light' || value === 'full' ? value : fallback
}

function parseRawInput(raw: unknown): VideoProfileInput {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return {}
    if (trimmed === VIDEO_PROFILE_PRESET.AI_COMIC || trimmed === VIDEO_PROFILE_PRESET.BOOK_GUIDE) {
      return { preset: trimmed }
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return isRecord(parsed) ? parsed as VideoProfileInput : {}
    } catch {
      return {}
    }
  }
  return isRecord(raw) ? raw as VideoProfileInput : {}
}

export function resolveVideoProfile(raw: unknown): VideoProfile {
  const input = parseRawInput(raw)
  const preset = readPreset(input.preset)
  const base = DEFAULT_PROFILE_BY_PRESET[preset]
  const sourcePolicy: Record<string, unknown> = isRecord(input.sourcePolicy) ? input.sourcePolicy : {}
  const qualityPolicy: Record<string, unknown> = isRecord(input.qualityPolicy) ? input.qualityPolicy : {}

  return {
    ...base,
    audience: readString(input.audience, base.audience),
    platform: readString(input.platform, base.platform),
    targetDurationSec: Math.round(clampNumber(input.targetDurationSec, base.targetDurationSec, 15, 3600)),
    sourcePolicy: {
      requireAnchors: typeof sourcePolicy.requireAnchors === 'boolean'
        ? sourcePolicy.requireAnchors
        : base.sourcePolicy.requireAnchors,
      spoilerLevel: readSpoilerLevel(sourcePolicy.spoilerLevel, base.sourcePolicy.spoilerLevel),
    },
    qualityPolicy: {
      mode: readQualityMode(qualityPolicy.mode, base.qualityPolicy.mode),
      maxRepairAttempts: Math.round(clampNumber(
        qualityPolicy.maxRepairAttempts,
        base.qualityPolicy.maxRepairAttempts,
        0,
        VISUAL_REPAIR_MAX_ATTEMPTS,
      )),
      autoApproveThreshold: Math.round(clampNumber(
        qualityPolicy.autoApproveThreshold,
        base.qualityPolicy.autoApproveThreshold,
        50,
        100,
      )),
      minConfidence: clampNumber(
        qualityPolicy.minConfidence,
        base.qualityPolicy.minConfidence,
        0.5,
        1,
      ),
    },
  }
}

export function isBookGuideProfile(profile: VideoProfile): boolean {
  return profile.contentDomain === 'book' && profile.communicationGoal === 'explain'
}

export function serializeVideoProfile(profile: VideoProfile): VideoProfile {
  return resolveVideoProfile(profile)
}

export * from './types'

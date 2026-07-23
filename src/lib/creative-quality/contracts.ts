import { createHash } from 'node:crypto'
import type { PromptPatch, RepairAction } from '@/lib/visual-quality'

export const CREATIVE_QUALITY_SCHEMA_VERSION = 1

export type CreativeQualityTargetType =
  | 'content'
  | 'asset'
  | 'storyboard'
  | 'panel'
  | 'image'
  | 'video'

export interface QualityReviewDimension {
  name: string
  score: number
  issues: string[]
}

export interface QualityReviewContract {
  schemaVersion: typeof CREATIVE_QUALITY_SCHEMA_VERSION
  targetId: string
  targetType: CreativeQualityTargetType
  specVersion: string
  score: number
  confidence: number
  status: 'passed' | 'repairable' | 'human_required' | 'failed'
  dimensions: QualityReviewDimension[]
  criticalIssues: string[]
  route:
    | 'NONE'
    | 'CONTENT_REVISE'
    | 'ASSET_REPAIR'
    | 'SHOT_REPLAN'
    | 'PROMPT_RECOMPILE'
    | 'REGENERATE'
    | 'HUMAN_REQUIRED'
  evidence: string[]
}

export interface GenerationSnapshot {
  schemaVersion: typeof CREATIVE_QUALITY_SCHEMA_VERSION
  snapshotType: 'panel_image_prompt' | 'panel_video_prompt' | 'asset_image_prompt'
  targetType:
    | 'NovelPromotionPanel'
    | 'CharacterAppearance'
    | 'LocationImage'
    | 'GlobalCharacterAppearance'
    | 'GlobalLocationImage'
  targetId: string
  modelKey: string
  promptTemplateId: string
  promptHash: string
  specHash: string
  inputHash: string
  assetVersionHash: string | null
  referenceImages: string[]
  promptSpec: unknown
  compiledPrompt: string
  createdAt: string
}

export interface VisualAutoRepairLineage {
  schemaVersion: typeof CREATIVE_QUALITY_SCHEMA_VERSION
  targetType: 'panel' | 'character' | 'location' | 'prop'
  targetId: string
  attempt: number
  action: Extract<RepairAction, 'edit' | 'regenerate'>
  sourceCandidateUrl: string | null
  candidateUrls: string[]
  previousVersionHash: string | null
  repairVersionHash: string
  scoreBefore: number | null
  scoreAfter: number | null
  accepted: boolean | null
  acceptedCandidateUrl: string | null
  stopReason:
    | 'approved'
    | 'max_attempts'
    | 'human_required'
    | 'needs_next_repair'
    | 'generation_failed'
    | 'shadow_completed'
    | null
  promptPatch: PromptPatch
  changedVariables: string[]
  imageModel: string | null
  createdAt: string
  reviewedAt: string | null
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`
}

export function createCreativeQualityHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeVisualAutoRepairLineage(value: unknown): VisualAutoRepairLineage[] {
  const source = Array.isArray(value) ? value : value ? [value] : []
  const records: VisualAutoRepairLineage[] = []
  const seen = new Set<string>()
  for (const item of source) {
    if (
      !isRecord(item)
      || item.schemaVersion !== CREATIVE_QUALITY_SCHEMA_VERSION
      || typeof item.targetId !== 'string'
      || typeof item.repairVersionHash !== 'string'
      || typeof item.attempt !== 'number'
    ) {
      continue
    }
    const key = `${item.targetType || ''}:${item.targetId}:${item.attempt}:${item.repairVersionHash}`
    if (seen.has(key)) continue
    seen.add(key)
    records.push(item as unknown as VisualAutoRepairLineage)
  }
  return records
}

function boundedScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function normalizePromptPatch(value: unknown): PromptPatch {
  const record = isRecord(value) ? value : {}
  return {
    preserve: stringArray(record.preserve),
    add: stringArray(record.add),
    remove: stringArray(record.remove),
    negative: stringArray(record.negative),
    rationale: typeof record.rationale === 'string' ? record.rationale : '',
  }
}

function resolveChangedVariables(promptPatch: PromptPatch): string[] {
  const variables: string[] = []
  if (promptPatch.preserve.length > 0) variables.push('preserve')
  if (promptPatch.add.length > 0) variables.push('add')
  if (promptPatch.remove.length > 0) variables.push('remove')
  if (promptPatch.negative.length > 0) variables.push('negative')
  return variables
}

export function createVisualAutoRepairLineage(params: {
  targetType: VisualAutoRepairLineage['targetType']
  targetId: string
  attempt: number
  action: VisualAutoRepairLineage['action']
  sourceCandidateUrl?: string | null
  candidateUrls: string[]
  previousVersionHash?: string | null
  repairVersionHash: string
  scoreBefore?: number | null
  promptPatch: PromptPatch
  imageModel?: string | null
  createdAt?: string
}): VisualAutoRepairLineage {
  const promptPatch = normalizePromptPatch(params.promptPatch)
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    targetType: params.targetType,
    targetId: params.targetId,
    attempt: Math.max(1, Math.floor(params.attempt)),
    action: params.action,
    sourceCandidateUrl: params.sourceCandidateUrl || null,
    candidateUrls: Array.from(new Set(params.candidateUrls.filter(Boolean))),
    previousVersionHash: params.previousVersionHash || null,
    repairVersionHash: params.repairVersionHash,
    scoreBefore: boundedScore(params.scoreBefore),
    scoreAfter: null,
    accepted: null,
    acceptedCandidateUrl: null,
    stopReason: null,
    promptPatch,
    changedVariables: resolveChangedVariables(promptPatch),
    imageModel: params.imageModel || null,
    createdAt: params.createdAt || new Date().toISOString(),
    reviewedAt: null,
  }
}

export function completeLatestVisualAutoRepairLineage(
  lineage: VisualAutoRepairLineage[] | null | undefined,
  params: {
    attempt: number
    repairVersionHash: string
    scoreAfter: number | null
    accepted: boolean
    acceptedCandidateUrl?: string | null
    stopReason: NonNullable<VisualAutoRepairLineage['stopReason']>
    reviewedAt?: string
  },
): VisualAutoRepairLineage[] {
  const records = normalizeVisualAutoRepairLineage(lineage)
  const index = (() => {
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const record = records[i]
      if (record.attempt === params.attempt && record.repairVersionHash === params.repairVersionHash) return i
    }
    return -1
  })()
  if (index < 0) return records
  records[index] = {
    ...records[index],
    scoreAfter: boundedScore(params.scoreAfter),
    accepted: params.accepted,
    acceptedCandidateUrl: params.acceptedCandidateUrl || null,
    stopReason: params.stopReason,
    reviewedAt: params.reviewedAt || new Date().toISOString(),
  }
  return records
}

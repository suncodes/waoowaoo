import type { PromptPatch, RepairAction } from '@/lib/visual-quality'

export const CREATIVE_QUALITY_SCHEMA_VERSION = 1

export type CreativeQualityTargetType =
  | 'content'
  | 'script'
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
    | 'SCRIPT_REVISE'
    | 'ASSET_REPAIR'
    | 'SHOT_REPLAN'
    | 'PROMPT_RECOMPILE'
    | 'REGENERATE'
    | 'VIDEO_REGENERATE'
    | 'VOICE_REGENERATE'
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
  structuredReferences?: unknown
  bindingPlan?: unknown
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

const SHA256_INITIAL_HASH = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
] as const

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift))
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function createSha256Hex(value: string): string {
  const bytes = encodeUtf8(value)
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80

  const bitLengthLow = (bytes.length << 3) >>> 0
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000)
  const lengthOffset = paddedLength - 8
  padded[lengthOffset] = (bitLengthHigh >>> 24) & 0xff
  padded[lengthOffset + 1] = (bitLengthHigh >>> 16) & 0xff
  padded[lengthOffset + 2] = (bitLengthHigh >>> 8) & 0xff
  padded[lengthOffset + 3] = bitLengthHigh & 0xff
  padded[lengthOffset + 4] = (bitLengthLow >>> 24) & 0xff
  padded[lengthOffset + 5] = (bitLengthLow >>> 16) & 0xff
  padded[lengthOffset + 6] = (bitLengthLow >>> 8) & 0xff
  padded[lengthOffset + 7] = bitLengthLow & 0xff

  const hash: number[] = Array.from(SHA256_INITIAL_HASH)
  const words = new Array<number>(64).fill(0)

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const wordOffset = offset + i * 4
      words[i] = (
        (padded[wordOffset] << 24)
        | (padded[wordOffset + 1] << 16)
        | (padded[wordOffset + 2] << 8)
        | padded[wordOffset + 3]
      ) >>> 0
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3)) >>> 0
      const s1 = (rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10)) >>> 0
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash
    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const temp1 = (h + s1 + ch + SHA256_ROUND_CONSTANTS[i] + words[i]) >>> 0
      const s0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  return hash.map((word) => word.toString(16).padStart(8, '0')).join('')
}

export function createCreativeQualityHash(value: unknown): string {
  return createSha256Hex(stableSerialize(value))
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

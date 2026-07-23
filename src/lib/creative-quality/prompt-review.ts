import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  type GenerationSnapshot,
  type QualityReviewContract,
  type QualityReviewDimension,
} from '@/lib/creative-quality/contracts'

export interface PromptSnapshotReviewInput {
  artifactId?: string | null
  runId?: string | null
  stepKey?: string | null
  artifactType?: string | null
  refId?: string | null
  payload: unknown
  createdAt?: string | Date | null
}

type PromptSnapshotKind = GenerationSnapshot['snapshotType']

type PromptQualityTargetType = 'panel' | 'asset'

interface PromptIssue {
  dimension: 'spec_structure' | 'required_fields' | 'compiled_prompt' | 'constraints' | 'versioning' | 'references'
  severity: 'warning' | 'critical'
  message: string
}

export type PromptQualityReviewResult = QualityReviewContract & {
  targetType: PromptQualityTargetType
  reviewKind: 'prompt_snapshot'
  snapshotType: PromptSnapshotKind | 'unknown'
  promptHash: string | null
  specHash: string | null
  inputHash: string | null
  artifactId: string | null
  artifactType: string | null
  reviewedAt: string
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function objectHasText(record: JsonRecord, key: string): boolean {
  return readString(record[key]).length > 0
}

function objectHasArray(record: JsonRecord, key: string): boolean {
  return Array.isArray(record[key]) && (record[key] as unknown[]).length > 0
}

function readSnapshot(payload: unknown): JsonRecord {
  const record = asRecord(payload)
  const nested = asRecord(record.snapshot)
  return Object.keys(nested).length > 0 ? nested : record
}

function snapshotType(value: unknown): PromptSnapshotKind | 'unknown' {
  return value === 'panel_image_prompt'
    || value === 'panel_video_prompt'
    || value === 'asset_image_prompt'
    ? value
    : 'unknown'
}

function targetTypeFor(kind: PromptSnapshotKind | 'unknown'): PromptQualityTargetType {
  return kind === 'asset_image_prompt' ? 'asset' : 'panel'
}

function requiredFieldsFor(kind: PromptSnapshotKind | 'unknown'): Array<{ key: string; kind: 'text' | 'array' | 'object' }> {
  if (kind === 'panel_image_prompt') {
    return [
      { key: 'narrativeIntent', kind: 'text' },
      { key: 'primarySubject', kind: 'text' },
      { key: 'actionState', kind: 'text' },
      { key: 'environment', kind: 'text' },
      { key: 'spatialLayout', kind: 'text' },
      { key: 'composition', kind: 'object' },
      { key: 'lightingAndColor', kind: 'text' },
      { key: 'styleAndTexture', kind: 'text' },
      { key: 'negativeConstraints', kind: 'array' },
    ]
  }
  if (kind === 'panel_video_prompt') {
    return [
      { key: 'sourceFramePolicy', kind: 'text' },
      { key: 'narrativeIntent', kind: 'text' },
      { key: 'primarySubject', kind: 'text' },
      { key: 'startState', kind: 'text' },
      { key: 'primaryMotion', kind: 'text' },
      { key: 'cameraMotion', kind: 'text' },
      { key: 'endState', kind: 'text' },
      { key: 'continuityConstraints', kind: 'array' },
      { key: 'negativeConstraints', kind: 'array' },
    ]
  }
  if (kind === 'asset_image_prompt') {
    return [
      { key: 'identityLocks', kind: 'array' },
      { key: 'shapeAndSilhouette', kind: 'array' },
      { key: 'viewAndComposition', kind: 'text' },
      { key: 'backgroundRule', kind: 'text' },
      { key: 'styleApplication', kind: 'text' },
      { key: 'qualityTerms', kind: 'array' },
      { key: 'negativeConstraints', kind: 'array' },
    ]
  }
  return []
}

function checkRequiredFields(kind: PromptSnapshotKind | 'unknown', spec: JsonRecord): PromptIssue[] {
  return requiredFieldsFor(kind).flatMap((field): PromptIssue[] => {
    const ok = field.kind === 'text'
      ? objectHasText(spec, field.key)
      : field.kind === 'array'
        ? objectHasArray(spec, field.key)
        : Object.keys(asRecord(spec[field.key])).length > 0
    return ok ? [] : [{
      dimension: 'required_fields',
      severity: 'critical',
      message: `promptSpec 缺少 ${field.key}`,
    }]
  })
}

function hasTerminalConstraint(compiledPrompt: string): boolean {
  return /(禁止项|negative constraints|no text|no watermark|无文字|无水印|不要生成文字)/i.test(compiledPrompt)
}

function minPromptLength(kind: PromptSnapshotKind | 'unknown'): number {
  if (kind === 'panel_video_prompt') return 120
  if (kind === 'asset_image_prompt') return 140
  return 160
}

function scoreDimension(name: PromptIssue['dimension'], issues: PromptIssue[], penalty: number): QualityReviewDimension {
  const matched = issues.filter((item) => item.dimension === name)
  const critical = matched.filter((item) => item.severity === 'critical').length
  return {
    name,
    score: Math.max(0, 100 - matched.length * penalty - critical * penalty),
    issues: matched.map((item) => item.message),
  }
}

function statusFrom(score: number, issues: PromptIssue[]): PromptQualityReviewResult['status'] {
  if (issues.some((item) => item.severity === 'critical')) return 'human_required'
  if (issues.length > 0) return 'repairable'
  if (score >= 82) return 'passed'
  if (score >= 65) return 'repairable'
  return 'human_required'
}

export function reviewPromptSnapshotQuality(params: {
  snapshot: PromptSnapshotReviewInput
  reviewedAt?: string
}): PromptQualityReviewResult {
  const snapshot = readSnapshot(params.snapshot.payload)
  const kind = snapshotType(snapshot.snapshotType)
  const promptSpec = asRecord(snapshot.promptSpec)
  const compiledPrompt = readString(snapshot.compiledPrompt)
  const referenceImages = stringArray(snapshot.referenceImages)
  const promptHash = readString(snapshot.promptHash)
  const specHash = readString(snapshot.specHash)
  const inputHash = readString(snapshot.inputHash)
  const issues: PromptIssue[] = []

  if (kind === 'unknown') {
    issues.push({ dimension: 'spec_structure', severity: 'critical', message: '缺少有效 snapshotType' })
  }
  if (Object.keys(promptSpec).length === 0) {
    issues.push({ dimension: 'spec_structure', severity: 'critical', message: '缺少 promptSpec' })
  }
  if (!compiledPrompt) {
    issues.push({ dimension: 'compiled_prompt', severity: 'critical', message: '缺少 compiledPrompt' })
  } else if (compiledPrompt.length < minPromptLength(kind)) {
    issues.push({ dimension: 'compiled_prompt', severity: 'warning', message: 'compiledPrompt 过短，可能只是视觉意图而非完整模型输入' })
  }
  issues.push(...checkRequiredFields(kind, promptSpec))
  const negativeConstraints = stringArray(promptSpec.negativeConstraints)
  if (negativeConstraints.length === 0) {
    issues.push({ dimension: 'constraints', severity: 'critical', message: '缺少 negativeConstraints' })
  }
  if (compiledPrompt && !hasTerminalConstraint(compiledPrompt)) {
    issues.push({ dimension: 'constraints', severity: 'warning', message: 'compiledPrompt 未体现明确禁止项' })
  }
  if (!promptHash || !specHash || !inputHash) {
    issues.push({ dimension: 'versioning', severity: 'critical', message: '缺少 prompt/spec/input hash，无法稳定回归' })
  }
  if (referenceImages.length !== new Set(referenceImages).size) {
    issues.push({ dimension: 'references', severity: 'warning', message: 'referenceImages 存在重复项' })
  }

  const dimensions = [
    scoreDimension('spec_structure', issues, 28),
    scoreDimension('required_fields', issues, 16),
    scoreDimension('compiled_prompt', issues, 18),
    scoreDimension('constraints', issues, 16),
    scoreDimension('versioning', issues, 28),
    scoreDimension('references', issues, 10),
  ]
  const score = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const status = statusFrom(score, issues)
  const targetId = readString(snapshot.targetId) || readString(params.snapshot.refId) || 'unknown'
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    targetId,
    targetType: targetTypeFor(kind),
    reviewKind: 'prompt_snapshot',
    snapshotType: kind,
    specVersion: 'prompt-snapshot-review.v1',
    score,
    confidence: Object.keys(promptSpec).length > 0 && compiledPrompt ? 0.86 : 0.65,
    status,
    dimensions,
    criticalIssues: issues.filter((item) => item.severity === 'critical').map((item) => item.message),
    route: status === 'passed' ? 'NONE' : 'PROMPT_RECOMPILE',
    evidence: issues.map((item) => item.message),
    promptHash: promptHash || null,
    specHash: specHash || null,
    inputHash: inputHash || null,
    artifactId: params.snapshot.artifactId || null,
    artifactType: params.snapshot.artifactType || null,
    reviewedAt: params.reviewedAt || new Date().toISOString(),
  }
}

import type { VisualAssetRef, VisualUnit } from '@/lib/visual-planning'

export type ShotSubjectType =
  | 'character'
  | 'location'
  | 'vehicle'
  | 'book'
  | 'prop'
  | 'diagram'
  | 'abstract'
  | 'text_card'
  | 'environment'
  | 'comparison'
  | 'unknown'

export type ShotVisualIntent =
  | 'character_action'
  | 'environment_plate'
  | 'prop_focus'
  | 'diagram'
  | 'book_clean_plate'
  | 'text_card'
  | 'one_off_broll'
  | 'comparison'
  | 'abstract_background'

export type ShotReferencePolicy =
  | 'required'
  | 'optional'
  | 'forbidden'
  | 'clean_plate'
  | 'no_reference_allowed'

export type ShotAssetRequirementRole =
  | 'primary_identity'
  | 'supporting_identity'
  | 'environment'
  | 'prop_detail'
  | 'cover_motif'
  | 'comparison_prop'
  | 'style_only'

export interface ShotAssetRequirement {
  name: string
  kind: VisualAssetRef['kind']
  semanticType?: string
  assetId?: string | null
  role: ShotAssetRequirementRole
  required: boolean
  mustLock: boolean
  reuseExpected: boolean
  reason: string
}

export interface ShotAssetRequirementPlan {
  schemaVersion: 1
  panelId: string
  primarySubject: string
  subjectType: ShotSubjectType
  visualIntent: ShotVisualIntent
  referencePolicy: ShotReferencePolicy
  noReferenceAllowed: boolean
  noReferenceReason: string | null
  requirements: ShotAssetRequirement[]
  confidence: number
  source: 'llm' | 'fallback'
  warnings: string[]
}

export interface ShotAssetRequirementPlanResult {
  schemaVersion: 1
  plans: ShotAssetRequirementPlan[]
}

type JsonRecord = Record<string, unknown>

const SUBJECT_TYPES = new Set<ShotSubjectType>([
  'character',
  'location',
  'vehicle',
  'book',
  'prop',
  'diagram',
  'abstract',
  'text_card',
  'environment',
  'comparison',
  'unknown',
])

const VISUAL_INTENTS = new Set<ShotVisualIntent>([
  'character_action',
  'environment_plate',
  'prop_focus',
  'diagram',
  'book_clean_plate',
  'text_card',
  'one_off_broll',
  'comparison',
  'abstract_background',
])

const REFERENCE_POLICIES = new Set<ShotReferencePolicy>([
  'required',
  'optional',
  'forbidden',
  'clean_plate',
  'no_reference_allowed',
])

const REQUIREMENT_ROLES = new Set<ShotAssetRequirementRole>([
  'primary_identity',
  'supporting_identity',
  'environment',
  'prop_detail',
  'cover_motif',
  'comparison_prop',
  'style_only',
])

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function asRecord(value: unknown): JsonRecord {
  const parsed = parseJson(value)
  return isRecord(parsed) ? parsed : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value)
  return text || undefined
}

function readNullableString(value: unknown): string | null {
  return readString(value) || null
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return fallback
}

function readConfidence(value: unknown, fallback = 0.45): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function readSubjectType(value: unknown, fallback: ShotSubjectType): ShotSubjectType {
  return typeof value === 'string' && SUBJECT_TYPES.has(value as ShotSubjectType)
    ? value as ShotSubjectType
    : fallback
}

function readVisualIntent(value: unknown, fallback: ShotVisualIntent): ShotVisualIntent {
  return typeof value === 'string' && VISUAL_INTENTS.has(value as ShotVisualIntent)
    ? value as ShotVisualIntent
    : fallback
}

function readReferencePolicy(value: unknown, fallback: ShotReferencePolicy): ShotReferencePolicy {
  return typeof value === 'string' && REFERENCE_POLICIES.has(value as ShotReferencePolicy)
    ? value as ShotReferencePolicy
    : fallback
}

function readRequirementRole(value: unknown, fallback: ShotAssetRequirementRole): ShotAssetRequirementRole {
  return typeof value === 'string' && REQUIREMENT_ROLES.has(value as ShotAssetRequirementRole)
    ? value as ShotAssetRequirementRole
    : fallback
}

function readAssetKind(value: unknown): VisualAssetRef['kind'] | null {
  return value === 'character' || value === 'location' || value === 'prop' ? value : null
}

function roleForAsset(asset: VisualAssetRef, index: number): ShotAssetRequirementRole {
  if (asset.kind === 'character') return index === 0 ? 'primary_identity' : 'supporting_identity'
  if (asset.kind === 'location') return 'environment'
  return 'prop_detail'
}

function subjectTypeForAsset(asset: VisualAssetRef | undefined): ShotSubjectType {
  if (!asset) return 'unknown'
  if (asset.kind === 'character') return 'character'
  if (asset.kind === 'location') return 'environment'
  return 'prop'
}

function visualIntentForUnit(unit: VisualUnit, refs: VisualAssetRef[]): ShotVisualIntent {
  if (unit.renderMode === 'text_card' || unit.visualType === 'quote_card' || unit.visualType === 'kinetic_text') {
    return 'text_card'
  }
  if (unit.renderMode === 'composite' || unit.visualType === 'book_cover') return 'book_clean_plate'
  if (unit.visualType === 'diagram') return 'diagram'
  if (unit.visualType === 'environment') return 'environment_plate'
  if (refs.some((asset) => asset.kind === 'character')) return 'character_action'
  if (refs.some((asset) => asset.kind === 'prop')) return 'prop_focus'
  return 'one_off_broll'
}

function referencePolicyForUnit(unit: VisualUnit, refs: VisualAssetRef[]): ShotReferencePolicy {
  if (unit.renderMode === 'text_card' || unit.visualType === 'quote_card' || unit.visualType === 'kinetic_text') {
    return 'clean_plate'
  }
  if (unit.renderMode === 'composite' || unit.visualType === 'book_cover') return 'clean_plate'
  if (refs.some((asset) => asset.kind === 'character' || asset.kind === 'prop')) return 'required'
  if (refs.length > 0) return 'optional'
  return 'no_reference_allowed'
}

function fallbackRequirementForAsset(asset: VisualAssetRef, index: number): ShotAssetRequirement {
  const role = roleForAsset(asset, index)
  return {
    name: asset.name,
    kind: asset.kind,
    assetId: asset.id,
    role,
    required: role !== 'style_only',
    mustLock: role === 'primary_identity' || role === 'prop_detail' || role === 'cover_motif',
    reuseExpected: true,
    reason: '来自 visualUnit.assetRefs/shotSpec.visibleAssets 的显式资产引用',
  }
}

export function buildFallbackShotAssetRequirementPlan(unit: VisualUnit): ShotAssetRequirementPlan {
  const refs = (unit.assetRefs?.length ? unit.assetRefs : unit.shotSpec.visibleAssets) || []
  const primaryAsset = refs.find((asset) => asset.kind !== 'location') || refs[0]
  const visualIntent = visualIntentForUnit(unit, refs)
  const referencePolicy = referencePolicyForUnit(unit, refs)
  const noReferenceAllowed = referencePolicy === 'clean_plate'
    || referencePolicy === 'forbidden'
    || referencePolicy === 'no_reference_allowed'
  return {
    schemaVersion: 1,
    panelId: unit.id,
    primarySubject: unit.shotSpec.primarySubject || primaryAsset?.name || unit.description || '当前镜头主体',
    subjectType: visualIntent === 'text_card' ? 'text_card' : subjectTypeForAsset(primaryAsset),
    visualIntent,
    referencePolicy,
    noReferenceAllowed,
    noReferenceReason: noReferenceAllowed
      ? (referencePolicy === 'clean_plate' ? 'clean_plate_or_text_card' : 'one_off_or_reference_forbidden')
      : null,
    requirements: refs.map(fallbackRequirementForAsset),
    confidence: refs.length > 0 ? 0.65 : 0.42,
    source: 'fallback',
    warnings: ['LLM requirement plan unavailable; derived from explicit visual asset refs.'],
  }
}

function normalizeRequirement(value: unknown, assetById: ReadonlyMap<string, VisualAssetRef>): ShotAssetRequirement | null {
  const raw = asRecord(value)
  const kind = readAssetKind(raw.kind)
  const name = readString(raw.name)
  if (!kind || !name) return null

  const assetId = readNullableString(raw.assetId ?? raw.matchedAssetId)
  const matchedAsset = assetId ? assetById.get(assetId) : undefined
  const normalizedKind = matchedAsset?.kind || kind
  const normalizedName = matchedAsset?.name || name
  return {
    name: normalizedName,
    kind: normalizedKind,
    ...(readOptionalString(raw.semanticType) ? { semanticType: readOptionalString(raw.semanticType) } : {}),
    assetId: matchedAsset?.id || assetId || null,
    role: readRequirementRole(raw.role, normalizedKind === 'location' ? 'environment' : 'prop_detail'),
    required: readBoolean(raw.required, true),
    mustLock: readBoolean(raw.mustLock, normalizedKind !== 'location'),
    reuseExpected: readBoolean(raw.reuseExpected, true),
    reason: readString(raw.reason) || '模型判断该资产与镜头画面主体有关',
  }
}

export function normalizeShotAssetRequirementPlan(
  value: unknown,
  unit: VisualUnit,
  assets: VisualAssetRef[],
): ShotAssetRequirementPlan {
  const fallback = buildFallbackShotAssetRequirementPlan(unit)
  const raw = asRecord(value)
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const requirements = Array.isArray(raw.requirements)
    ? raw.requirements.flatMap((item) => {
        const requirement = normalizeRequirement(item, assetById)
        return requirement ? [requirement] : []
      })
    : fallback.requirements
  const referencePolicy = readReferencePolicy(raw.referencePolicy, fallback.referencePolicy)
  const noReferenceAllowed = readBoolean(
    raw.noReferenceAllowed,
    referencePolicy === 'forbidden' || referencePolicy === 'clean_plate' || referencePolicy === 'no_reference_allowed',
  )
  return {
    schemaVersion: 1,
    panelId: readString(raw.panelId) || fallback.panelId,
    primarySubject: readString(raw.primarySubject) || fallback.primarySubject,
    subjectType: readSubjectType(raw.subjectType, fallback.subjectType),
    visualIntent: readVisualIntent(raw.visualIntent, fallback.visualIntent),
    referencePolicy,
    noReferenceAllowed,
    noReferenceReason: readNullableString(raw.noReferenceReason) || (noReferenceAllowed ? fallback.noReferenceReason : null),
    requirements,
    confidence: readConfidence(raw.confidence, fallback.confidence),
    source: raw.source === 'llm' ? 'llm' : fallback.source,
    warnings: readStringArray(raw.warnings),
  }
}

export function normalizeShotAssetRequirementPlanResult(
  value: unknown,
  units: VisualUnit[],
  assets: VisualAssetRef[],
): ShotAssetRequirementPlanResult {
  const raw = asRecord(value)
  const rawPlans = Array.isArray(raw.plans) ? raw.plans : []
  const rawByPanelId = new Map<string, unknown>()
  for (const item of rawPlans) {
    const record = asRecord(item)
    const panelId = readString(record.panelId)
    if (panelId) rawByPanelId.set(panelId, item)
  }
  return {
    schemaVersion: 1,
    plans: units.map((unit) => normalizeShotAssetRequirementPlan(rawByPanelId.get(unit.id), unit, assets)),
  }
}

export function buildFallbackShotAssetRequirementPlanResult(
  units: VisualUnit[],
): ShotAssetRequirementPlanResult {
  return {
    schemaVersion: 1,
    plans: units.map(buildFallbackShotAssetRequirementPlan),
  }
}

export function findShotAssetRequirementPlan(
  result: ShotAssetRequirementPlanResult | null | undefined,
  panelId: string,
): ShotAssetRequirementPlan | null {
  if (!result || !Array.isArray(result.plans)) return null
  return result.plans.find((plan) => plan.panelId === panelId) || null
}

export function readShotAssetRequirementPlanFromUnknown(value: unknown): ShotAssetRequirementPlan | null {
  const raw = asRecord(value)
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.requirements)) return null
  return raw as unknown as ShotAssetRequirementPlan
}

export function readShotAssetRequirementPlanFromRules(value: unknown): ShotAssetRequirementPlan | null {
  const rules = asRecord(value)
  return readShotAssetRequirementPlanFromUnknown(rules.shotAssetRequirementPlan)
    || readShotAssetRequirementPlanFromUnknown(asRecord(rules.assetBindingPlan).requirementPlan)
}

export function readShotAssetRequirementPlanFromReferencePlan(value: unknown): ShotAssetRequirementPlan | null {
  const plan = asRecord(value)
  return readShotAssetRequirementPlanFromUnknown(plan.shotAssetRequirementPlan)
    || readShotAssetRequirementPlanFromUnknown(asRecord(plan.bindingPlan).requirementPlan)
}

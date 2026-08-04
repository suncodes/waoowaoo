export type AssetPromptKind = 'character' | 'location' | 'prop'

export type PromptFactOrigin = 'source' | 'design_assumption' | 'unknown'

export type AssetVisualFactCategory =
  | 'identity'
  | 'silhouette'
  | 'costume_or_material'
  | 'color'
  | 'key_part'
  | 'exclusion'

export interface PromptEvidence {
  id: string
  source: 'asset_description' | 'profile_data'
  text: string
  priority: 'required' | 'supporting'
}

export interface PromptFact {
  category: AssetVisualFactCategory
  value: string
  evidenceRefs: string[]
  confidence: number
  origin: PromptFactOrigin
}

export interface AssetVisualFactInput {
  identityLocks?: unknown
  silhouetteLocks?: unknown
  costumeOrMaterialLocks?: unknown
  colorLocks?: unknown
  keyPartLocks?: unknown
  exclusions?: unknown
  physicalForm?: unknown
  orientation?: unknown
}

export interface AssetVisualContract {
  schemaVersion: 1
  assetKind: AssetPromptKind
  sourceEvidence: PromptEvidence[]
  identityLocks: PromptFact[]
  silhouetteLocks: PromptFact[]
  costumeOrMaterialLocks: PromptFact[]
  colorLocks: PromptFact[]
  keyPartLocks: PromptFact[]
  exclusions: PromptFact[]
  validationIssues: string[]
  fallbackUsed: boolean
}

type ProfileData = Record<string, unknown>

interface NormalizedAssetVisualFactInput {
  identityLocks: string[]
  silhouetteLocks: string[]
  costumeOrMaterialLocks: string[]
  colorLocks: string[]
  keyPartLocks: string[]
  exclusions: string[]
}

const CATEGORY_LIMITS: Record<AssetVisualFactCategory, number> = {
  identity: 3,
  silhouette: 3,
  costume_or_material: 4,
  color: 3,
  key_part: 4,
  exclusion: 5,
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeFactValue(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function isStructuredDataText(value: string): boolean {
  const normalized = value.trim()
  if (!/^[\[{]/u.test(normalized)) return false
  try {
    const parsed = JSON.parse(normalized) as unknown
    return Boolean(parsed) && typeof parsed === 'object'
  } catch {
    return false
  }
}

function isRenderableFactValue(value: string): boolean {
  return Boolean(value) && !isStructuredDataText(value) && !UUID_PATTERN.test(value)
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((item) => typeof item === 'string' ? [normalizeFactValue(item)] : [])
    .filter(isRenderableFactValue)
}

function readString(value: unknown): string {
  const normalized = typeof value === 'string' ? normalizeFactValue(value) : ''
  return isRenderableFactValue(normalized) ? normalized : ''
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const normalized = value.toLocaleLowerCase()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function limitFactValue(value: string): string {
  return value.length <= 180 ? value : `${value.slice(0, 177).trimEnd()}…`
}

function profileArray(profile: ProfileData, key: string): string[] {
  return stringArray(profile[key])
}

function profileString(profile: ProfileData, key: string): string[] {
  const value = readString(profile[key])
  return value ? [value] : []
}

function addEvidence(
  evidence: PromptEvidence[],
  values: string[],
  source: PromptEvidence['source'],
  prefix: string,
  priority: PromptEvidence['priority'],
): string[] {
  return values.map((value, index) => {
    const id = `${prefix}.${index + 1}`
    evidence.push({ id, source, text: value, priority })
    return id
  })
}

function buildFacts(params: {
  category: AssetVisualFactCategory
  values: string[]
  evidenceRefs: string[]
  confidence: number
  origin: PromptFactOrigin
}): PromptFact[] {
  const values = uniqueStrings(params.values.map(limitFactValue))
    .slice(0, CATEGORY_LIMITS[params.category])
  return values.map((value, index) => ({
    category: params.category,
    value,
    evidenceRefs: params.evidenceRefs[index] ? [params.evidenceRefs[index]] : params.evidenceRefs.slice(0, 1),
    confidence: params.confidence,
    origin: params.origin,
  }))
}

function buildProfileFactInput(profileData: unknown): AssetVisualFactInput {
  const profile = asRecord(profileData)
  return {
    identityLocks: [
      ...profileArray(profile, 'identity_locks'),
      ...profileString(profile, 'gender'),
      ...profileString(profile, 'age_range'),
    ],
    silhouetteLocks: profileArray(profile, 'silhouette_locks'),
    costumeOrMaterialLocks: profileArray(profile, 'costume_locks'),
    colorLocks: uniqueStrings([
      ...profileArray(profile, 'color_locks'),
      ...profileArray(profile, 'suggested_colors'),
    ]),
    keyPartLocks: uniqueStrings([
      ...profileString(profile, 'primary_identifier'),
      ...profileArray(profile, 'visual_keywords'),
    ]),
    exclusions: profileArray(profile, 'forbidden_variants'),
  }
}

function mergeFactInput(
  profileInput: AssetVisualFactInput,
  extractedInput: AssetVisualFactInput | null | undefined,
): NormalizedAssetVisualFactInput {
  const extracted = extractedInput || {}
  return {
    identityLocks: uniqueStrings([
      ...stringArray(profileInput.identityLocks),
      ...stringArray(extracted.identityLocks),
    ]),
    silhouetteLocks: uniqueStrings([
      ...stringArray(profileInput.silhouetteLocks),
      ...stringArray(extracted.silhouetteLocks),
    ]),
    costumeOrMaterialLocks: uniqueStrings([
      ...stringArray(profileInput.costumeOrMaterialLocks),
      ...stringArray(extracted.costumeOrMaterialLocks),
    ]),
    colorLocks: uniqueStrings([
      ...stringArray(profileInput.colorLocks),
      ...stringArray(extracted.colorLocks),
    ]),
    keyPartLocks: uniqueStrings([
      ...stringArray(profileInput.keyPartLocks),
      ...stringArray(extracted.keyPartLocks),
    ]),
    exclusions: uniqueStrings([
      ...stringArray(profileInput.exclusions),
      ...stringArray(extracted.exclusions),
    ]),
  }
}

export function parseAssetVisualFactInput(value: unknown): AssetVisualFactInput {
  const record = asRecord(value)
  const physicalForm = record.physical_form
    ?? record.physicalForm
    ?? record.render_form
    ?? record.renderForm
  const orientation = record.orientation
  return {
    identityLocks: record.identity_locks ?? record.identityLocks,
    silhouetteLocks: record.silhouette_locks ?? record.silhouetteLocks,
    costumeOrMaterialLocks: record.costume_or_material_locks
      ?? record.costume_locks
      ?? record.costumeOrMaterialLocks,
    colorLocks: record.color_locks ?? record.colorLocks,
    keyPartLocks: record.key_part_locks
      ?? record.primary_identifier
      ?? record.keyPartLocks,
    exclusions: record.forbidden_variants ?? record.exclusions,
    ...(physicalForm !== undefined ? { physicalForm } : {}),
    ...(orientation !== undefined ? { orientation } : {}),
  }
}

export function hasStructuredAssetVisualFacts(value: unknown): boolean {
  const facts = parseAssetVisualFactInput(value)
  return [
    facts.identityLocks,
    facts.silhouetteLocks,
    facts.costumeOrMaterialLocks,
    facts.colorLocks,
    facts.keyPartLocks,
    facts.physicalForm,
    facts.orientation,
  ].some((item) => stringArray(item).length > 0)
}

export function promptFactValues(facts: PromptFact[]): string[] {
  return facts.map((fact) => fact.value)
}

export function buildAssetVisualContract(params: {
  assetKind: AssetPromptKind
  description: string
  profileData?: unknown
  extractedFacts?: AssetVisualFactInput | null
}): AssetVisualContract {
  const description = normalizeFactValue(params.description)
  const profile = buildProfileFactInput(params.profileData)
  const merged = mergeFactInput(profile, params.extractedFacts)
  const evidence: PromptEvidence[] = []
  const descriptionEvidenceRefs = isRenderableFactValue(description)
    ? addEvidence(evidence, [description], 'asset_description', 'description', 'supporting')
    : []
  const profileEvidence = (values: string[], category: string): string[] => addEvidence(
    evidence,
    values,
    'profile_data',
    `profile.${category}`,
    'required',
  )
  const extractedEvidence = (values: string[]): string[] =>
    descriptionEvidenceRefs.length > 0 ? values.map(() => descriptionEvidenceRefs[0]) : []
  const profileValues = {
    identity: stringArray(profile.identityLocks),
    silhouette: stringArray(profile.silhouetteLocks),
    costumeOrMaterial: stringArray(profile.costumeOrMaterialLocks),
    color: stringArray(profile.colorLocks),
    keyPart: stringArray(profile.keyPartLocks),
    exclusions: stringArray(profile.exclusions),
  }
  const extracted = params.extractedFacts || {}
  const extractedValues = {
    identity: stringArray(extracted.identityLocks),
    silhouette: stringArray(extracted.silhouetteLocks),
    costumeOrMaterial: stringArray(extracted.costumeOrMaterialLocks),
    color: stringArray(extracted.colorLocks),
    keyPart: stringArray(extracted.keyPartLocks),
    exclusions: stringArray(extracted.exclusions),
  }
  const evidenceRefs = {
    identity: [
      ...profileEvidence(profileValues.identity, 'identity'),
      ...extractedEvidence(extractedValues.identity),
    ],
    silhouette: [
      ...profileEvidence(profileValues.silhouette, 'silhouette'),
      ...extractedEvidence(extractedValues.silhouette),
    ],
    costumeOrMaterial: [
      ...profileEvidence(profileValues.costumeOrMaterial, 'costume_or_material'),
      ...extractedEvidence(extractedValues.costumeOrMaterial),
    ],
    color: [
      ...profileEvidence(profileValues.color, 'color'),
      ...extractedEvidence(extractedValues.color),
    ],
    keyPart: [
      ...profileEvidence(profileValues.keyPart, 'key_part'),
      ...extractedEvidence(extractedValues.keyPart),
    ],
    exclusions: [
      ...profileEvidence(profileValues.exclusions, 'exclusions'),
      ...extractedEvidence(extractedValues.exclusions),
    ],
  }
  const hasStructuredFacts = [
    merged.identityLocks,
    merged.silhouetteLocks,
    merged.costumeOrMaterialLocks,
    merged.colorLocks,
    merged.keyPartLocks,
  ].some((values) => values.length > 0)
  const hasExtractedFacts = Object.values(extractedValues).some((values) => values.length > 0)
  const fallbackFacts = !hasStructuredFacts && descriptionEvidenceRefs.length > 0
    ? buildFacts({
      category: 'silhouette',
      values: [description],
      evidenceRefs: descriptionEvidenceRefs,
      confidence: 0.45,
      origin: 'source',
    })
    : []
  const validationIssues: string[] = []
  if (!hasStructuredFacts) validationIssues.push('NO_STRUCTURED_VISUAL_FACTS')
  if (!description && evidence.length === 0) validationIssues.push('NO_SOURCE_EVIDENCE')
  if (description && descriptionEvidenceRefs.length === 0) validationIssues.push('NON_RENDERABLE_SOURCE_DESCRIPTION')
  if (hasExtractedFacts && descriptionEvidenceRefs.length === 0) {
    validationIssues.push('EXTRACTED_FACTS_WITHOUT_SOURCE_EVIDENCE')
  }
  return {
    schemaVersion: 1,
    assetKind: params.assetKind,
    sourceEvidence: evidence,
    identityLocks: buildFacts({
      category: 'identity',
      values: merged.identityLocks,
      evidenceRefs: evidenceRefs.identity,
      confidence: 0.9,
      origin: 'source',
    }),
    silhouetteLocks: hasStructuredFacts
      ? buildFacts({
        category: 'silhouette',
        values: merged.silhouetteLocks,
        evidenceRefs: evidenceRefs.silhouette,
        confidence: 0.9,
        origin: 'source',
      })
      : fallbackFacts,
    costumeOrMaterialLocks: buildFacts({
      category: 'costume_or_material',
      values: merged.costumeOrMaterialLocks,
      evidenceRefs: evidenceRefs.costumeOrMaterial,
      confidence: 0.9,
      origin: 'source',
    }),
    colorLocks: buildFacts({
      category: 'color',
      values: merged.colorLocks,
      evidenceRefs: evidenceRefs.color,
      confidence: 0.9,
      origin: 'source',
    }),
    keyPartLocks: buildFacts({
      category: 'key_part',
      values: merged.keyPartLocks,
      evidenceRefs: evidenceRefs.keyPart,
      confidence: 0.9,
      origin: 'source',
    }),
    exclusions: buildFacts({
      category: 'exclusion',
      values: merged.exclusions,
      evidenceRefs: evidenceRefs.exclusions,
      confidence: 0.9,
      origin: 'source',
    }),
    validationIssues,
    fallbackUsed: !hasStructuredFacts,
  }
}

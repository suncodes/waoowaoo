import {
  readShotAssetRequirementPlanFromReferencePlan,
  readShotAssetRequirementPlanFromRules,
  readShotAssetRequirementPlanFromUnknown,
  type ShotAssetRequirement,
  type ShotAssetRequirementPlan,
} from './shot-asset-requirements'

export type VisualAssetKind = 'character' | 'location' | 'prop'

export interface VisualAssetRef {
  id: string
  kind: VisualAssetKind
  name: string
}

export type PanelAssetBindingRole =
  | 'primary_identity'
  | 'supporting_identity'
  | 'environment'
  | 'prop_detail'
  | 'cover_motif'
  | 'comparison_prop'
  | 'style_only'

export interface PanelAssetBinding extends VisualAssetRef {
  role: PanelAssetBindingRole
  source: 'requirement_plan' | 'shot_spec' | 'legacy_panel' | 'source_anchor'
  weight: number
}

export interface SuppressedPanelAssetBinding extends VisualAssetRef {
  source: PanelAssetBinding['source']
  reason: string
}

export interface PanelVisualBindings {
  primarySubject: string
  visualType: string
  renderMode: string
  visibleAssets: PanelAssetBinding[]
  suppressedAssets: SuppressedPanelAssetBinding[]
  usedShotSpec: boolean
  shotAssetRequirementPlan?: ShotAssetRequirementPlan | null
}

export interface PanelForVisualBindings {
  description?: string | null
  imagePrompt?: string | null
  characters?: string | null
  location?: string | null
  props?: string | null
  sourceAnchor?: unknown
  photographyRules?: unknown
  referencePlan?: unknown
  shotAssetRequirementPlan?: unknown
  visualType?: string | null
  renderMode?: string | null
  duration?: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value)
  return isRecord(parsed) ? parsed : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function uniqueById(refs: VisualAssetRef[]): VisualAssetRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false
    seen.add(ref.id)
    return true
  })
}

function readAssetRefs(value: unknown): VisualAssetRef[] {
  if (!Array.isArray(value)) return []
  return uniqueById(value.flatMap((item): VisualAssetRef[] => {
    const record = isRecord(item) ? item : {}
    const id = readString(record.id)
    const name = readString(record.name)
    const kind = record.kind === 'character' || record.kind === 'location' || record.kind === 'prop'
      ? record.kind
      : null
    return id && name && kind ? [{ id, name, kind }] : []
  }))
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item.trim()]
      if (isRecord(item)) {
        const name = readString(item.name)
        return name ? [name] : []
      }
      return []
    })
  } catch {
    return []
  }
}

export function readSourceAnchorVisualAssetIds(sourceAnchor: unknown): string[] {
  const record = asRecord(sourceAnchor)
  const value = record.visualAssetIds
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])))
}

export function readPanelShotSpec(photographyRules: unknown): Record<string, unknown> {
  const rules = asRecord(photographyRules)
  return asRecord(rules.shotSpec)
}

export function readPanelShotAssetRequirementPlan(panel: PanelForVisualBindings): ShotAssetRequirementPlan | null {
  return readShotAssetRequirementPlanFromUnknown(panel.shotAssetRequirementPlan)
    || readShotAssetRequirementPlanFromRules(panel.photographyRules)
    || readShotAssetRequirementPlanFromReferencePlan(panel.referencePlan)
}

function readShotSpecText(shotSpec: Record<string, unknown>): string {
  const fields = [
    shotSpec.primarySubject,
    shotSpec.narrativeIntent,
    shotSpec.subjectIdentity,
    shotSpec.startState,
    shotSpec.actionBeats,
    shotSpec.endState,
    shotSpec.constraints,
    isRecord(shotSpec.promptBlueprint) ? shotSpec.promptBlueprint.subject : null,
    isRecord(shotSpec.promptBlueprint) ? shotSpec.promptBlueprint.environment : null,
    isRecord(shotSpec.promptBlueprint) ? shotSpec.promptBlueprint.action : null,
  ]
  return JSON.stringify(fields).toLowerCase()
}

function aliases(name: string): string[] {
  const normalized = name.toLowerCase().trim()
  const splitAliases = normalized
    .split(/[\/|,，、：《》"“”'’‘\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
  const suffixTrimmedAliases = [
    '潜水艇',
    '飞船',
    '舰船',
    '车辆',
    '汽车',
    '道具',
    '物件',
    '武器',
    '书籍',
    '封面',
    '书封',
    '图案',
    '标志',
    '徽章',
    'submarine',
    'spaceship',
    'vehicle',
    'prop',
    'object',
    'weapon',
    'book',
    'cover',
    'motif',
    'logo',
    'emblem',
  ].flatMap((suffix) => {
    if (!normalized.endsWith(suffix) || normalized.length <= suffix.length + 1) return []
    const value = normalized.slice(0, -suffix.length).trim()
    return value.length >= 3 ? [value] : []
  })
  return Array.from(new Set([
    normalized,
    ...splitAliases,
    ...suffixTrimmedAliases,
  ].filter((item) => item.length >= 2)))
}

function textMentionsName(text: string, name: string): boolean {
  const normalized = text.toLowerCase()
  const full = name.toLowerCase().trim()
  return Boolean(full && normalized.includes(full)) || aliases(name).some((item) => normalized.includes(item))
}

function looksLikeCoverMotif(text: string): boolean {
  return /(书封|封面|书籍封面|图案|标志|标识|徽章|纹章|book cover|cover|motif|logo|emblem|badge|symbol|pattern)/iu.test(text)
}

function looksLikeDiagram(text: string): boolean {
  return /(图表|示意图|diagram|chart|timeline|时间线)/iu.test(text)
}

function readPrimarySubject(panel: PanelForVisualBindings, shotSpec: Record<string, unknown>, fallbackAssets: VisualAssetRef[]): string {
  return readString(shotSpec.primarySubject)
    || fallbackAssets.find((asset) => asset.kind === 'character')?.name
    || fallbackAssets[0]?.name
    || readString(panel.imagePrompt)
    || readString(panel.description)
    || '当前镜头主体'
}

function readLegacyPanelRefs(panel: PanelForVisualBindings): VisualAssetRef[] {
  const refs: VisualAssetRef[] = []
  for (const name of parseStringArray(panel.characters)) {
    refs.push({ id: `legacy-character:${name}`, kind: 'character', name })
  }
  if (panel.location) {
    refs.push({ id: `legacy-location:${panel.location}`, kind: 'location', name: panel.location })
  }
  for (const name of parseStringArray(panel.props)) {
    refs.push({ id: `legacy-prop:${name}`, kind: 'prop', name })
  }
  return uniqueById(refs)
}

function roleForAsset(params: {
  asset: VisualAssetRef
  primarySubject: string
  visualType: string
  renderMode: string
  shotText: string
  source: PanelAssetBinding['source']
}): PanelAssetBindingRole | null {
  const primary = params.primarySubject.toLowerCase()
  const subjectLooksLikeCoverMotif = params.visualType === 'book_cover' || looksLikeCoverMotif(primary)
  const subjectLooksLikeDiagram = params.visualType === 'diagram' || looksLikeDiagram(primary)
  const textOnly = params.renderMode === 'text_card' || params.visualType === 'quote_card' || params.visualType === 'kinetic_text'
  const matchesPrimary = textMentionsName(primary, params.asset.name)
  const mentionedInShot = matchesPrimary || textMentionsName(params.shotText, params.asset.name)

  if (textOnly) {
    return params.asset.kind === 'location' && mentionedInShot ? 'environment' : null
  }
  if (subjectLooksLikeCoverMotif) {
    if (params.asset.kind !== 'prop') return null
    return mentionedInShot || params.source === 'shot_spec' || looksLikeCoverMotif(params.asset.name) ? 'cover_motif' : null
  }
  if (subjectLooksLikeDiagram) {
    if (params.asset.kind === 'character') return null
    return mentionedInShot ? (params.asset.kind === 'location' ? 'environment' : 'comparison_prop') : null
  }
  if (params.asset.kind === 'character') {
    if (matchesPrimary) return 'primary_identity'
    return params.source === 'legacy_panel' || mentionedInShot ? 'supporting_identity' : null
  }
  if (params.asset.kind === 'location') return 'environment'
  return 'prop_detail'
}

function weightForRole(role: PanelAssetBindingRole): number {
  if (role === 'primary_identity') return 1
  if (role === 'supporting_identity') return 0.75
  if (role === 'prop_detail') return 0.7
  if (role === 'cover_motif') return 0.65
  if (role === 'environment') return 0.6
  if (role === 'comparison_prop') return 0.55
  return 0.35
}

function matchRequirementAsset(
  requirement: ShotAssetRequirement,
  assets: VisualAssetRef[],
): VisualAssetRef | null {
  if (requirement.assetId) {
    const exact = assets.find((asset) => asset.id === requirement.assetId)
    return exact || {
      id: requirement.assetId,
      kind: requirement.kind,
      name: requirement.name,
    }
  }
  return assets.find((asset) => asset.kind === requirement.kind && textMentionsName(asset.name, requirement.name))
    || assets.find((asset) => asset.kind === requirement.kind && textMentionsName(requirement.name, asset.name))
    || null
}

function resolvePanelVisualBindingsFromRequirementPlan(params: {
  requirementPlan: ShotAssetRequirementPlan
  fallbackAssets: VisualAssetRef[]
  visualType: string
  renderMode: string
  usedShotSpec: boolean
}): PanelVisualBindings {
  const visibleAssets: PanelAssetBinding[] = []
  const suppressedAssets: SuppressedPanelAssetBinding[] = []
  const seenBindingKeys = new Set<string>()

  for (const requirement of params.requirementPlan.requirements) {
    const asset = matchRequirementAsset(requirement, params.fallbackAssets)
    if (!asset) {
      suppressedAssets.push({
        id: `missing:${requirement.kind}:${requirement.name}`,
        kind: requirement.kind,
        name: requirement.name,
        source: 'requirement_plan',
        reason: requirement.required || requirement.mustLock
          ? 'required asset is missing and must be backfilled before reliable generation'
          : 'optional asset is unavailable',
      })
      continue
    }
    const bindingKey = `${asset.id}:${requirement.role}`
    if (seenBindingKeys.has(bindingKey)) continue
    seenBindingKeys.add(bindingKey)
    visibleAssets.push({
      ...asset,
      role: requirement.role,
      source: 'requirement_plan',
      weight: weightForRole(requirement.role) + (requirement.mustLock ? 0.1 : 0),
    })
  }

  return {
    primarySubject: params.requirementPlan.primarySubject,
    visualType: params.visualType,
    renderMode: params.renderMode,
    visibleAssets,
    suppressedAssets,
    usedShotSpec: params.usedShotSpec,
    shotAssetRequirementPlan: params.requirementPlan,
  }
}

export function resolvePanelVisualBindings(panel: PanelForVisualBindings): PanelVisualBindings {
  const shotSpec = readPanelShotSpec(panel.photographyRules)
  const shotAssets = readAssetRefs(shotSpec.visibleAssets)
  const legacyAssets = readLegacyPanelRefs(panel)
  const usedShotSpec = shotAssets.length > 0
  const rawAssets = usedShotSpec ? shotAssets : legacyAssets
  const requirementPlan = readPanelShotAssetRequirementPlan(panel)
  const primarySubject = readPrimarySubject(panel, shotSpec, rawAssets)
  const visualType = readString(panel.visualType) || 'illustration'
  const renderMode = readString(panel.renderMode) || 'generated_image'
  if (requirementPlan) {
    return resolvePanelVisualBindingsFromRequirementPlan({
      requirementPlan,
      fallbackAssets: rawAssets,
      visualType,
      renderMode,
      usedShotSpec,
    })
  }
  const shotText = JSON.stringify({
    primarySubject,
    visualType,
    renderMode,
    description: panel.description,
    imagePrompt: panel.imagePrompt,
    shotSpec: readShotSpecText(shotSpec),
  }).toLowerCase()
  const source: PanelAssetBinding['source'] = usedShotSpec ? 'shot_spec' : 'legacy_panel'
  const visibleAssets: PanelAssetBinding[] = []
  const suppressedAssets: SuppressedPanelAssetBinding[] = []

  for (const asset of rawAssets) {
    const role = roleForAsset({ asset, primarySubject, visualType, renderMode, shotText, source })
    if (!role) {
      suppressedAssets.push({
        ...asset,
        source,
        reason: 'asset does not match the panel primary subject, render mode, or visual type',
      })
      continue
    }
    visibleAssets.push({
      ...asset,
      role,
      source,
      weight: weightForRole(role),
    })
  }

  return {
    primarySubject,
    visualType,
    renderMode,
    visibleAssets,
    suppressedAssets,
    usedShotSpec,
    shotAssetRequirementPlan: null,
  }
}

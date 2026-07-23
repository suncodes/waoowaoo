export type AssetBibleKind = 'character' | 'location' | 'prop' | 'symbol'

export type AssetBibleRole = 'primary' | 'secondary' | 'background' | 'symbolic'

export type AssetBiblePriority = 'must_lock' | 'normal' | 'optional'

export type AssetBibleGenerationNeed = 'reference_required' | 'prompt_only' | 'no_generation'

export interface AssetBibleEvidence {
  sourceId: string
  text: string
  confidence: number
}

export interface AssetBibleItem {
  id: string
  kind: AssetBibleKind
  canonicalName: string
  aliases: string[]
  role: AssetBibleRole
  narrativeFunction: string
  evidence: AssetBibleEvidence[]
  visualInvariants: string[]
  allowedVariants: string[]
  forbiddenVariants: string[]
  firstAppearance: string
  usedByPanels: string[]
  priority: AssetBiblePriority
  generationNeed: AssetBibleGenerationNeed
}

export interface AssetBibleAnchorInput {
  assetId: string
  assetKind: 'character' | 'location' | 'prop'
  semanticKind?: string
  name: string
  aliases?: string[]
  description?: string
  importance?: 'core' | 'supporting'
  sourceUnitIds?: string[]
}

interface ContentClipInput {
  id: string
  summary?: string | null
  content?: string | null
  screenplay?: string | null
  characters?: string | null
  location?: string | null
  props?: string | null
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function compactText(value: unknown, maxLength = 180): string {
  const text = readString(value)
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function splitAliases(name: string): string[] {
  return uniqueStrings(name.split(/[\/|,，、]/g))
}

function assetAliases(anchor: AssetBibleAnchorInput): string[] {
  return uniqueStrings([
    ...splitAliases(anchor.name),
    ...(anchor.aliases || []),
  ])
}

function normalizeKind(anchor: AssetBibleAnchorInput): AssetBibleKind {
  if (anchor.semanticKind === 'book_cover' || anchor.semanticKind === 'diagram') return 'symbol'
  return anchor.assetKind
}

function roleForAnchor(anchor: AssetBibleAnchorInput): AssetBibleRole {
  if (anchor.semanticKind === 'book_cover' || anchor.semanticKind === 'diagram') return 'symbolic'
  if (anchor.importance === 'core') return 'primary'
  return 'secondary'
}

function priorityForAnchor(anchor: AssetBibleAnchorInput): AssetBiblePriority {
  if (anchor.importance === 'core') return 'must_lock'
  if (anchor.sourceUnitIds && anchor.sourceUnitIds.length > 0) return 'normal'
  return 'optional'
}

function generationNeedForAnchor(anchor: AssetBibleAnchorInput): AssetBibleGenerationNeed {
  if (anchor.importance === 'core') return 'reference_required'
  return anchor.sourceUnitIds && anchor.sourceUnitIds.length > 0 ? 'prompt_only' : 'no_generation'
}

function unitTextFromContentPlan(contentPlan: unknown): Map<string, string> {
  const plan = asRecord(contentPlan)
  const output = new Map<string, string>()
  if (!plan) return output
  const units = plan.planType === 'guide' ? plan.segments : plan.beats
  if (!Array.isArray(units)) return output
  units.forEach((value, index) => {
    const unit = asRecord(value)
    if (!unit) return
    const id = readString(unit.id) || `content_unit_${index + 1}`
    const text = compactText([
      readString(unit.title),
      readString(unit.narration),
      readString(unit.summary),
      readString(unit.visualPurpose),
      Array.isArray(unit.visualHints) ? unit.visualHints.join(' ') : '',
    ].filter(Boolean).join(' '))
    output.set(id, text)
  })
  return output
}

function unitTextFromClips(clips: ContentClipInput[]): Map<string, string> {
  const output = new Map<string, string>()
  for (const clip of clips) {
    output.set(clip.id, compactText([
      clip.summary,
      clip.content,
      clip.screenplay,
      clip.characters,
      clip.location,
      clip.props,
    ].filter(Boolean).join(' ')))
  }
  return output
}

function buildEvidence(
  sourceUnitIds: string[],
  sourceTextById: ReadonlyMap<string, string>,
): AssetBibleEvidence[] {
  return sourceUnitIds.map((sourceId) => ({
    sourceId,
    text: sourceTextById.get(sourceId) || sourceId,
    confidence: sourceTextById.has(sourceId) ? 0.85 : 0.65,
  }))
}

function buildVisualInvariants(anchor: AssetBibleAnchorInput): string[] {
  return uniqueStrings([
    anchor.name,
    ...(anchor.aliases || []),
    anchor.description || '',
  ])
}

function readUnitId(value: JsonRecord, fallbackIndex: number): string {
  return readString(value.id)
    || readString(value.panelId)
    || readString(value.clipId)
    || `visual_unit_${fallbackIndex + 1}`
}

function buildAssetUsageMap(visualUnits: unknown[] = []): Map<string, string[]> {
  const usage = new Map<string, string[]>()
  visualUnits.forEach((value, index) => {
    const unit = asRecord(value)
    if (!unit || !Array.isArray(unit.assetRefs)) return
    const unitId = readUnitId(unit, index)
    for (const ref of unit.assetRefs) {
      const record = asRecord(ref)
      const assetId = record ? readString(record.id) : ''
      if (!assetId) continue
      const existing = usage.get(assetId) || []
      existing.push(unitId)
      usage.set(assetId, uniqueStrings(existing))
    }
  })
  return usage
}

function textMentionsAsset(value: unknown, aliases: string[]): boolean {
  if (aliases.length === 0) return false
  const text = compactText(
    typeof value === 'string'
      ? value
      : JSON.stringify(value),
    2000,
  ).toLowerCase()
  return aliases
    .map((alias) => alias.toLowerCase())
    .some((alias) => alias.length >= 2 && text.includes(alias))
}

function buildUsedByPanels(
  anchor: AssetBibleAnchorInput,
  visualUnits: unknown[],
  usageByAssetId: ReadonlyMap<string, string[]>,
): string[] {
  const aliases = assetAliases(anchor)
  const inferred = visualUnits.flatMap((value, index) => {
    const unit = asRecord(value)
    if (!unit || !textMentionsAsset(unit, aliases)) return []
    return [readUnitId(unit, index)]
  })
  return uniqueStrings([
    ...(usageByAssetId.get(anchor.assetId) || []),
    ...inferred,
  ])
}

export function buildAssetBible(params: {
  anchors: AssetBibleAnchorInput[]
  contentPlan: unknown
  clips: ContentClipInput[]
  visualUnits?: unknown[]
}): AssetBibleItem[] {
  const visualUnits = params.visualUnits || []
  const contentUnitText = unitTextFromContentPlan(params.contentPlan)
  const clipUnitText = unitTextFromClips(params.clips)
  const sourceTextById = new Map([...contentUnitText, ...clipUnitText])
  const usageByAssetId = buildAssetUsageMap(visualUnits)

  return params.anchors.map((anchor) => {
    const sourceUnitIds = uniqueStrings(anchor.sourceUnitIds || [])
    const kind = normalizeKind(anchor)
    const priority = priorityForAnchor(anchor)
    const aliases = assetAliases(anchor)
    return {
      id: anchor.assetId,
      kind,
      canonicalName: anchor.name,
      aliases,
      role: roleForAnchor(anchor),
      narrativeFunction: anchor.description
        ? `${anchor.name}: ${anchor.description}`
        : `${anchor.name} used by ${sourceUnitIds.join(', ') || 'current project'}`,
      evidence: buildEvidence(sourceUnitIds, sourceTextById),
      visualInvariants: buildVisualInvariants(anchor),
      allowedVariants: [],
      forbiddenVariants: [
        '不要与其他资产合并',
        '不要被艺术风格替换成已有 IP 主体',
      ],
      firstAppearance: sourceUnitIds[0] || '',
      usedByPanels: buildUsedByPanels(anchor, visualUnits, usageByAssetId),
      priority,
      generationNeed: generationNeedForAnchor(anchor),
    }
  })
}

import {
  asWorkspaceRecord,
  cloneWorkspaceValue,
  type VisualAnchor,
  type VisualAnchorKind,
  type VisualAnchorSemanticKind,
} from './artifact-state'

type CharacterAssetInput = {
  id: string
  name: string
  introduction?: string | null
}

type LocationAssetInput = {
  id: string
  name: string
  summary?: string | null
  assetKind?: string | null
}

type ContentClipInput = {
  id: string
  summary?: string | null
  content?: string | null
  screenplay?: string | null
  characters?: string | null
  location?: string | null
  props?: string | null
}

type VisualUnitInput = {
  clipId: string
  description?: string
  imagePrompt?: string
  videoPrompt?: string
  shotSpec?: unknown
}

export type VisualUnitAssetRef = {
  id: string
  kind: VisualAnchorKind
  name: string
}

function resolveUnitAssetRefs(unit: VisualUnitInput, anchors: VisualAnchor[]): VisualUnitAssetRef[] {
  const unitText = normalizeText(unit)
  return anchors
    .filter((anchor) => (
      anchor.sourceUnitIds.includes(unit.clipId)
      || textMentionsAsset(unitText, anchor.name)
    ))
    .map((anchor) => ({
      id: anchor.assetId,
      kind: anchor.assetKind,
      name: anchor.name,
    }))
}

type UnitText = {
  id: string
  text: string
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value).toLowerCase()
  } catch {
    return ''
  }
}

function assetAliases(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\/|,，、]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function textMentionsAsset(text: string, name: string): boolean {
  return assetAliases(name).some((alias) => text.includes(alias))
}

function readPlanUnits(contentPlan: unknown): UnitText[] {
  const plan = asWorkspaceRecord(contentPlan)
  if (!plan) return []
  const rawUnits = plan.planType === 'guide'
    ? plan.segments
    : plan.beats
  if (!Array.isArray(rawUnits)) return []
  return rawUnits.flatMap((rawUnit, index) => {
    const unit = asWorkspaceRecord(rawUnit)
    if (!unit) return []
    const id = typeof unit.id === 'string' && unit.id.trim()
      ? unit.id.trim()
      : `content_unit_${index + 1}`
    return [{ id, text: normalizeText(unit) }]
  })
}

function readClipUnits(clips: ContentClipInput[]): UnitText[] {
  return clips.map((clip) => ({
    id: clip.id,
    text: normalizeText({
      summary: clip.summary,
      content: clip.content,
      screenplay: clip.screenplay,
      characters: clip.characters,
      location: clip.location,
      props: clip.props,
    }),
  }))
}

function semanticKind(kind: VisualAnchorKind, name: string, description: string): VisualAnchorSemanticKind {
  const normalized = `${name} ${description}`.toLowerCase()
  if (kind === 'prop' && /(鹦鹉螺号|nautilus|潜水艇|潜艇|舰|船|飞船|飞艇|汽车|轿车|卡车|列车|火车|机车|submarine|ship|vehicle|car|train)/i.test(normalized)) {
    return 'vehicle'
  }
  if (kind === 'prop' && /(书封|封面|book cover)/i.test(normalized)) return 'book_cover'
  if (kind === 'prop' && /(图表|示意图|diagram|chart)/i.test(normalized)) return 'diagram'
  return kind
}

function buildAnchor(params: {
  id: string
  name: string
  description: string
  kind: VisualAnchorKind
  unitTexts: UnitText[]
  forceInclude: boolean
}): VisualAnchor | null {
  const sourceUnitIds = params.unitTexts
    .filter((unit) => textMentionsAsset(unit.text, params.name))
    .map((unit) => unit.id)
  if (!params.forceInclude && sourceUnitIds.length === 0) return null
  const resolvedSemanticKind = semanticKind(params.kind, params.name, params.description)
  return {
    id: `${params.kind}:${params.id}`,
    assetId: params.id,
    assetKind: params.kind,
    semanticKind: resolvedSemanticKind,
    name: params.name,
    description: params.description,
    importance: params.kind === 'character'
      || resolvedSemanticKind === 'vehicle'
      || sourceUnitIds.length > 1
      ? 'core'
      : 'supporting',
    sourceUnitIds,
  }
}

export function buildVisualAnchors(params: {
  contentPlan: unknown
  clips: ContentClipInput[]
  characters: CharacterAssetInput[]
  locations: LocationAssetInput[]
  includeAssetIds?: Iterable<string>
}): VisualAnchor[] {
  const forcedIds = new Set(params.includeAssetIds || [])
  const unitTexts = [...readPlanUnits(params.contentPlan), ...readClipUnits(params.clips)]
  const anchors: VisualAnchor[] = []

  for (const character of params.characters) {
    const anchor = buildAnchor({
      id: character.id,
      name: character.name,
      description: character.introduction || '',
      kind: 'character',
      unitTexts,
      forceInclude: forcedIds.has(character.id),
    })
    if (anchor) anchors.push(anchor)
  }

  for (const location of params.locations) {
    const kind: VisualAnchorKind = location.assetKind === 'prop' ? 'prop' : 'location'
    const anchor = buildAnchor({
      id: location.id,
      name: location.name,
      description: location.summary || '',
      kind,
      unitTexts,
      forceInclude: forcedIds.has(location.id),
    })
    if (anchor) anchors.push(anchor)
  }

  return anchors.sort((left, right) => {
    if (left.importance !== right.importance) return left.importance === 'core' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

export function bindVisualUnitsToAnchors<T extends VisualUnitInput>(
  visualUnits: T[],
  anchors: VisualAnchor[],
): Array<T & { assetRefs: VisualUnitAssetRef[] }> {
  return visualUnits.map((unit) => {
    return {
      ...unit,
      assetRefs: resolveUnitAssetRefs(unit, anchors),
    }
  })
}

export function bindStoredVisualUnitsToAnchors(
  visualUnits: unknown[],
  anchors: VisualAnchor[],
): unknown[] {
  return visualUnits.map((value) => {
    const unit = asWorkspaceRecord(value)
    if (!unit || typeof unit.clipId !== 'string' || !unit.clipId.trim()) {
      return cloneWorkspaceValue(value)
    }
    return {
      ...cloneWorkspaceValue(unit),
      assetRefs: resolveUnitAssetRefs({
        clipId: unit.clipId,
        description: typeof unit.description === 'string' ? unit.description : undefined,
        imagePrompt: typeof unit.imagePrompt === 'string' ? unit.imagePrompt : undefined,
        videoPrompt: typeof unit.videoPrompt === 'string' ? unit.videoPrompt : undefined,
        shotSpec: unit.shotSpec,
      }, anchors),
    }
  })
}

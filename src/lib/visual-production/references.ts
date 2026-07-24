import type { PanelAssetBinding, PanelForVisualBindings, VisualAssetKind } from './bindings'
import {
  readSourceAnchorVisualAssetIds,
  resolvePanelVisualBindings,
} from './bindings'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'

export type VisualReferenceRole =
  | 'primary_identity'
  | 'supporting_identity'
  | 'environment'
  | 'prop_detail'
  | 'sketch'
  | 'style_only'
  | 'previous_frame'

export type VisualReferenceUsage = 'must_match' | 'adapt' | 'avoid_copy'

export interface VisualReference {
  assetId: string | null
  renderId: string | null
  assetKind: VisualAssetKind | 'sketch' | 'style' | 'panel'
  assetName: string
  url: string
  role: VisualReferenceRole
  usage: VisualReferenceUsage
  weight: number
  source: 'shot_spec' | 'legacy_panel' | 'source_anchor' | 'sketch' | 'style' | 'previous_frame'
}

interface CharacterAppearanceLike {
  id?: string
  appearanceIndex?: number
  changeReason: string | null
  imageUrls: string | null
  imageUrl: string | null
  selectedIndex: number | null
}

interface CharacterLike {
  id: string
  name: string
  appearances?: CharacterAppearanceLike[]
}

interface LocationImageLike {
  id?: string
  imageIndex?: number
  isSelected: boolean
  imageUrl: string | null
}

interface LocationLike {
  id: string
  name: string
  assetKind?: string | null
  images?: LocationImageLike[]
}

export interface PanelReferenceProjectData {
  characters?: CharacterLike[]
  locations?: LocationLike[]
}

export interface ResolvePanelVisualReferencesOptions {
  includeCharacterAssets?: boolean
  includeLocationAssets?: boolean
  includePropAssets?: boolean
  includeSourceAnchorAssets?: boolean
  maxReferences?: number
  signImageUrl?: (value: string | null | undefined) => string | null
}

function defaultSignImageUrl(value: string | null | undefined): string | null {
  return value || null
}

function parseImageUrls(value: string | null | undefined): string[] {
  return decodeImageUrlsFromDb(value, 'visualReference.imageUrls')
}

function aliases(name: string): string[] {
  return Array.from(new Set(
    name.toLowerCase()
      .split(/[\/|,，、：《》"“”'’‘\s]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  ))
}

function namesMatch(left: string, right: string): boolean {
  const a = left.toLowerCase().trim()
  const b = right.toLowerCase().trim()
  if (!a || !b) return false
  if (a === b) return true
  const leftAliases = aliases(left)
  const rightAliases = aliases(right)
  return leftAliases.some((item) => rightAliases.includes(item))
}

function findCharacter(projectData: PanelReferenceProjectData, binding: PanelAssetBinding): CharacterLike | null {
  return (projectData.characters || []).find((item) => item.id === binding.id)
    || (projectData.characters || []).find((item) => namesMatch(item.name, binding.name))
    || null
}

function findLocation(projectData: PanelReferenceProjectData, binding: PanelAssetBinding): LocationLike | null {
  const expectedProp = binding.kind === 'prop'
  return (projectData.locations || []).find((item) => item.id === binding.id)
    || (projectData.locations || []).find((item) => {
      const isProp = item.assetKind === 'prop'
      return isProp === expectedProp && namesMatch(item.name, binding.name)
    })
    || null
}

function selectedCharacterImage(character: CharacterLike): { url: string | null; renderId: string | null } {
  const appearance = character.appearances?.[0]
  if (!appearance) return { url: null, renderId: null }
  const imageUrls = parseImageUrls(appearance.imageUrls)
  const selectedUrl = appearance.selectedIndex !== null && appearance.selectedIndex !== undefined
    ? imageUrls[appearance.selectedIndex]
    : null
  return {
    url: selectedUrl || imageUrls[0] || appearance.imageUrl || null,
    renderId: appearance.id || null,
  }
}

function selectedLocationImage(location: LocationLike): { url: string | null; renderId: string | null } {
  const image = (location.images || []).find((item) => item.isSelected) || location.images?.[0] || null
  return {
    url: image?.imageUrl || null,
    renderId: image?.id || null,
  }
}

function usageForRole(role: VisualReferenceRole): VisualReferenceUsage {
  if (role === 'primary_identity' || role === 'supporting_identity' || role === 'prop_detail') return 'must_match'
  if (role === 'style_only') return 'avoid_copy'
  return 'adapt'
}

function pushReference(params: {
  refs: VisualReference[]
  seen: Set<string>
  signImageUrl: (value: string | null | undefined) => string | null
  url: string | null | undefined
  assetId: string | null
  renderId: string | null
  assetKind: VisualReference['assetKind']
  assetName: string
  role: VisualReferenceRole
  weight: number
  source: VisualReference['source']
}) {
  const signed = params.signImageUrl(params.url)
  if (!signed || params.seen.has(signed)) return
  params.seen.add(signed)
  params.refs.push({
    assetId: params.assetId,
    renderId: params.renderId,
    assetKind: params.assetKind,
    assetName: params.assetName,
    url: signed,
    role: params.role,
    usage: usageForRole(params.role),
    weight: params.weight,
    source: params.source,
  })
}

function roleFromBinding(binding: PanelAssetBinding): VisualReferenceRole {
  if (binding.role === 'primary_identity') return 'primary_identity'
  if (binding.role === 'supporting_identity') return 'supporting_identity'
  if (binding.role === 'environment') return 'environment'
  if (binding.role === 'prop_detail') return 'prop_detail'
  return 'style_only'
}

function maxReferenceCount(panel: PanelForVisualBindings, requested: number | undefined): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.max(0, Math.floor(requested))
  }
  if (panel.renderMode === 'text_card' || panel.visualType === 'quote_card' || panel.visualType === 'kinetic_text') return 1
  if (panel.visualType === 'book_cover' || panel.visualType === 'diagram') return 2
  return 3
}

function appendBindingReference(params: {
  binding: PanelAssetBinding
  projectData: PanelReferenceProjectData
  refs: VisualReference[]
  seen: Set<string>
  signImageUrl: (value: string | null | undefined) => string | null
}) {
  if (params.binding.kind === 'character') {
    const character = findCharacter(params.projectData, params.binding)
    const image = character ? selectedCharacterImage(character) : { url: null, renderId: null }
    pushReference({
      refs: params.refs,
      seen: params.seen,
      signImageUrl: params.signImageUrl,
      url: image.url,
      assetId: character?.id || params.binding.id,
      renderId: image.renderId,
      assetKind: 'character',
      assetName: character?.name || params.binding.name,
      role: roleFromBinding(params.binding),
      weight: params.binding.weight,
      source: params.binding.source,
    })
    return
  }
  const location = findLocation(params.projectData, params.binding)
  const image = location ? selectedLocationImage(location) : { url: null, renderId: null }
  const isProp = params.binding.kind === 'prop'
  pushReference({
    refs: params.refs,
    seen: params.seen,
    signImageUrl: params.signImageUrl,
    url: image.url,
    assetId: location?.id || params.binding.id,
    renderId: image.renderId,
    assetKind: isProp ? 'prop' : 'location',
    assetName: location?.name || params.binding.name,
    role: isProp ? roleFromBinding(params.binding) : 'environment',
    weight: params.binding.weight,
    source: params.binding.source,
  })
}

function appendSourceAnchorFallbackReferences(params: {
  projectData: PanelReferenceProjectData
  panel: PanelForVisualBindings
  refs: VisualReference[]
  seen: Set<string>
  signImageUrl: (value: string | null | undefined) => string | null
  options: ResolvePanelVisualReferencesOptions
}) {
  for (const assetId of readSourceAnchorVisualAssetIds(params.panel.sourceAnchor)) {
    const character = params.projectData.characters?.find((item) => item.id === assetId)
    if (character && params.options.includeCharacterAssets !== false) {
      const image = selectedCharacterImage(character)
      pushReference({
        refs: params.refs,
        seen: params.seen,
        signImageUrl: params.signImageUrl,
        url: image.url,
        assetId: character.id,
        renderId: image.renderId,
        assetKind: 'character',
        assetName: character.name,
        role: 'supporting_identity',
        weight: 0.55,
        source: 'source_anchor',
      })
      continue
    }
    const location = params.projectData.locations?.find((item) => item.id === assetId)
    if (!location) continue
    const isProp = location.assetKind === 'prop'
    if ((isProp && params.options.includePropAssets === false) || (!isProp && params.options.includeLocationAssets === false)) {
      continue
    }
    const image = selectedLocationImage(location)
    pushReference({
      refs: params.refs,
      seen: params.seen,
      signImageUrl: params.signImageUrl,
      url: image.url,
      assetId: location.id,
      renderId: image.renderId,
      assetKind: isProp ? 'prop' : 'location',
      assetName: location.name,
      role: isProp ? 'prop_detail' : 'environment',
      weight: 0.5,
      source: 'source_anchor',
    })
  }
}

export function resolvePanelVisualReferences(params: {
  projectData: PanelReferenceProjectData
  panel: PanelForVisualBindings & { sketchImageUrl?: string | null }
  options?: ResolvePanelVisualReferencesOptions
}): VisualReference[] {
  const options = params.options || {}
  const signImageUrl = options.signImageUrl || defaultSignImageUrl
  const refs: VisualReference[] = []
  const seen = new Set<string>()
  const bindings = resolvePanelVisualBindings(params.panel)

  pushReference({
    refs,
    seen,
    signImageUrl,
    url: params.panel.sketchImageUrl,
    assetId: null,
    renderId: null,
    assetKind: 'sketch',
    assetName: 'panel sketch',
    role: 'sketch',
    weight: 0.4,
    source: 'sketch',
  })

  for (const binding of bindings.visibleAssets) {
    if (binding.kind === 'character' && options.includeCharacterAssets === false) continue
    if (binding.kind === 'location' && options.includeLocationAssets === false) continue
    if (binding.kind === 'prop' && options.includePropAssets === false) continue
    appendBindingReference({
      binding,
      projectData: params.projectData,
      refs,
      seen,
      signImageUrl,
    })
  }

  if (bindings.visibleAssets.length === 0 && options.includeSourceAnchorAssets !== false) {
    appendSourceAnchorFallbackReferences({
      projectData: params.projectData,
      panel: params.panel,
      refs,
      seen,
      signImageUrl,
      options,
    })
  }

  const max = maxReferenceCount(params.panel, options.maxReferences)
  return refs
    .sort((left, right) => right.weight - left.weight)
    .slice(0, max)
}

export function visualReferencesToImageUrls(references: VisualReference[]): string[] {
  return references.map((item) => item.url)
}

export function visualReferencesForPrompt(references: VisualReference[]) {
  return references.map((item) => ({
    assetId: item.assetId,
    renderId: item.renderId,
    assetKind: item.assetKind,
    assetName: item.assetName,
    role: item.role,
    usage: item.usage,
    weight: item.weight,
    source: item.source,
  }))
}

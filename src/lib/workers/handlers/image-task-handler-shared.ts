import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import {
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
  withLabelBar,
} from '../utils'

export type AnyObj = Record<string, unknown>

interface CharacterAppearanceLike {
  appearanceIndex?: number
  changeReason: string | null
  description?: string | null
  descriptions?: string | null
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
  description?: string | null
  availableSlots?: string | null
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

interface NovelProjectData {
  videoRatio?: string | null
  characters?: CharacterLike[]
  locations?: LocationLike[]
}

interface PanelLike {
  sketchImageUrl?: string | null
  characters?: string | null
  location?: string | null
  props?: string | null
  sourceAnchor?: unknown
}

export interface PanelReferenceImageOptions {
  includeCharacterAssets?: boolean
  includeLocationAssets?: boolean
  includePropAssets?: boolean
  includeSourceAnchorAssets?: boolean
}

export interface PanelCharacterReference {
  name: string
  appearance?: string
  slot?: string
}

interface NovelDataDb {
  novelPromotionProject: {
    findUnique(args: Record<string, unknown>): Promise<NovelProjectData | null>
  }
}

export function parseJsonStringArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function parseImageUrls(value: string | null | undefined, fieldName: string): string[] {
  return decodeImageUrlsFromDb(value, fieldName)
}

export function clampCount(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

async function generateImageToStorage(params: {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  targetId: string
  keyPrefix: string
  options?: {
    referenceImages?: string[]
    aspectRatio?: string
    size?: string
  }
  label?: string
}) {
  const source = await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.modelId,
    prompt: params.prompt,
    options: params.options,
  })

  const uploadSource = params.label
    ? await withLabelBar(source, params.label)
    : source
  const cosKey = await uploadImageSourceToCos(uploadSource, params.keyPrefix, params.targetId)
  return cosKey
}

export async function generateCleanImageToStorage(params: {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  targetId: string
  keyPrefix: string
  options?: {
    referenceImages?: string[]
    aspectRatio?: string
    size?: string
  }
}) {
  return await generateImageToStorage(params)
}

export async function generateProjectLabeledImageToStorage(params: {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  label: string
  targetId: string
  keyPrefix: string
  options?: {
    referenceImages?: string[]
    aspectRatio?: string
    size?: string
  }
}) {
  return await generateImageToStorage(params)
}

export async function resolveNovelData(projectId: string) {
  const db = prisma as unknown as NovelDataDb
  const data = await db.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: { include: { appearances: { orderBy: { appearanceIndex: 'asc' } } } },
      locations: { include: { images: { orderBy: { imageIndex: 'asc' } } } },
    },
  })

  if (!data) {
    throw new Error(`NovelPromotionProject not found: ${projectId}`)
  }

  return data
}

export function parsePanelCharacterReferences(value: string | null | undefined): PanelCharacterReference[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return { name: item }
        if (!item || typeof item !== 'object') return null
        const candidate = item as { name?: unknown; appearance?: unknown; slot?: unknown }
        if (typeof candidate.name === 'string') {
          return {
            name: candidate.name,
            appearance: typeof candidate.appearance === 'string' ? candidate.appearance : undefined,
            slot: typeof candidate.slot === 'string' ? candidate.slot : undefined,
          }
        }
        return null
      })
      .filter(Boolean) as PanelCharacterReference[]
  } catch {
    return []
  }
}

/**
 * 按角色名查找角色（支持别名匹配）
 * 优先级：1. 精确全名匹配  2. 按 '/' 拆分后别名精确匹配
 * 例：引用名 "顾娘子" 可匹配角色 "顾娘子/顾盼之"
 */
export function findCharacterByName<T extends { name: string }>(characters: T[], referenceName: string): T | undefined {
  const refLower = referenceName.toLowerCase().trim()
  if (!refLower) return undefined

  // 优先级 1：精确全名匹配
  const exact = characters.find((c) => c.name.toLowerCase().trim() === refLower)
  if (exact) return exact

  // 优先级 2：别名匹配 — 按 '/' 拆分后任一别名精确匹配
  const refAliases = refLower.split('/').map((s) => s.trim()).filter(Boolean)
  for (const character of characters) {
    const charAliases = character.name.toLowerCase().split('/').map((s) => s.trim()).filter(Boolean)
    const hasOverlap = refAliases.some((refAlias) => charAliases.includes(refAlias))
    if (hasOverlap) return character
  }

  return undefined
}

function readVisualAssetIds(sourceAnchor: unknown): string[] {
  if (!sourceAnchor || typeof sourceAnchor !== 'object' || Array.isArray(sourceAnchor)) return []
  return parseJsonStringArray((sourceAnchor as { visualAssetIds?: unknown }).visualAssetIds)
}

function selectedCharacterImage(character: CharacterLike): string | null {
  const appearance = character.appearances?.[0]
  if (!appearance) return null
  const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
  const selectedUrl = appearance.selectedIndex !== null && appearance.selectedIndex !== undefined
    ? imageUrls[appearance.selectedIndex]
    : null
  return selectedUrl || imageUrls[0] || appearance.imageUrl || null
}

function selectedLocationImage(location: LocationLike): string | null {
  const images = location.images || []
  return (images.find((image) => image.isSelected) || images[0])?.imageUrl || null
}

export async function collectPanelReferenceImages(
  projectData: NovelProjectData,
  panel: PanelLike,
  options: PanelReferenceImageOptions = {},
) {
  const refs: string[] = []
  const seen = new Set<string>()
  const includeCharacterAssets = options.includeCharacterAssets !== false
  const includeLocationAssets = options.includeLocationAssets !== false
  const includePropAssets = options.includePropAssets !== false
  const includeSourceAnchorAssets = options.includeSourceAnchorAssets !== false
  const pushReference = (value: string | null | undefined) => {
    const signed = toSignedUrlIfCos(value, 3600)
    if (!signed || seen.has(signed)) return
    seen.add(signed)
    refs.push(signed)
  }

  pushReference(panel.sketchImageUrl)

  if (includeSourceAnchorAssets) {
    for (const assetId of readVisualAssetIds(panel.sourceAnchor)) {
      const character = projectData.characters?.find((item) => item.id === assetId)
      if (character && includeCharacterAssets) {
        pushReference(selectedCharacterImage(character))
        continue
      }
      const location = projectData.locations?.find((item) => item.id === assetId)
      if (!location) continue
      const isProp = location.assetKind === 'prop'
      if ((isProp && includePropAssets) || (!isProp && includeLocationAssets)) {
        pushReference(selectedLocationImage(location))
      }
    }
  }

  if (includeCharacterAssets) {
    const panelCharacters = parsePanelCharacterReferences(panel.characters)
    for (const item of panelCharacters) {
      const character = findCharacterByName(projectData.characters || [], item.name)
      if (!character) continue

      const appearances = character.appearances || []
      let appearance = appearances[0]
      if (item.appearance) {
        const matched = appearances.find((a) => (a.changeReason || '').toLowerCase() === item.appearance!.toLowerCase())
        if (matched) appearance = matched
      }

      if (!appearance) continue

      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl = selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      pushReference(selectedUrl || imageUrls[0] || appearance.imageUrl)
    }
  }

  if (includeLocationAssets && panel.location) {
    const location = (projectData.locations || []).find((item) => (
      item.assetKind !== 'prop' && item.name.toLowerCase() === panel.location!.toLowerCase()
    ))
    if (location) {
      pushReference(selectedLocationImage(location))
    }
  }

  if (includePropAssets) {
    for (const propName of parseJsonStringArray(panel.props)) {
      const prop = (projectData.locations || []).find((item) => (
        item.assetKind === 'prop' && item.name.toLowerCase() === propName.toLowerCase()
      ))
      if (prop) pushReference(selectedLocationImage(prop))
    }
  }

  return refs
}

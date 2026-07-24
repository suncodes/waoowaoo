import { prisma } from '@/lib/prisma'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'

export type VisualTargetResolutionCode = 'NOT_FOUND' | 'INVALID_PARAMS'

export class VisualTargetResolutionError extends Error {
  code: VisualTargetResolutionCode
  reason: string

  constructor(code: VisualTargetResolutionCode, message: string, reason: string = code) {
    super(message)
    this.name = 'VisualTargetResolutionError'
    this.code = code
    this.reason = reason
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    return toObject(JSON.parse(value) as unknown)
  } catch {
    return {}
  }
}

function readProfileStringList(profile: Record<string, unknown>, key: string): string[] {
  const value = profile[key]
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeString(item)).filter(Boolean)
}

function buildDefaultProjectAppearanceDescription(input: {
  name: string
  introduction: string | null
  profileData: string | null
  body: Record<string, unknown>
}) {
  const directDescription = normalizeString(input.body.description)
    || normalizeString(input.body.currentDescription)
    || normalizeString(input.body.customDescription)
  if (directDescription) return directDescription

  const profile = parseJsonRecord(input.profileData)
  const profileFields = [
    normalizeString(profile.gender),
    normalizeString(profile.age_range),
    normalizeString(profile.archetype),
    normalizeString(profile.era_period),
    normalizeString(profile.social_class),
    normalizeString(profile.occupation),
  ].filter(Boolean)
  const visualKeywords = readProfileStringList(profile, 'visual_keywords').slice(0, 6)
  const locks = [
    ...readProfileStringList(profile, 'identity_locks'),
    ...readProfileStringList(profile, 'silhouette_locks'),
    ...readProfileStringList(profile, 'costume_locks'),
    ...readProfileStringList(profile, 'color_locks'),
  ].slice(0, 8)
  const parts = [
    normalizeString(input.introduction),
    profileFields.join('，'),
    visualKeywords.length ? `视觉关键词：${visualKeywords.join('、')}` : '',
    locks.length ? `一致性约束：${locks.join('、')}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('，') : `${input.name}的角色设定`
}

function isRecoverableAppearanceId(input: {
  appearanceId: string
  characterId: string
}) {
  const appearanceId = input.appearanceId.trim()
  if (!appearanceId) return true
  const lower = appearanceId.toLowerCase()
  return lower === 'nan'
    || lower === 'null'
    || lower === 'undefined'
    || lower === input.characterId.trim().toLowerCase()
}

export async function resolveProjectCharacterAppearanceTarget(input: {
  projectId: string
  characterId: string
  appearanceId?: string | null
  appearanceIndex?: number | null
  body?: Record<string, unknown>
}): Promise<{
  assetId: string
  targetType: 'CharacterAppearance'
  targetId: string
  appearanceId: string
}> {
  const requestedCharacterId = input.characterId.trim()
  const requestedAppearanceId = normalizeString(input.appearanceId)

  if (!requestedCharacterId) {
    throw new VisualTargetResolutionError('INVALID_PARAMS', 'characterId is required', 'CHARACTER_ID_MISSING')
  }

  const characterById = await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: requestedCharacterId,
      novelPromotionProject: { projectId: input.projectId },
    },
    select: { id: true },
  })
  let characterId = characterById?.id || requestedCharacterId
  let appearanceId = requestedAppearanceId

  if (!characterById) {
    const appearanceAsTarget = await prisma.characterAppearance.findFirst({
      where: {
        id: requestedCharacterId,
        character: { novelPromotionProject: { projectId: input.projectId } },
      },
      select: { id: true, characterId: true },
    })
    if (!appearanceAsTarget) {
      throw new VisualTargetResolutionError('NOT_FOUND', 'Project character not found', 'CHARACTER_NOT_FOUND')
    }
    characterId = appearanceAsTarget.characterId
    appearanceId ||= appearanceAsTarget.id
  }

  const hasAppearanceId = appearanceId.length > 0
    && appearanceId.toLowerCase() !== 'nan'
    && appearanceId.toLowerCase() !== 'null'
    && appearanceId.toLowerCase() !== 'undefined'

  if (hasAppearanceId) {
    const appearance = await prisma.characterAppearance.findFirst({
      where: {
        id: appearanceId,
        characterId,
        character: { novelPromotionProject: { projectId: input.projectId } },
      },
      select: { id: true },
    })
    if (appearance) {
      return {
        assetId: characterId,
        targetType: 'CharacterAppearance',
        targetId: appearance.id,
        appearanceId: appearance.id,
      }
    }
    if (typeof input.appearanceIndex !== 'number' && !isRecoverableAppearanceId({ appearanceId, characterId })) {
      throw new VisualTargetResolutionError('NOT_FOUND', 'Character appearance not found for this character', 'APPEARANCE_NOT_FOUND')
    }
  }

  if (typeof input.appearanceIndex === 'number') {
    const appearance = await prisma.characterAppearance.findFirst({
      where: {
        characterId,
        appearanceIndex: input.appearanceIndex,
        character: { novelPromotionProject: { projectId: input.projectId } },
      },
      select: { id: true },
    })
    if (appearance) {
      return {
        assetId: characterId,
        targetType: 'CharacterAppearance',
        targetId: appearance.id,
        appearanceId: appearance.id,
      }
    }
    if (!isRecoverableAppearanceId({ appearanceId, characterId })) {
      throw new VisualTargetResolutionError('NOT_FOUND', 'Character appearance not found for this character', 'APPEARANCE_NOT_FOUND')
    }
  }

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: characterId,
      novelPromotionProject: { projectId: input.projectId },
    },
    select: {
      id: true,
      name: true,
      introduction: true,
      profileData: true,
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
        take: 1,
        select: { id: true },
      },
    },
  })
  if (!character) {
    throw new VisualTargetResolutionError('NOT_FOUND', 'Project character not found', 'CHARACTER_NOT_FOUND')
  }

  const existing = character.appearances[0]
  if (existing) {
    return {
      assetId: character.id,
      targetType: 'CharacterAppearance',
      targetId: existing.id,
      appearanceId: existing.id,
    }
  }

  const description = buildDefaultProjectAppearanceDescription({
    name: character.name,
    introduction: character.introduction,
    profileData: character.profileData,
    body: input.body || {},
  })
  const created = await prisma.characterAppearance.upsert({
    where: {
      characterId_appearanceIndex: {
        characterId: character.id,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      },
    },
    create: {
      characterId: character.id,
      appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      changeReason: '初始形象',
      description,
      descriptions: JSON.stringify([description]),
      imageUrls: encodeImageUrls([]),
      previousImageUrls: encodeImageUrls([]),
    },
    update: {},
    select: { id: true },
  })
  return {
    assetId: character.id,
    targetType: 'CharacterAppearance',
    targetId: created.id,
    appearanceId: created.id,
  }
}

export function isVisualTargetResolutionError(error: unknown): error is VisualTargetResolutionError {
  return error instanceof VisualTargetResolutionError
}

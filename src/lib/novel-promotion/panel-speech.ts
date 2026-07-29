import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPrismaErrorCode } from '@/lib/prisma-error'
import {
  hasAnyVoiceBinding,
  parseSpeakerVoiceMap,
  type SpeakerVoiceEntry,
} from '@/lib/voice/provider-voice-binding'

const DEFAULT_MIN_SPEECH_DURATION_MS = 1200
const DEFAULT_SPEECH_CHAR_DURATION_MS = 180

export type PanelSpeechStatus = 'draft' | 'ready' | 'invalid'
export type PanelSpeechMode = 'none' | 'voiceover' | 'single_speaker'

export interface PanelSpeechWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'blocking'
}

export interface PanelSpeechVoiceConfig {
  speaker: string
  hasVoice: boolean
  source: 'character' | 'speaker' | 'none'
  provider?: string
  voiceType?: string
  voiceId?: string
  previewAudioUrl?: string
}

export interface PanelSpeechContent {
  originalContent: string
  deliveryContent?: string | null
  estimatedDurationMs?: number | null
  targetDurationMs?: number | null
}

export interface PanelSpeechDraft {
  projectId: string
  episodeId: string
  clipId?: string | null
  panelId: string
  speaker: string
  originalContent: string
  deliveryContent?: string | null
  sourceAnchor?: unknown
  targetDurationMs?: number | null
  estimatedDurationMs?: number | null
  emotionPrompt?: string | null
  emotionStrength?: number | null
  voiceConfig?: PanelSpeechVoiceConfig | null
  warnings?: PanelSpeechWarning[]
  status?: PanelSpeechStatus
  source?: string
}

export interface PanelSpeechAssignment {
  panelId: string
  speaker: string
  content: string
  emotionPrompt?: string | null
  emotionStrength?: number | null
  sourceAnchor?: unknown
}

export type PanelSpeechReadinessCode =
  | 'READY'
  | 'NO_SPEECH'
  | 'PANEL_SPEECH_MISSING'
  | 'PANEL_SPEECH_NOT_READY'
  | 'PANEL_SPEECH_TABLE_MISSING'
  | 'LEGACY_SPEECH_REBUILD_REQUIRED'

type CharacterVoiceLike = {
  id: string
  name: string
  aliases?: string | null
  customVoiceUrl?: string | null
  voiceId?: string | null
  voiceType?: string | null
}

type LegacyVoiceLineRow = {
  id: string
  matchedPanelId: string | null
  speaker: string
  content: string
  emotionPrompt: string | null
  emotionStrength: number | null
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

function normalizeEmotionStrength(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0.1, value))
}

function parseAliasList(raw: string | null | undefined): string[] {
  const value = readTrimmedString(raw)
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
    }
  } catch {
    // 兼容历史逗号分隔别名。
  }
  return value.split(/[，、,;；|]/g).map((item) => item.trim()).filter(Boolean)
}

function matchCharacterBySpeaker(speaker: string, characters: CharacterVoiceLike[]): CharacterVoiceLike | null {
  const normalized = speaker.trim()
  if (!normalized) return null

  const exact = characters.find((character) => character.name === normalized)
  if (exact) return exact

  const aliasMatch = characters.find((character) => parseAliasList(character.aliases).includes(normalized))
  if (aliasMatch) return aliasMatch

  return characters.find((character) => character.name.includes(normalized) || normalized.includes(character.name)) || null
}

function voicePreviewUrl(entry: SpeakerVoiceEntry | undefined): string | undefined {
  if (!entry) return undefined
  if (entry.provider === 'fal') return entry.audioUrl
  return entry.previewAudioUrl
}

export function isNarratorSpeaker(speaker: string): boolean {
  return /旁白|叙述|解说|导读|narrator|voiceover/i.test(speaker)
}

export function estimatePanelSpeechDurationMs(content: string | null | undefined): number {
  const compactLength = typeof content === 'string'
    ? content.replace(/\s+/g, '').length
    : 0
  return Math.max(DEFAULT_MIN_SPEECH_DURATION_MS, Math.round(compactLength * DEFAULT_SPEECH_CHAR_DURATION_MS))
}

export function resolvePanelSpeechText(speech: PanelSpeechContent | null | undefined): string {
  if (!speech) return ''
  return readTrimmedString(speech.deliveryContent) || readTrimmedString(speech.originalContent)
}

export function resolvePanelSpeechDurationMs(speech: PanelSpeechContent | null | undefined): number {
  if (!speech) return 0
  const content = resolvePanelSpeechText(speech)
  if (!content) return 0
  return readPositiveNumber(speech.estimatedDurationMs) || estimatePanelSpeechDurationMs(content)
}

export function panelSpeechHasContent(speech: PanelSpeechContent | null | undefined): boolean {
  return !!resolvePanelSpeechText(speech)
}

export function resolvePanelSpeechMode(speech: { speaker?: string | null } | null | undefined): PanelSpeechMode {
  if (!speech) return 'none'
  return isNarratorSpeaker(readTrimmedString(speech.speaker)) ? 'voiceover' : 'single_speaker'
}

export function isPanelSpeechTableMissing(error: unknown): boolean {
  if (getPrismaErrorCode(error) === 'P2021') return true
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('novel_promotion_panel_speeches')
    && message.toLowerCase().includes('does not exist')
}

export function buildPanelSpeechVoiceConfig(params: {
  speaker: string
  characters: CharacterVoiceLike[]
  speakerVoices: Record<string, SpeakerVoiceEntry>
}): PanelSpeechVoiceConfig {
  const character = matchCharacterBySpeaker(params.speaker, params.characters)
  const speakerVoice = params.speakerVoices[params.speaker]
  const hasVoice = hasAnyVoiceBinding({ character, speakerVoice })

  if (character?.customVoiceUrl || character?.voiceId) {
    return {
      speaker: params.speaker,
      hasVoice,
      source: 'character',
      provider: character.voiceId ? 'bailian' : 'fal',
      voiceType: character.voiceType || undefined,
      voiceId: character.voiceId || undefined,
      previewAudioUrl: character.customVoiceUrl || undefined,
    }
  }

  if (speakerVoice) {
    return {
      speaker: params.speaker,
      hasVoice,
      source: 'speaker',
      provider: speakerVoice.provider,
      voiceType: speakerVoice.voiceType,
      voiceId: speakerVoice.provider === 'bailian' ? speakerVoice.voiceId : undefined,
      previewAudioUrl: voicePreviewUrl(speakerVoice),
    }
  }

  return {
    speaker: params.speaker,
    hasVoice,
    source: 'none',
  }
}

export function readPanelSpeechVoiceConfig(value: unknown): PanelSpeechVoiceConfig | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const speaker = readTrimmedString(record.speaker)
  if (!speaker) return null
  return {
    speaker,
    hasVoice: record.hasVoice === true,
    source: record.source === 'character' || record.source === 'speaker' ? record.source : 'none',
    provider: readTrimmedString(record.provider) || undefined,
    voiceType: readTrimmedString(record.voiceType) || undefined,
    voiceId: readTrimmedString(record.voiceId) || undefined,
    previewAudioUrl: readTrimmedString(record.previewAudioUrl) || undefined,
  }
}

export function readPanelSpeechWarnings(value: unknown): PanelSpeechWarning[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const code = readTrimmedString(record.code)
    const message = readTrimmedString(record.message)
    const severity = record.severity === 'info' || record.severity === 'warning' || record.severity === 'blocking'
      ? record.severity
      : 'warning'
    return code && message ? [{ code, message, severity }] : []
  })
}

export function buildPanelSpeechCreateData(draft: PanelSpeechDraft): Prisma.NovelPromotionPanelSpeechUncheckedCreateInput {
  const speaker = readTrimmedString(draft.speaker)
  const originalContent = readTrimmedString(draft.originalContent)
  if (!speaker || !originalContent) {
    throw new Error('PANEL_SPEECH_INVALID: speaker and originalContent are required')
  }

  const deliveryContent = readTrimmedString(draft.deliveryContent) || null
  const effectiveContent = deliveryContent || originalContent
  const targetDurationMs = readPositiveNumber(draft.targetDurationMs)
  const estimatedDurationMs = readPositiveNumber(draft.estimatedDurationMs)
    || estimatePanelSpeechDurationMs(effectiveContent)
  const emotionStrength = normalizeEmotionStrength(draft.emotionStrength)
  const warnings = Array.isArray(draft.warnings) ? draft.warnings : []
  const voiceConfig = draft.voiceConfig || null

  return {
    projectId: draft.projectId,
    episodeId: draft.episodeId,
    clipId: draft.clipId || null,
    panelId: draft.panelId,
    speaker,
    originalContent,
    deliveryContent,
    ...(draft.sourceAnchor !== undefined ? { sourceAnchor: asInputJson(draft.sourceAnchor) } : {}),
    targetDurationMs,
    estimatedDurationMs,
    emotionPrompt: readTrimmedString(draft.emotionPrompt) || null,
    emotionStrength,
    ...(voiceConfig ? { voiceConfigJson: asInputJson(voiceConfig) } : {}),
    ...(warnings.length > 0 ? { warningsJson: asInputJson(warnings) } : {}),
    status: draft.status || 'ready',
    source: readTrimmedString(draft.source) || 'system',
  }
}

export function compilePanelSpeechPromptSection(params: {
  speech: {
    speaker: string
    originalContent: string
    deliveryContent?: string | null
    status?: string | null
    voiceConfigJson?: unknown
  } | null
  locale?: 'zh' | 'en'
}): string {
  const speech = params.speech
  const content = resolvePanelSpeechText(speech)
  if (!speech || !content) return ''
  const locale = params.locale || 'zh'
  const voice = readPanelSpeechVoiceConfig(speech.voiceConfigJson)
  const voiceText = !voice?.hasVoice
    ? (locale === 'en' ? 'voice not configured' : '未配置音色')
    : locale === 'en'
      ? `use configured ${voice.source} voice${voice.voiceType ? ` (${voice.voiceType})` : ''}`
      : `使用已配置${voice.source === 'character' ? '角色' : '发言人'}音色${voice.voiceType ? `（${voice.voiceType}）` : ''}`
  const deliveryLabel = readTrimmedString(speech.deliveryContent)
    ? (locale === 'en' ? 'Delivery line' : '口播版台词')
    : (locale === 'en' ? 'Spoken line' : '原始台词')

  if (locale === 'en') {
    return [
      'Native audio and speech plan:',
      `This shot contains exactly one spoken line. ${deliveryLabel}: ${speech.speaker}: ${content}`,
      `Voice: ${voiceText}.`,
      'Keep speech synchronized with this shot. Do not add subtitles, captions, watermarks, or extra on-screen text.',
      'Do not invent another speaker or additional dialogue.',
    ].join('\n')
  }

  return [
    '原生音频与台词计划：',
    `本镜头只有一条可播台词。${deliveryLabel}：${speech.speaker}：${content}`,
    `音色：${voiceText}。`,
    '声音要贴合本镜头节奏，不要生成字幕、说明文字、水印或额外屏幕文字。',
    '不得增加其他说话人或额外台词。',
  ].join('\n')
}

export async function loadPanelSpeech(panelId: string) {
  try {
    return await prisma.novelPromotionPanelSpeech.findUnique({ where: { panelId } })
  } catch (error) {
    if (isPanelSpeechTableMissing(error)) return null
    throw error
  }
}

export async function listEpisodePanelSpeeches(episodeId: string) {
  try {
    const speeches = await prisma.novelPromotionPanelSpeech.findMany({
      where: { episodeId },
      orderBy: { createdAt: 'asc' },
    })
    return { available: true, speeches }
  } catch (error) {
    if (isPanelSpeechTableMissing(error)) return { available: false, speeches: [] }
    throw error
  }
}

export async function getPanelSpeechState(panelId: string) {
  try {
    const panel = await prisma.novelPromotionPanel.findUnique({
      where: { id: panelId },
      select: {
        id: true,
        panelSpeech: true,
        matchedVoiceLines: {
          select: { id: true },
        },
      },
    })
    if (!panel) throw new Error('PANEL_SPEECH_PANEL_NOT_FOUND')
    return {
      available: true,
      speech: panel.panelSpeech,
      legacyVoiceLineCount: Array.isArray(panel.matchedVoiceLines) ? panel.matchedVoiceLines.length : 0,
    }
  } catch (error) {
    if (isPanelSpeechTableMissing(error)) {
      return { available: false, speech: null, legacyVoiceLineCount: 0 }
    }
    throw error
  }
}

export async function validatePanelSpeechReadyForVideo(panelId: string) {
  const state = await getPanelSpeechState(panelId)
  if (!state.available) {
    return {
      ready: false,
      available: false,
      speech: null,
      reasons: ['当前数据库缺少镜头级可播台词表；请执行数据库迁移后重新生成分镜文稿与台词计划。'],
      code: 'PANEL_SPEECH_TABLE_MISSING' as PanelSpeechReadinessCode,
      voiceLineCount: state.legacyVoiceLineCount,
    }
  }
  if (!state.speech) {
    if (state.legacyVoiceLineCount > 0) {
      return {
        ready: false,
        available: true,
        speech: null,
        reasons: ['当前项目仍是旧的多台词绑定数据，无法安全转换为一镜一条可播台词；请重新生成分镜文稿与台词计划。'],
        code: 'LEGACY_SPEECH_REBUILD_REQUIRED' as PanelSpeechReadinessCode,
        voiceLineCount: state.legacyVoiceLineCount,
      }
    }
    return {
      ready: true,
      available: true,
      speech: null,
      reasons: ['当前镜头没有台词，将按无旁白视频生成。'],
      code: 'NO_SPEECH' as PanelSpeechReadinessCode,
      voiceLineCount: 0,
    }
  }
  if (state.speech.status !== 'ready' || !panelSpeechHasContent(state.speech)) {
    const warnings = readPanelSpeechWarnings(state.speech.warningsJson)
    return {
      ready: false,
      available: true,
      speech: state.speech,
      reasons: warnings.map((warning) => warning.message).length > 0
        ? warnings.map((warning) => warning.message)
        : ['镜头级可播台词未就绪。'],
      code: 'PANEL_SPEECH_NOT_READY' as PanelSpeechReadinessCode,
      voiceLineCount: 1,
    }
  }
  return {
    ready: true,
    available: true,
    speech: state.speech,
    reasons: [] as string[],
    code: 'READY' as PanelSpeechReadinessCode,
    voiceLineCount: 1,
  }
}

export async function refreshEpisodePanelSpeechVoiceConfigs(episodeId: string) {
  try {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      select: {
        speakerVoices: true,
        novelPromotionProject: {
          select: {
            characters: {
              select: {
                id: true,
                name: true,
                aliases: true,
                customVoiceUrl: true,
                voiceId: true,
                voiceType: true,
              },
            },
          },
        },
        panelSpeeches: {
          select: { id: true, speaker: true },
        },
      },
    })
    if (!episode) throw new Error('PANEL_SPEECH_EPISODE_NOT_FOUND')

    const speakerVoices = parseSpeakerVoiceMap(episode.speakerVoices)
    await prisma.$transaction(async (tx) => {
      for (const speech of episode.panelSpeeches) {
        const voiceConfig = buildPanelSpeechVoiceConfig({
          speaker: speech.speaker,
          characters: episode.novelPromotionProject.characters,
          speakerVoices,
        })
        await tx.novelPromotionPanelSpeech.update({
          where: { id: speech.id },
          data: { voiceConfigJson: asInputJson(voiceConfig) },
        })
      }
    })
    return { available: true, count: episode.panelSpeeches.length }
  } catch (error) {
    if (isPanelSpeechTableMissing(error)) return { available: false, count: 0 }
    throw error
  }
}

/**
 * 用完整的镜头分配结果替换剧集台词。调用方必须先确保每条台词已绑定到唯一镜头。
 */
export async function replaceEpisodePanelSpeeches(params: {
  episodeId: string
  assignments: PanelSpeechAssignment[]
  source: string
}) {
  try {
    const seenPanelIds = new Set<string>()
    for (const assignment of params.assignments) {
      if (!assignment.panelId || seenPanelIds.has(assignment.panelId)) {
        throw new Error(`PANEL_SPEECH_INVALID: multiple spoken lines assigned to panel ${assignment.panelId || 'unknown'}`)
      }
      seenPanelIds.add(assignment.panelId)
      if (!readTrimmedString(assignment.speaker) || !readTrimmedString(assignment.content)) {
        throw new Error(`PANEL_SPEECH_INVALID: panel ${assignment.panelId} has incomplete speech`)
      }
    }

    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: params.episodeId },
      select: {
        id: true,
        speakerVoices: true,
        novelPromotionProject: {
          select: {
            projectId: true,
            characters: {
              select: {
                id: true,
                name: true,
                aliases: true,
                customVoiceUrl: true,
                voiceId: true,
                voiceType: true,
              },
            },
          },
        },
        storyboards: {
          select: {
            clipId: true,
            panels: {
              select: {
                id: true,
                targetDurationMs: true,
              },
            },
          },
        },
      },
    })
    if (!episode) throw new Error('PANEL_SPEECH_EPISODE_NOT_FOUND')

    const panelById = new Map<string, { clipId: string; targetDurationMs: number | null }>()
    for (const storyboard of episode.storyboards) {
      for (const panel of storyboard.panels) {
        panelById.set(panel.id, {
          clipId: storyboard.clipId,
          targetDurationMs: panel.targetDurationMs,
        })
      }
    }
    for (const assignment of params.assignments) {
      if (!panelById.has(assignment.panelId)) {
        throw new Error(`PANEL_SPEECH_INVALID: panel ${assignment.panelId} does not belong to episode`)
      }
    }

    const speakerVoices = parseSpeakerVoiceMap(episode.speakerVoices)
    await prisma.$transaction(async (tx) => {
      await tx.novelPromotionPanelSpeech.deleteMany({
        where: { episodeId: params.episodeId },
      })
      for (const assignment of params.assignments) {
        const panel = panelById.get(assignment.panelId)!
        const voiceConfig = buildPanelSpeechVoiceConfig({
          speaker: assignment.speaker,
          characters: episode.novelPromotionProject.characters,
          speakerVoices,
        })
        await tx.novelPromotionPanelSpeech.create({
          data: buildPanelSpeechCreateData({
            projectId: episode.novelPromotionProject.projectId,
            episodeId: params.episodeId,
            clipId: panel.clipId,
            panelId: assignment.panelId,
            speaker: assignment.speaker,
            originalContent: assignment.content,
            sourceAnchor: assignment.sourceAnchor,
            targetDurationMs: panel.targetDurationMs,
            emotionPrompt: assignment.emotionPrompt,
            emotionStrength: assignment.emotionStrength,
            voiceConfig,
            source: params.source,
          }),
        })
      }
    }, { timeout: 30000 })

    const projection = await syncEpisodeLegacyVoiceLineProjection(params.episodeId)
    return {
      available: true,
      count: params.assignments.length,
      voiceLineByPanelId: projection.voiceLineByPanelId,
    }
  } catch (error) {
    if (isPanelSpeechTableMissing(error)) {
      return { available: false, count: 0, voiceLineByPanelId: new Map<string, string>() }
    }
    throw error
  }
}

function sortStoryboards<T extends {
  createdAt: Date
  clip: { start: number | null; createdAt: Date }
}>(storyboards: T[]): T[] {
  return [...storyboards].sort((left, right) => (
    (left.clip.start ?? Number.MAX_SAFE_INTEGER) - (right.clip.start ?? Number.MAX_SAFE_INTEGER)
    || left.clip.createdAt.getTime() - right.clip.createdAt.getTime()
    || left.createdAt.getTime() - right.createdAt.getTime()
  ))
}

/**
 * 兼容旧的配音、任务和界面读取接口。旧 VoiceLine 只是一镜一条的投影，不能反向决定台词内容。
 */
export async function syncEpisodeLegacyVoiceLineProjection(episodeId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const episode = await tx.novelPromotionEpisode.findUnique({
        where: { id: episodeId },
        select: {
          storyboards: {
            select: {
              id: true,
              createdAt: true,
              clip: { select: { start: true, createdAt: true } },
              panels: {
                orderBy: { panelIndex: 'asc' },
                select: {
                  id: true,
                  panelIndex: true,
                  panelSpeech: {
                    select: {
                      speaker: true,
                      originalContent: true,
                      emotionPrompt: true,
                      emotionStrength: true,
                      estimatedDurationMs: true,
                    },
                  },
                },
              },
            },
          },
          voiceLines: {
            orderBy: { lineIndex: 'asc' },
            select: {
              id: true,
              matchedPanelId: true,
              speaker: true,
              content: true,
              emotionPrompt: true,
              emotionStrength: true,
            },
          },
        },
      })
      if (!episode) throw new Error('PANEL_SPEECH_EPISODE_NOT_FOUND')

      const existingByPanel = new Map<string, LegacyVoiceLineRow[]>()
      for (const voiceLine of episode.voiceLines) {
        if (!voiceLine.matchedPanelId) continue
        const rows = existingByPanel.get(voiceLine.matchedPanelId) || []
        rows.push(voiceLine)
        existingByPanel.set(voiceLine.matchedPanelId, rows)
      }

      const retainedVoiceLineIds: string[] = []
      const voiceLineByPanelId = new Map<string, string>()
      let lineIndex = 1
      for (const storyboard of sortStoryboards(episode.storyboards)) {
        for (const panel of storyboard.panels) {
          const speech = panel.panelSpeech
          if (!speech) continue
          const existing = existingByPanel.get(panel.id)?.shift()
          const data = {
            lineIndex,
            speaker: speech.speaker,
            content: speech.originalContent,
            emotionPrompt: speech.emotionPrompt,
            emotionStrength: speech.emotionStrength,
            estimatedDurationMs: speech.estimatedDurationMs,
            matchedPanelId: panel.id,
            matchedStoryboardId: storyboard.id,
            matchedPanelIndex: panel.panelIndex,
          }
          const contentChanged = existing && (
            existing.speaker !== data.speaker
            || existing.content !== data.content
            || existing.emotionPrompt !== data.emotionPrompt
            || existing.emotionStrength !== data.emotionStrength
          )
          const voiceLine = existing
            ? await tx.novelPromotionVoiceLine.update({
              where: { id: existing.id },
              data: {
                ...data,
                ...(contentChanged ? {
                  audioUrl: null,
                  audioMediaId: null,
                  audioDuration: null,
                } : {}),
              },
              select: { id: true },
            })
            : await tx.novelPromotionVoiceLine.create({
              data: { episodeId, ...data },
              select: { id: true },
            })
          retainedVoiceLineIds.push(voiceLine.id)
          voiceLineByPanelId.set(panel.id, voiceLine.id)
          lineIndex += 1
        }
      }

      await tx.novelPromotionVoiceLine.deleteMany({
        where: {
          episodeId,
          ...(retainedVoiceLineIds.length > 0 ? { id: { notIn: retainedVoiceLineIds } } : {}),
        },
      })

      return {
        available: true,
        count: retainedVoiceLineIds.length,
        voiceLineByPanelId,
      }
    }, { timeout: 30000 })
  } catch (error) {
    if (isPanelSpeechTableMissing(error)) {
      return { available: false, count: 0, voiceLineByPanelId: new Map<string, string>() }
    }
    throw error
  }
}

export interface CreatePanelSpeechInput {
  episodeId: string
  panelId: string
  speaker: string
  originalContent: string
  emotionPrompt?: string | null
  emotionStrength?: number | null
  source?: string
}

export interface UpdatePanelSpeechInput {
  episodeId: string
  speechId: string
  panelId?: string | null
  speaker?: string
  originalContent?: string
  emotionPrompt?: string | null
  emotionStrength?: number | null
  source?: string
}

type PanelSpeechWriteContext = {
  projectId: string
  speakerVoices: string | null
  characters: CharacterVoiceLike[]
  panel: {
    id: string
    targetDurationMs: number | null
    storyboard: {
      episodeId: string
      clipId: string
    }
  }
}

function ensurePanelSpeechText(value: string | null | undefined, field: string): string {
  const text = readTrimmedString(value)
  if (!text) throw new Error(`PANEL_SPEECH_INVALID: ${field} is required`)
  return text
}

async function loadPanelSpeechWriteContext(episodeId: string, panelId: string): Promise<PanelSpeechWriteContext> {
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      targetDurationMs: true,
      storyboard: {
        select: {
          episodeId: true,
          clipId: true,
        },
      },
    },
  })
  if (!panel || panel.storyboard.episodeId !== episodeId) {
    throw new Error('PANEL_SPEECH_PANEL_NOT_FOUND')
  }

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      speakerVoices: true,
      novelPromotionProject: {
        select: {
          projectId: true,
          characters: {
            select: {
              id: true,
              name: true,
              aliases: true,
              customVoiceUrl: true,
              voiceId: true,
              voiceType: true,
            },
          },
        },
      },
    },
  })
  if (!episode) throw new Error('PANEL_SPEECH_EPISODE_NOT_FOUND')

  return {
    projectId: episode.novelPromotionProject.projectId,
    speakerVoices: episode.speakerVoices,
    characters: episode.novelPromotionProject.characters,
    panel,
  }
}

function buildPanelSpeechUpdateData(params: {
  context: PanelSpeechWriteContext
  panelId: string
  speaker: string
  originalContent: string
  existing: {
    deliveryContent: string | null
    sourceAnchor: unknown
    emotionPrompt: string | null
    emotionStrength: number | null
    warningsJson: unknown
    source: string
  } | null
  emotionPrompt?: string | null
  emotionStrength?: number | null
  source?: string
  clearDeliveryContent?: boolean
}): Prisma.NovelPromotionPanelSpeechUncheckedCreateInput {
  const speakerVoices = parseSpeakerVoiceMap(params.context.speakerVoices)
  const voiceConfig = buildPanelSpeechVoiceConfig({
    speaker: params.speaker,
    characters: params.context.characters,
    speakerVoices,
  })
  const deliveryContent = params.clearDeliveryContent ? null : params.existing?.deliveryContent || null
  const estimatedDurationMs = estimatePanelSpeechDurationMs(deliveryContent || params.originalContent)
  return {
    projectId: params.context.projectId,
    episodeId: params.context.panel.storyboard.episodeId,
    clipId: params.context.panel.storyboard.clipId,
    panelId: params.panelId,
    speaker: params.speaker,
    originalContent: params.originalContent,
    deliveryContent,
    targetDurationMs: params.context.panel.targetDurationMs,
    estimatedDurationMs,
    emotionPrompt: params.emotionPrompt === undefined
      ? params.existing?.emotionPrompt || null
      : readTrimmedString(params.emotionPrompt) || null,
    emotionStrength: params.emotionStrength === undefined
      ? normalizeEmotionStrength(params.existing?.emotionStrength) || null
      : normalizeEmotionStrength(params.emotionStrength),
    voiceConfigJson: asInputJson(voiceConfig),
    warningsJson: asInputJson(readPanelSpeechWarnings(params.existing?.warningsJson)),
    status: 'ready',
    source: readTrimmedString(params.source) || params.existing?.source || 'manual',
  }
}

export async function createPanelSpeech(input: CreatePanelSpeechInput) {
  const speaker = ensurePanelSpeechText(input.speaker, 'speaker')
  const originalContent = ensurePanelSpeechText(input.originalContent, 'originalContent')
  const context = await loadPanelSpeechWriteContext(input.episodeId, input.panelId)

  const existing = await loadPanelSpeech(input.panelId)
  if (existing) {
    throw new Error(`PANEL_SPEECH_CONFLICT: panel ${input.panelId} already has a spoken line`)
  }

  const data = buildPanelSpeechUpdateData({
    context,
    panelId: input.panelId,
    speaker,
    originalContent,
    existing: null,
    emotionPrompt: input.emotionPrompt,
    emotionStrength: input.emotionStrength,
    source: input.source,
    clearDeliveryContent: false,
  })
  const speech = await prisma.novelPromotionPanelSpeech.create({ data })
  const projection = await syncEpisodeLegacyVoiceLineProjection(input.episodeId)
  return { speech, projection }
}

export async function updatePanelSpeech(input: UpdatePanelSpeechInput) {
  const existing = await prisma.novelPromotionPanelSpeech.findFirst({
    where: {
      id: input.speechId,
      episodeId: input.episodeId,
    },
    select: {
      id: true,
      panelId: true,
      speaker: true,
      originalContent: true,
      deliveryContent: true,
      sourceAnchor: true,
      emotionPrompt: true,
      emotionStrength: true,
      warningsJson: true,
      source: true,
    },
  })
  if (!existing) throw new Error('PANEL_SPEECH_NOT_FOUND')

  const targetPanelId = input.panelId === undefined ? existing.panelId : input.panelId
  const panelId = ensurePanelSpeechText(targetPanelId, 'panelId')
  const context = await loadPanelSpeechWriteContext(input.episodeId, panelId)
  if (panelId !== existing.panelId) {
    const occupied = await loadPanelSpeech(panelId)
    if (occupied) {
      throw new Error(`PANEL_SPEECH_CONFLICT: panel ${panelId} already has a spoken line`)
    }
  }

  const speaker = input.speaker === undefined
    ? existing.speaker
    : ensurePanelSpeechText(input.speaker, 'speaker')
  const originalContent = input.originalContent === undefined
    ? existing.originalContent
    : ensurePanelSpeechText(input.originalContent, 'originalContent')
  const data = buildPanelSpeechUpdateData({
    context,
    panelId,
    speaker,
    originalContent,
    existing,
    emotionPrompt: input.emotionPrompt,
    emotionStrength: input.emotionStrength,
    source: input.source,
    clearDeliveryContent: panelId !== existing.panelId || originalContent !== existing.originalContent,
  })
  const speech = await prisma.novelPromotionPanelSpeech.update({
    where: { id: existing.id },
    data,
  })
  const projection = await syncEpisodeLegacyVoiceLineProjection(input.episodeId)
  return { speech, projection }
}

export async function deletePanelSpeech(params: { episodeId: string; speechId: string }) {
  const speech = await prisma.novelPromotionPanelSpeech.findFirst({
    where: {
      id: params.speechId,
      episodeId: params.episodeId,
    },
    select: { id: true },
  })
  if (!speech) throw new Error('PANEL_SPEECH_NOT_FOUND')
  await prisma.novelPromotionPanelSpeech.delete({ where: { id: speech.id } })
  const projection = await syncEpisodeLegacyVoiceLineProjection(params.episodeId)
  return { projection }
}

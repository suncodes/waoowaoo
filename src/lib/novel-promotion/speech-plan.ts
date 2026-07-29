import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { getPrismaErrorCode } from '@/lib/prisma-error'
import { estimateNarrationDurationMs } from './narration-timeline'
import { hasAnyVoiceBinding, type SpeakerVoiceEntry } from '@/lib/voice/provider-voice-binding'
import {
  isPanelSpeechTableMissing,
  readPanelSpeechVoiceConfig as readCanonicalPanelSpeechVoiceConfig,
  readPanelSpeechWarnings,
} from './panel-speech'

export type PanelSpeechMode = 'none' | 'voiceover' | 'single_speaker' | 'sequential_dialogue' | 'unsupported'
export type PanelSpeechStatus = 'draft' | 'ready' | 'invalid'

export interface PanelSpeechLine {
  voiceLineId: string
  voiceLineIds?: string[]
  lineIndex: number
  speaker: string
  content: string
  order: number
  estimatedDurationMs: number
  deliveryContent?: string | null
  deliveryDurationMs?: number | null
  deliverySource?: string | null
  deliveryReason?: string | null
  deliveryUpdatedAt?: string | null
  emotionPrompt?: string | null
  emotionStrength?: number | null
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

export interface PanelSpeechWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'blocking'
}

export interface PanelSpeechTiming {
  panelDurationMs: number | null
  targetDurationMs: number | null
  estimatedSpeechDurationMs: number
}

export interface PanelSpeechPlanPayload {
  mode: PanelSpeechMode
  status: PanelSpeechStatus
  lines: PanelSpeechLine[]
  voiceConfig: PanelSpeechVoiceConfig[]
  timing: PanelSpeechTiming
  warnings: PanelSpeechWarning[]
}

export interface PanelSpeechPlanSummary {
  total: number
  ready: number
  invalid: number
  withSpeech: number
  silent: number
  missingVoiceSpeakers: string[]
  warningCount: number
}

export type PanelSpeechReadinessCode =
  | 'READY'
  | 'NO_SPEECH'
  | 'SPEECH_PLAN_MISSING'
  | 'SPEECH_PLAN_EMPTY'
  | 'SPEECH_PLAN_NOT_READY'

type CharacterVoiceLike = {
  id: string
  name: string
  aliases?: string | null
  customVoiceUrl?: string | null
  voiceId?: string | null
  voiceType?: string | null
}

type VoiceLineLike = {
  id: string
  lineIndex: number
  speaker: string
  content: string
  emotionPrompt?: string | null
  emotionStrength?: number | null
  estimatedDurationMs?: number | null
}

type PanelLike = {
  id: string
  duration?: number | null
  targetDurationMs?: number | null
}

export function isPanelSpeechPlanTableMissing(error: unknown) {
  const code = getPrismaErrorCode(error)
  if (code === 'P2021') return true
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('novel_promotion_panel_speech_plans')
    && message.toLowerCase().includes('does not exist')
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isStoryboardSpeechPlanSource(value: string | null | undefined): boolean {
  return readTrimmedString(value) === 'storyboard'
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
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

function buildVoiceConfig(params: {
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

function isNarratorSpeaker(speaker: string): boolean {
  return /旁白|叙述|解说|导读|narrator|voiceover/i.test(speaker)
}

function resolvePanelDurationMs(panel: PanelLike): number | null {
  if (typeof panel.targetDurationMs === 'number' && Number.isFinite(panel.targetDurationMs) && panel.targetDurationMs > 0) {
    return Math.round(panel.targetDurationMs)
  }
  if (typeof panel.duration === 'number' && Number.isFinite(panel.duration) && panel.duration > 0) {
    return Math.round(panel.duration > 1000 ? panel.duration : panel.duration * 1000)
  }
  return null
}

function uniqueSpeakers(lines: PanelSpeechLine[]): string[] {
  return Array.from(new Set(lines.map((line) => line.speaker).filter(Boolean)))
}

export function resolvePanelSpeechLineText(line: Pick<PanelSpeechLine, 'content' | 'deliveryContent'>): string {
  const deliveryContent = readTrimmedString(line.deliveryContent)
  return deliveryContent || line.content.trim()
}

export function resolvePanelSpeechLineDurationMs(
  line: Pick<PanelSpeechLine, 'content' | 'estimatedDurationMs' | 'deliveryContent' | 'deliveryDurationMs'>,
): number {
  const deliveryContent = readTrimmedString(line.deliveryContent)
  if (deliveryContent) {
    const deliveryDurationMs = readPositiveNumber(line.deliveryDurationMs)
    return deliveryDurationMs || estimateNarrationDurationMs(deliveryContent)
  }
  return readPositiveNumber(line.estimatedDurationMs) || estimateNarrationDurationMs(line.content)
}

function joinSpeechContent(current: string, next: string): string {
  if (!current) return next
  if (/[。！？!?…]$/.test(current)) return `${current}${next}`
  return `${current}，${next}`
}

function normalizeVoiceLineIds(line: PanelSpeechLine): string[] {
  const ids = Array.isArray(line.voiceLineIds)
    ? line.voiceLineIds.map(readTrimmedString).filter(Boolean)
    : []
  if (ids.length > 0) return Array.from(new Set(ids))
  return [line.voiceLineId]
}

function deliveryDurationMs(line: PanelSpeechLine, content: string): number {
  return readPositiveNumber(line.deliveryDurationMs) || estimateNarrationDurationMs(content)
}

export function mergeConsecutivePanelSpeechLines(lines: PanelSpeechLine[]): PanelSpeechLine[] {
  const merged: PanelSpeechLine[] = []
  let previousLineIndex: number | null = null

  for (const rawLine of [...lines].sort((left, right) => left.order - right.order || left.lineIndex - right.lineIndex)) {
    const line: PanelSpeechLine = {
      ...rawLine,
      voiceLineIds: normalizeVoiceLineIds(rawLine),
    }
    const previous = merged[merged.length - 1]
    const isContinuousSameSpeaker = previous
      && previous.speaker === line.speaker
      && previousLineIndex !== null
      && line.lineIndex === previousLineIndex + 1

    if (!isContinuousSameSpeaker) {
      merged.push(line)
      previousLineIndex = line.lineIndex
      continue
    }

    const previousDelivery = readTrimmedString(previous.deliveryContent)
    const lineDelivery = readTrimmedString(line.deliveryContent)
    const hasCompleteDelivery = !!previousDelivery && !!lineDelivery
    const previousDeliveryDurationMs = hasCompleteDelivery
      ? deliveryDurationMs(previous, previousDelivery)
      : null
    const lineDeliveryDurationMs = hasCompleteDelivery
      ? deliveryDurationMs(line, lineDelivery)
      : null

    previous.content = joinSpeechContent(previous.content, line.content)
    previous.voiceLineIds = Array.from(new Set([
      ...normalizeVoiceLineIds(previous),
      ...normalizeVoiceLineIds(line),
    ]))
    previous.estimatedDurationMs += line.estimatedDurationMs
    previous.emotionPrompt = previous.emotionPrompt || line.emotionPrompt || null
    previous.emotionStrength = Math.max(previous.emotionStrength || 0, line.emotionStrength || 0) || null
    if (hasCompleteDelivery && previousDeliveryDurationMs !== null && lineDeliveryDurationMs !== null) {
      previous.deliveryContent = joinSpeechContent(previousDelivery, lineDelivery)
      previous.deliveryDurationMs = previousDeliveryDurationMs + lineDeliveryDurationMs
      previous.deliverySource = previous.deliverySource || line.deliverySource || null
      previous.deliveryReason = previous.deliveryReason || line.deliveryReason || null
      previous.deliveryUpdatedAt = line.deliveryUpdatedAt || previous.deliveryUpdatedAt || null
    } else {
      previous.deliveryContent = null
      previous.deliveryDurationMs = null
      previous.deliverySource = null
      previous.deliveryReason = null
      previous.deliveryUpdatedAt = null
    }
    previousLineIndex = line.lineIndex
  }

  return merged
}

function resolveMode(lines: PanelSpeechLine[], warnings: PanelSpeechWarning[]): PanelSpeechMode {
  if (lines.length === 0) return 'none'
  const speakers = uniqueSpeakers(lines)
  if (speakers.every(isNarratorSpeaker)) return 'voiceover'
  if (lines.length === 1 && speakers.length === 1) return 'single_speaker'
  if (lines.length <= 2 && speakers.length <= 2) return 'sequential_dialogue'

  warnings.push({
    code: 'COMPLEX_DIALOGUE_DOWNGRADED',
    severity: 'warning',
    message: '单镜头台词过多或说话人过多，已降级为旁白式提示，避免原生音频生成多人同时说话。',
  })
  return 'voiceover'
}

export function buildPanelSpeechPlanPayloadFromLines(params: {
  panel: PanelLike
  lines: PanelSpeechLine[]
  voiceConfig: PanelSpeechVoiceConfig[]
}): PanelSpeechPlanPayload {
  const warnings: PanelSpeechWarning[] = []
  const lines = mergeConsecutivePanelSpeechLines(params.lines)
  const panelDurationMs = resolvePanelDurationMs(params.panel)
  const estimatedSpeechDurationMs = lines.reduce((sum, line) => sum + resolvePanelSpeechLineDurationMs(line), 0)
  if (panelDurationMs && estimatedSpeechDurationMs > panelDurationMs * 1.35) {
    warnings.push({
      code: 'SPEECH_LONGER_THAN_PANEL',
      severity: 'warning',
      message: `口播预计 ${Math.round(estimatedSpeechDurationMs / 1000)}s，明显长于镜头 ${Math.round(panelDurationMs / 1000)}s；建议生成更短口播版或拆分镜头。`,
    })
  }

  for (const line of lines) {
    const speechText = resolvePanelSpeechLineText(line)
    if (speechText.replace(/\s+/g, '').length > 80) {
      warnings.push({
        code: 'LINE_TOO_LONG',
        severity: 'warning',
        message: `台词 #${line.lineIndex} 的口播版偏长，原生音频可能压缩语速或忽略部分内容。`,
      })
    }
  }

  const mode = resolveMode(lines, warnings)
  for (const config of params.voiceConfig) {
    if (!config.hasVoice) {
      warnings.push({
        code: 'SPEAKER_VOICE_MISSING',
        severity: 'blocking',
        message: `发言人「${config.speaker}」未配置音色。`,
      })
    }
  }

  return {
    mode,
    status: warnings.some((warning) => warning.severity === 'blocking') ? 'invalid' : 'ready',
    lines,
    voiceConfig: params.voiceConfig,
    timing: {
      panelDurationMs,
      targetDurationMs: typeof params.panel.targetDurationMs === 'number' ? params.panel.targetDurationMs : null,
      estimatedSpeechDurationMs,
    },
    warnings,
  }
}

export function buildPanelSpeechPlanPayload(params: {
  panel: PanelLike
  voiceLines: VoiceLineLike[]
  characters?: CharacterVoiceLike[]
  speakerVoices?: Record<string, SpeakerVoiceEntry>
}): PanelSpeechPlanPayload {
  const characters = params.characters || []
  const speakerVoices = params.speakerVoices || {}
  const rawLines = [...params.voiceLines]
    .sort((left, right) => left.lineIndex - right.lineIndex)
    .map((line, index): PanelSpeechLine => {
      const estimatedDurationMs = typeof line.estimatedDurationMs === 'number' && Number.isFinite(line.estimatedDurationMs) && line.estimatedDurationMs > 0
        ? Math.round(line.estimatedDurationMs)
        : estimateNarrationDurationMs(line.content)
      return {
        voiceLineId: line.id,
        lineIndex: line.lineIndex,
        speaker: line.speaker.trim(),
        content: line.content.trim(),
        order: index + 1,
        estimatedDurationMs,
        emotionPrompt: line.emotionPrompt ?? null,
        emotionStrength: line.emotionStrength ?? null,
      }
    })
    .filter((line) => line.speaker && line.content)
  const lines = mergeConsecutivePanelSpeechLines(rawLines)

  const voiceConfig = uniqueSpeakers(lines).map((speaker) => buildVoiceConfig({ speaker, characters, speakerVoices }))
  return buildPanelSpeechPlanPayloadFromLines({
    panel: params.panel,
    lines,
    voiceConfig,
  })
}

function resolveSpeechPlanSource(existingSource: string | null | undefined, requestedSource: string): string {
  if (isStoryboardSpeechPlanSource(existingSource) && !requestedSource.startsWith('voice_analyze')) {
    return existingSource || 'storyboard'
  }
  return requestedSource
}

function sortStoryboards<T extends { createdAt: Date; clip: { start: number | null; createdAt: Date } | null }>(storyboards: T[]): T[] {
  return [...storyboards].sort((left, right) => (
    (left.clip?.start ?? Number.MAX_SAFE_INTEGER) - (right.clip?.start ?? Number.MAX_SAFE_INTEGER)
    || (left.clip?.createdAt.getTime() ?? 0) - (right.clip?.createdAt.getTime() ?? 0)
    || left.createdAt.getTime() - right.createdAt.getTime()
  ))
}

export function summarizePanelSpeechPlans(plans: Array<{
  mode: string
  status: string
  warningsJson?: unknown
}>): PanelSpeechPlanSummary {
  const missingVoiceSpeakers = new Set<string>()
  let warningCount = 0
  for (const plan of plans) {
    const warnings = Array.isArray(plan.warningsJson) ? plan.warningsJson : []
    warningCount += warnings.length
    for (const warning of warnings) {
      if (!warning || typeof warning !== 'object') continue
      const record = warning as Record<string, unknown>
      if (record.code !== 'SPEAKER_VOICE_MISSING') continue
      const message = readTrimmedString(record.message)
      const match = message.match(/「(.+?)」/)
      if (match?.[1]) missingVoiceSpeakers.add(match[1])
    }
  }
  return {
    total: plans.length,
    ready: plans.filter((plan) => plan.status === 'ready').length,
    invalid: plans.filter((plan) => plan.status === 'invalid').length,
    withSpeech: plans.filter((plan) => plan.mode !== 'none').length,
    silent: plans.filter((plan) => plan.mode === 'none').length,
    missingVoiceSpeakers: Array.from(missingVoiceSpeakers),
    warningCount,
  }
}

/**
 * 将镜头级可播台词投影到旧 SpeechPlan 结构，供仍依赖该接口的页面和任务读取。
 * NovelPromotionPanelSpeech 是唯一事实来源；绝不从旧 VoiceLine 反向拼装或合并台词。
 */
export async function rebuildEpisodeSpeechPlans(episodeId: string, source = 'system') {
  try {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      select: {
        id: true,
        novelPromotionProject: {
          select: { projectId: true },
        },
        voiceLines: {
          select: {
            id: true,
            matchedPanelId: true,
          },
        },
        storyboards: {
          select: {
            id: true,
            clipId: true,
            createdAt: true,
            clip: {
              select: {
                start: true,
                createdAt: true,
              },
            },
            panels: {
              orderBy: { panelIndex: 'asc' },
              select: {
                id: true,
                panelIndex: true,
                duration: true,
                targetDurationMs: true,
                speechPlan: {
                  select: { source: true },
                },
                matchedVoiceLines: {
                  select: { id: true },
                },
                panelSpeech: {
                  select: {
                    id: true,
                    speaker: true,
                    originalContent: true,
                    deliveryContent: true,
                    estimatedDurationMs: true,
                    emotionPrompt: true,
                    emotionStrength: true,
                    voiceConfigJson: true,
                    warningsJson: true,
                    status: true,
                    source: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!episode) throw new Error('SPEECH_PLAN_EPISODE_NOT_FOUND')

    const canonicalSpeechCount = episode.storyboards.reduce(
      (count, storyboard) => count + storyboard.panels.filter((panel) => panel.panelSpeech).length,
      0,
    )
    const legacyOnly = canonicalSpeechCount === 0 && episode.voiceLines.length > 0
    const rows = sortStoryboards(episode.storyboards).flatMap((storyboard) => (
      storyboard.panels.map((panel) => {
        const speech = panel.panelSpeech
        const canonicalWarnings = speech ? readPanelSpeechWarnings(speech.warningsJson) : []
        const voiceConfig = speech
          ? [readCanonicalPanelSpeechVoiceConfig(speech.voiceConfigJson)].filter((item): item is PanelSpeechVoiceConfig => !!item)
          : []
        const firstLegacyVoiceLine = panel.matchedVoiceLines[0]
        const lines: PanelSpeechLine[] = speech
          ? [{
            voiceLineId: firstLegacyVoiceLine?.id || speech.id,
            lineIndex: panel.panelIndex + 1,
            speaker: speech.speaker,
            content: speech.originalContent,
            order: 1,
            estimatedDurationMs: speech.estimatedDurationMs || estimateNarrationDurationMs(speech.deliveryContent || speech.originalContent),
            deliveryContent: speech.deliveryContent,
            deliveryDurationMs: speech.deliveryContent
              ? speech.estimatedDurationMs || estimateNarrationDurationMs(speech.deliveryContent)
              : null,
            emotionPrompt: speech.emotionPrompt,
            emotionStrength: speech.emotionStrength,
          }]
          : []
        const payload = buildPanelSpeechPlanPayloadFromLines({
          panel,
          lines,
          voiceConfig,
        })
        const warnings = [...canonicalWarnings, ...payload.warnings]
        const hasLegacyConflict = panel.matchedVoiceLines.length > 1
        if (hasLegacyConflict) {
          warnings.push({
            code: 'LEGACY_SPEECH_REBUILD_REQUIRED',
            severity: 'blocking',
            message: '当前镜头仍存在多条旧台词绑定，请重新生成分镜文稿与台词计划。',
          })
        }
        if (legacyOnly) {
          warnings.push({
            code: 'LEGACY_SPEECH_REBUILD_REQUIRED',
            severity: 'blocking',
            message: '当前项目仍使用旧的多台词绑定数据，无法安全转换为一镜一条可播台词；请重新生成分镜文稿与台词计划。',
          })
        }
        const status = legacyOnly || hasLegacyConflict || (speech !== null && speech.status !== 'ready')
          ? 'invalid'
          : payload.status

        return {
          projectId: episode.novelPromotionProject.projectId,
          episodeId: episode.id,
          clipId: storyboard.clipId,
          panelId: panel.id,
          mode: payload.mode,
          status,
          linesJson: payload.lines,
          voiceConfigJson: payload.voiceConfig,
          timingJson: payload.timing,
          warningsJson: warnings,
          source: speech?.source || resolveSpeechPlanSource(panel.speechPlan?.source, source),
        }
      })
    ))

    await prisma.$transaction(async (tx) => {
      const panelIds = rows.map((row) => row.panelId)
      await tx.novelPromotionPanelSpeechPlan.deleteMany({
        where: {
          episodeId,
          ...(panelIds.length > 0 ? { panelId: { notIn: panelIds } } : {}),
        },
      })
      for (const row of rows) {
        await tx.novelPromotionPanelSpeechPlan.upsert({
          where: { panelId: row.panelId },
          create: {
            ...row,
            linesJson: asInputJson(row.linesJson),
            voiceConfigJson: asInputJson(row.voiceConfigJson),
            timingJson: asInputJson(row.timingJson),
            warningsJson: asInputJson(row.warningsJson),
          },
          update: {
            projectId: row.projectId,
            episodeId: row.episodeId,
            clipId: row.clipId,
            mode: row.mode,
            status: row.status,
            linesJson: asInputJson(row.linesJson),
            voiceConfigJson: asInputJson(row.voiceConfigJson),
            timingJson: asInputJson(row.timingJson),
            warningsJson: asInputJson(row.warningsJson),
            source: row.source,
          },
        })
      }
    }, { timeout: 30000 })

    return {
      episodeId,
      available: true,
      plans: rows,
      summary: summarizePanelSpeechPlans(rows),
    }
  } catch (error) {
    if (!isPanelSpeechPlanTableMissing(error) && !isPanelSpeechTableMissing(error)) throw error
    return {
      episodeId,
      available: false,
      plans: [],
      summary: summarizePanelSpeechPlans([]),
    }
  }
}

export async function listEpisodeSpeechPlans(episodeId: string) {
  try {
    const plans = await prisma.novelPromotionPanelSpeechPlan.findMany({
      where: { episodeId },
      orderBy: { createdAt: 'asc' },
    })
    return {
      available: true,
      plans,
      summary: summarizePanelSpeechPlans(plans),
    }
  } catch (error) {
    if (!isPanelSpeechPlanTableMissing(error)) throw error
    return {
      available: false,
      plans: [],
      summary: summarizePanelSpeechPlans([]),
    }
  }
}

export async function ensurePanelSpeechPlan(panelId: string) {
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      storyboard: {
        select: {
          episodeId: true,
        },
      },
    },
  })
  if (!panel) throw new Error('SPEECH_PLAN_PANEL_NOT_FOUND')

  const rebuilt = await rebuildEpisodeSpeechPlans(panel.storyboard.episodeId)
  if (!rebuilt.available) return { available: false, plan: null }
  const plan = await prisma.novelPromotionPanelSpeechPlan.findUnique({ where: { panelId } })
  return { available: true, plan }
}

export async function ensureEpisodeSpeechPlans(episodeId: string) {
  return await rebuildEpisodeSpeechPlans(episodeId)
}

export async function countPanelMatchedVoiceLines(panelId: string): Promise<number> {
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      storyboard: {
        select: {
          episodeId: true,
        },
      },
    },
  })
  if (!panel) throw new Error('SPEECH_PLAN_PANEL_NOT_FOUND')

  const lines = await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episodeId: panel.storyboard.episodeId,
      OR: [
        { matchedPanelId: panel.id },
        {
          matchedStoryboardId: panel.storyboardId,
          matchedPanelIndex: panel.panelIndex,
        },
      ],
    },
    select: { id: true },
  })

  return new Set(lines.map((line) => line.id)).size
}

function readSpeechLines(raw: unknown): PanelSpeechLine[] {
  const lines = Array.isArray(raw)
    ? raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      const voiceLineId = readTrimmedString(record.voiceLineId)
      const speaker = readTrimmedString(record.speaker)
      const content = readTrimmedString(record.content)
      if (!voiceLineId || !speaker || !content) return []
      const voiceLineIds = Array.isArray(record.voiceLineIds)
        ? record.voiceLineIds.map(readTrimmedString).filter(Boolean)
        : []
      return [{
        voiceLineId,
        voiceLineIds: voiceLineIds.length > 0 ? Array.from(new Set(voiceLineIds)) : [voiceLineId],
        speaker,
        content,
        lineIndex: typeof record.lineIndex === 'number' ? record.lineIndex : 0,
        order: typeof record.order === 'number' ? record.order : 0,
        estimatedDurationMs: typeof record.estimatedDurationMs === 'number' ? record.estimatedDurationMs : estimateNarrationDurationMs(content),
        deliveryContent: readTrimmedString(record.deliveryContent) || null,
        deliveryDurationMs: readPositiveNumber(record.deliveryDurationMs),
        deliverySource: readTrimmedString(record.deliverySource) || null,
        deliveryReason: readTrimmedString(record.deliveryReason) || null,
        deliveryUpdatedAt: readTrimmedString(record.deliveryUpdatedAt) || null,
        emotionPrompt: typeof record.emotionPrompt === 'string' ? record.emotionPrompt : null,
        emotionStrength: typeof record.emotionStrength === 'number' ? record.emotionStrength : null,
      }]
    })
    : []
  return mergeConsecutivePanelSpeechLines(lines)
}

export function readPanelSpeechLines(raw: unknown): PanelSpeechLine[] {
  return readSpeechLines(raw)
}

export function panelSpeechPlanHasSpeech(plan: {
  mode?: string | null
  linesJson?: unknown
} | null | undefined): boolean {
  if (!plan || plan.mode === 'none') return false
  return readSpeechLines(plan.linesJson).length > 0
}

function readVoiceConfig(raw: unknown): PanelSpeechVoiceConfig[] {
  return Array.isArray(raw)
    ? raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      const speaker = readTrimmedString(record.speaker)
      if (!speaker) return []
      return [{
        speaker,
        hasVoice: record.hasVoice === true,
        source: record.source === 'character' || record.source === 'speaker' ? record.source : 'none',
        provider: readTrimmedString(record.provider) || undefined,
        voiceType: readTrimmedString(record.voiceType) || undefined,
        voiceId: readTrimmedString(record.voiceId) || undefined,
        previewAudioUrl: readTrimmedString(record.previewAudioUrl) || undefined,
      }]
    })
    : []
}

export function readPanelSpeechVoiceConfig(raw: unknown): PanelSpeechVoiceConfig[] {
  return readVoiceConfig(raw)
}

export function getPanelSpeechReferenceVoiceConfigs(
  linesJson: unknown,
  voiceConfigJson: unknown,
  maxCount = 3,
): PanelSpeechVoiceConfig[] {
  const lines = readSpeechLines(linesJson)
  if (lines.length === 0) return []

  const speakerOrder = uniqueSpeakers(lines)
  const configs = readVoiceConfig(voiceConfigJson)
  const configBySpeaker = new Map(configs.map((config) => [config.speaker, config]))
  const references: PanelSpeechVoiceConfig[] = []
  const seenAudioUrls = new Set<string>()

  for (const speaker of speakerOrder) {
    if (references.length >= maxCount) break
    const config = configBySpeaker.get(speaker)
    const previewAudioUrl = readTrimmedString(config?.previewAudioUrl)
    if (!config?.hasVoice || !previewAudioUrl) continue
    if (config.source !== 'character' && config.source !== 'speaker') continue
    if (seenAudioUrls.has(previewAudioUrl)) continue
    seenAudioUrls.add(previewAudioUrl)
    references.push({
      ...config,
      previewAudioUrl,
    })
  }

  return references
}

export function compileSpeechPlanPromptSection(params: {
  mode: string | null
  status: string | null
  linesJson: unknown
  voiceConfigJson?: unknown
  locale?: 'zh' | 'en'
}): string {
  const locale = params.locale || 'zh'
  const lines = readSpeechLines(params.linesJson)
  if (lines.length === 0 || params.mode === 'none') return ''
  const configs = readVoiceConfig(params.voiceConfigJson)
  const configBySpeaker = new Map(configs.map((config) => [config.speaker, config]))
  const lineText = lines
    .sort((left, right) => left.order - right.order || left.lineIndex - right.lineIndex)
    .map((line) => {
      const deliveryContent = readTrimmedString(line.deliveryContent)
      const label = deliveryContent ? (locale === 'en' ? 'delivery' : '口播版') : ''
      return `${line.speaker}${label ? `(${label})` : ''}: ${resolvePanelSpeechLineText(line)}`
    })
  const voiceText = uniqueSpeakers(lines).map((speaker) => {
    const config = configBySpeaker.get(speaker)
    if (!config?.hasVoice) return locale === 'en' ? `${speaker}: voice not configured` : `${speaker}: 未配置音色`
    return locale === 'en'
      ? `${speaker}: use configured ${config.source} voice${config.voiceType ? ` (${config.voiceType})` : ''}`
      : `${speaker}: 使用已配置${config.source === 'character' ? '角色' : '发言人'}音色${config.voiceType ? `（${config.voiceType}）` : ''}`
  })

  if (locale === 'en') {
    return [
      'Native audio and speech plan:',
      `Mode: ${params.mode}. Generate natural audio only when the selected video model supports native audio.`,
      `Lines: ${lineText.join(' | ')}`,
      `Voices: ${voiceText.join(' | ')}`,
      'Keep speech synchronized with this shot. Do not add subtitles, captions, watermarks, or extra on-screen text.',
      'For book-guide voiceover shots, prefer clear voiceover over forced lip synchronization.',
    ].join('\n')
  }

  return [
    '原生音频与台词计划：',
    `模式：${params.mode}。仅在所选视频模型支持原生音频时生成自然声音。`,
    `台词：${lineText.join(' | ')}`,
    `音色：${voiceText.join(' | ')}`,
    '声音要贴合本镜头节奏，不要生成字幕、说明文字、水印或额外屏幕文字。',
    '导读旁白镜头优先保持清晰旁白，不强制做精准口型同步。',
  ].join('\n')
}

export async function validatePanelSpeechReadyForVideo(panelId: string) {
  const { available, plan } = await ensurePanelSpeechPlan(panelId)
  if (!available || !plan) {
    const voiceLineCount = await countPanelMatchedVoiceLines(panelId)
    if (voiceLineCount > 0) {
      return {
        ready: false,
        available,
        plan: null,
        reasons: [
          available
            ? `当前镜头已有 ${voiceLineCount} 条台词，但镜头级台词与声音计划缺失；继续生成将不会携带旁白。`
            : `当前数据库缺少镜头级台词与声音计划表，已有 ${voiceLineCount} 条台词无法注入视频；请先执行数据库迁移，或明确选择无旁白继续生成。`,
        ],
        code: 'SPEECH_PLAN_MISSING' as PanelSpeechReadinessCode,
        voiceLineCount,
      }
    }
    return {
      ready: true,
      available,
      plan: null,
      reasons: ['当前镜头没有匹配台词；继续生成将不会携带旁白。'],
      code: 'NO_SPEECH' as PanelSpeechReadinessCode,
      voiceLineCount,
    }
  }
  if (plan.mode === 'none') {
    const voiceLineCount = await countPanelMatchedVoiceLines(panelId)
    if (voiceLineCount > 0) {
      return {
        ready: false,
        available,
        plan,
        reasons: [`当前镜头已有 ${voiceLineCount} 条台词，但台词计划为空；继续生成将不会携带旁白。`],
        code: 'SPEECH_PLAN_EMPTY' as PanelSpeechReadinessCode,
        voiceLineCount,
      }
    }
    return {
      ready: true,
      available,
      plan,
      reasons: ['当前镜头没有匹配台词；继续生成将不会携带旁白。'],
      code: 'NO_SPEECH' as PanelSpeechReadinessCode,
      voiceLineCount,
    }
  }
  if (plan.status === 'ready') {
    return {
      ready: true,
      available,
      plan,
      reasons: [] as string[],
      code: 'READY' as PanelSpeechReadinessCode,
      voiceLineCount: readSpeechLines(plan.linesJson).length,
    }
  }
  const warnings = Array.isArray(plan.warningsJson) ? plan.warningsJson : []
  const reasons = warnings.flatMap((warning) => {
    if (!warning || typeof warning !== 'object') return []
    const message = readTrimmedString((warning as Record<string, unknown>).message)
    return message ? [message] : []
  })
  return {
    ready: false,
    available,
    plan,
    reasons: reasons.length > 0 ? reasons : ['台词与声音计划未就绪。'],
    code: 'SPEECH_PLAN_NOT_READY' as PanelSpeechReadinessCode,
    voiceLineCount: readSpeechLines(plan.linesJson).length,
  }
}

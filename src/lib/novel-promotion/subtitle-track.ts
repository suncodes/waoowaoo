import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPrismaErrorCode } from '@/lib/prisma-error'
import { uploadObject } from '@/lib/storage'
import {
  readPanelSpeechLines,
  resolvePanelSpeechLineDurationMs,
  resolvePanelSpeechLineText,
  type PanelSpeechLine,
} from './speech-plan'
import { ensureEpisodeSpeechPlans } from './speech-plan'
import {
  collectOrderedVideoCandidates,
  type OrderedVideoCandidate,
  type VideoDownloadEpisodeData,
} from './video-download-candidates'
import {
  DEFAULT_SUBTITLE_STYLE,
  normalizeSubtitleStyle,
  type SubtitlePosition,
  type SubtitleStyle,
} from './subtitle-contract'

export { DEFAULT_SUBTITLE_STYLE, normalizeSubtitleStyle }
export type { SubtitlePosition, SubtitleStyle }

export interface SubtitleCue {
  id: string
  panelId: string
  storyboardId: string
  panelIndex: number
  startMs: number
  endMs: number
  text: string
  voiceLineIds: string[]
}

export interface SubtitleWarning {
  code: string
  message: string
}

export interface SubtitleTrackDraft {
  status: 'ready' | 'silent'
  timingSource: 'panel'
  sourceVideoHash: string
  sourceSpeechHash: string
  totalDurationMs: number
  cues: SubtitleCue[]
  warnings: SubtitleWarning[]
  style: SubtitleStyle
}

export interface SubtitlePanelSource {
  id: string
  storyboardId: string
  panelIndex: number
  duration: number | null
  targetDurationMs: number | null
  speechPlan: {
    linesJson: unknown
    updatedAt: Date
  } | null
}

export interface SubtitleVideoSegment {
  storyboardId: string
  panelIndex: number
  videoUrl: string
  durationMs: number
}

interface SubtitleEpisodeSource {
  projectName: string
  videoRatio: string
  candidates: OrderedVideoCandidate[]
  panels: SubtitlePanelSource[]
}

interface SubtitleTrackRow {
  id: string
  projectId: string
  episodeId: string
  sourceVideoHash: string
  sourceSpeechHash: string
  status: string
  timingSource: string
  styleJson: unknown
  cuesJson: unknown
  warningsJson: unknown
  srtStorageKey: string | null
  assStorageKey: string | null
  burnedVideoStorageKey: string | null
  createdAt: Date
  updatedAt: Date
}

export interface SubtitleTrackSnapshot {
  id: string
  status: string
  timingSource: string
  style: SubtitleStyle
  cues: SubtitleCue[]
  warnings: SubtitleWarning[]
  sourceVideoHash: string
  sourceSpeechHash: string
  srtStorageKey: string | null
  assStorageKey: string | null
  burnedVideoStorageKey: string | null
  createdAt: string
  updatedAt: string
}

export interface PreparedSubtitleTrack {
  source: SubtitleEpisodeSource
  draft: SubtitleTrackDraft
  srt: string
  ass: string
  srtStorageKey: string | null
  assStorageKey: string | null
  track: SubtitleTrackSnapshot | null
  available: boolean
}

const MAX_CHARACTERS_PER_LINE = 16
const MAX_CHARACTERS_PER_CUE = MAX_CHARACTERS_PER_LINE * 2

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeColor(value: unknown, fallback: string): string {
  const color = readString(value)
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function panelKey(storyboardId: string, panelIndex: number): string {
  return `${storyboardId}:${panelIndex}`
}

function normalizeSubtitleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function splitLongText(value: string): string[] {
  const characters = Array.from(value)
  if (characters.length <= MAX_CHARACTERS_PER_CUE) return [value]

  const chunks: string[] = []
  let cursor = 0
  while (cursor < characters.length) {
    const maxEnd = Math.min(characters.length, cursor + MAX_CHARACTERS_PER_CUE)
    let end = maxEnd
    for (let index = maxEnd - 1; index > cursor + MAX_CHARACTERS_PER_LINE; index -= 1) {
      if (/[，。！？、；：,.!?;:…]/u.test(characters[index] || '')) {
        end = index + 1
        break
      }
    }
    const chunk = characters.slice(cursor, end).join('').trim()
    if (chunk) chunks.push(chunk)
    cursor = end
  }
  return chunks.length > 0 ? chunks : [value]
}

export function wrapSubtitleText(value: string): string {
  const characters = Array.from(normalizeSubtitleText(value))
  if (characters.length <= MAX_CHARACTERS_PER_LINE) return characters.join('')
  return `${characters.slice(0, MAX_CHARACTERS_PER_LINE).join('')}\n${characters.slice(MAX_CHARACTERS_PER_LINE).join('')}`
}

function splitSpeechLine(line: PanelSpeechLine): Array<{
  text: string
  weight: number
  voiceLineIds: string[]
}> {
  const content = normalizeSubtitleText(resolvePanelSpeechLineText(line))
  if (!content) return []
  const chunks = splitLongText(content)
  const characterTotal = Math.max(1, Array.from(content).length)
  const lineDuration = Math.max(1, resolvePanelSpeechLineDurationMs(line))
  const voiceLineIds = Array.from(new Set([
    line.voiceLineId,
    ...(Array.isArray(line.voiceLineIds) ? line.voiceLineIds : []),
  ].filter(Boolean)))

  return chunks.map((chunk) => ({
    text: wrapSubtitleText(chunk),
    weight: lineDuration * (Math.max(1, Array.from(chunk).length) / characterTotal),
    voiceLineIds,
  }))
}

function resolveFallbackPanelDurationMs(panel: SubtitlePanelSource | undefined): number {
  if (typeof panel?.targetDurationMs === 'number' && panel.targetDurationMs > 0) {
    return Math.round(panel.targetDurationMs)
  }
  if (typeof panel?.duration === 'number' && panel.duration > 0) {
    return Math.round(panel.duration > 1000 ? panel.duration : panel.duration * 1000)
  }
  return 4000
}

function parseSubtitleCues(value: unknown): SubtitleCue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = readRecord(item)
    if (!record) return []
    const id = readString(record.id)
    const panelId = readString(record.panelId)
    const storyboardId = readString(record.storyboardId)
    const panelIndex = readFiniteNumber(record.panelIndex)
    const startMs = readFiniteNumber(record.startMs)
    const endMs = readFiniteNumber(record.endMs)
    const text = readString(record.text)
    if (!id || !panelId || !storyboardId || panelIndex === null || startMs === null || endMs === null || endMs <= startMs || !text) {
      return []
    }
    const voiceLineIds = Array.isArray(record.voiceLineIds)
      ? record.voiceLineIds.map(readString).filter(Boolean)
      : []
    return [{
      id,
      panelId,
      storyboardId,
      panelIndex: Math.max(0, Math.floor(panelIndex)),
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.max(0, Math.round(endMs)),
      text,
      voiceLineIds: Array.from(new Set(voiceLineIds)),
    }]
  })
}

function parseSubtitleWarnings(value: unknown): SubtitleWarning[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = readRecord(item)
    const code = readString(record?.code)
    const message = readString(record?.message)
    return code && message ? [{ code, message }] : []
  })
}

export function buildSubtitleTrackDraft(params: {
  segments: SubtitleVideoSegment[]
  panels: SubtitlePanelSource[]
  style?: unknown
}): SubtitleTrackDraft {
  const style = normalizeSubtitleStyle(params.style)
  const panels = new Map(params.panels.map((panel) => [panelKey(panel.storyboardId, panel.panelIndex), panel]))
  const cues: SubtitleCue[] = []
  const warnings: SubtitleWarning[] = []
  const videoSignature = params.segments.map((segment) => ({
    storyboardId: segment.storyboardId,
    panelIndex: segment.panelIndex,
    videoUrl: segment.videoUrl,
  }))
  const speechSignature: Array<Record<string, unknown>> = []
  let cursorMs = 0
  let missingSpeechPlanCount = 0

  for (const segment of params.segments) {
    const panel = panels.get(panelKey(segment.storyboardId, segment.panelIndex))
    const durationMs = Math.max(1, Math.round(segment.durationMs || resolveFallbackPanelDurationMs(panel)))
    const panelStartMs = cursorMs
    const panelEndMs = panelStartMs + durationMs
    cursorMs = panelEndMs

    const lines = panel?.speechPlan ? readPanelSpeechLines(panel.speechPlan.linesJson) : []
    speechSignature.push({
      storyboardId: segment.storyboardId,
      panelIndex: segment.panelIndex,
      lines: lines.map((line) => ({
        voiceLineIds: Array.from(new Set([line.voiceLineId, ...(line.voiceLineIds || [])])).sort(),
        text: resolvePanelSpeechLineText(line),
      })),
    })

    if (!panel?.speechPlan) {
      missingSpeechPlanCount += 1
      continue
    }

    const units = lines.flatMap(splitSpeechLine)
    if (units.length === 0) continue
    if (units.length > 4) {
      warnings.push({
        code: 'PANEL_SUBTITLE_DENSE',
        message: `镜头 ${segment.panelIndex + 1} 的口播需要拆为 ${units.length} 条字幕，请检查该镜头的台词容量。`,
      })
    }

    const totalWeight = units.reduce((sum, unit) => sum + unit.weight, 0) || units.length
    let unitCursorMs = panelStartMs
    for (const [unitIndex, unit] of units.entries()) {
      const isLastUnit = unitIndex === units.length - 1
      const remainingUnits = units.length - unitIndex - 1
      const rawDuration = Math.round(durationMs * (unit.weight / totalWeight))
      const maxEndMs = panelEndMs - remainingUnits
      const endMs = isLastUnit
        ? panelEndMs
        : Math.min(maxEndMs, Math.max(unitCursorMs + 1, unitCursorMs + rawDuration))
      if (panel && endMs > unitCursorMs) {
        cues.push({
          id: `${panel.id}:${unitIndex + 1}`,
          panelId: panel.id,
          storyboardId: segment.storyboardId,
          panelIndex: segment.panelIndex,
          startMs: unitCursorMs,
          endMs,
          text: unit.text,
          voiceLineIds: unit.voiceLineIds,
        })
      }
      unitCursorMs = endMs
    }
  }

  if (missingSpeechPlanCount > 0) {
    warnings.push({
      code: 'SPEECH_PLAN_MISSING',
      message: `${missingSpeechPlanCount} 个镜头缺少镜头级台词计划，未为这些镜头生成字幕。`,
    })
  }

  return {
    status: cues.length > 0 ? 'ready' : 'silent',
    timingSource: 'panel',
    sourceVideoHash: sha256(videoSignature),
    sourceSpeechHash: sha256(speechSignature),
    totalDurationMs: cursorMs,
    cues,
    warnings,
    style,
  }
}

function formatSrtTime(value: number): string {
  const milliseconds = Math.max(0, Math.floor(value))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const remainder = milliseconds % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`
}

function formatAssTime(value: number): string {
  const centiseconds = Math.max(0, Math.floor(value / 10))
  const hours = Math.floor(centiseconds / 360_000)
  const minutes = Math.floor((centiseconds % 360_000) / 6_000)
  const seconds = Math.floor((centiseconds % 6_000) / 100)
  const remainder = centiseconds % 100
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(2, '0')}`
}

export function buildSrtDocument(cues: SubtitleCue[]): string {
  return cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`,
    cue.text,
  ].join('\n')).join('\n\n') + (cues.length > 0 ? '\n' : '')
}

function toAssColor(value: string, opacity = 1): string {
  const hex = normalizeColor(value, '#FFFFFF').slice(1)
  const red = hex.slice(0, 2)
  const green = hex.slice(2, 4)
  const blue = hex.slice(4, 6)
  const alpha = Math.round((1 - clamp(opacity, 0, 1)) * 255)
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${blue}${green}${red}`
}

function escapeAssText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[{}]/g, '')
    .replace(/\r?\n/g, '\\N')
}

function resolveAssAlignment(position: SubtitlePosition): number {
  if (position === 'top') return 8
  if (position === 'middle') return 5
  return 2
}

export function buildAssDocument(params: {
  cues: SubtitleCue[]
  style?: unknown
  width: number
  height: number
}): string {
  const style = normalizeSubtitleStyle(params.style)
  const width = Math.max(1, Math.round(params.width))
  const height = Math.max(1, Math.round(params.height))
  const fontSize = style.fontSize || Math.max(38, Math.round(height * 0.045))
  const marginVertical = Math.max(48, Math.round(height * 0.1) + style.verticalOffset)
  const isBoxed = style.preset === 'boxed'
  const outline = style.preset === 'clean' ? Math.min(style.outlineWidth, 2) : style.outlineWidth
  const shadow = style.preset === 'clean' ? 0 : 1
  const backColor = isBoxed ? toAssColor(style.outlineColor, style.backgroundOpacity) : '&HFF000000'
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    `Style: Default,Noto Sans CJK SC,${fontSize},${toAssColor(style.fontColor)},&H000000FF,${toAssColor(style.outlineColor)},${backColor},0,0,0,0,100,100,0,0,${isBoxed ? 3 : 1},${outline},${shadow},${resolveAssAlignment(style.position)},60,60,${marginVertical},1`,
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ]
  const events = params.cues.map((cue) => (
    `Dialogue: 0,${formatAssTime(cue.startMs)},${formatAssTime(cue.endMs)},Default,,0,0,0,,${escapeAssText(cue.text)}`
  ))
  return `${[...header, ...events].join('\n')}\n`
}

export function resolveSubtitleOutputSize(videoRatio: string): { width: number; height: number } {
  const match = videoRatio.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!match) return { width: 1280, height: 720 }
  const widthRatio = Number(match[1])
  const heightRatio = Number(match[2])
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return { width: 1280, height: 720 }
  }
  if (heightRatio > widthRatio) return { width: 720, height: 1280 }
  if (Math.abs(widthRatio - heightRatio) < 0.01) return { width: 1024, height: 1024 }
  return { width: 1280, height: 720 }
}

export function isSubtitleTrackTableMissing(error: unknown): boolean {
  if (getPrismaErrorCode(error) === 'P2021') return true
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('novel_promotion_subtitle_tracks') && message.toLowerCase().includes('does not exist')
}

function toTrackSnapshot(row: SubtitleTrackRow): SubtitleTrackSnapshot {
  return {
    id: row.id,
    status: row.status,
    timingSource: row.timingSource,
    style: normalizeSubtitleStyle(row.styleJson),
    cues: parseSubtitleCues(row.cuesJson),
    warnings: parseSubtitleWarnings(row.warningsJson),
    sourceVideoHash: row.sourceVideoHash,
    sourceSpeechHash: row.sourceSpeechHash,
    srtStorageKey: row.srtStorageKey,
    assStorageKey: row.assStorageKey,
    burnedVideoStorageKey: row.burnedVideoStorageKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function loadEpisodeSubtitleSource(params: {
  projectId: string
  episodeId: string
  panelPreferences?: Record<string, boolean>
}): Promise<SubtitleEpisodeSource> {
  await ensureEpisodeSpeechPlans(params.episodeId)
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: params.episodeId,
      novelPromotionProject: { projectId: params.projectId },
    },
    select: {
      id: true,
      novelPromotionProject: {
        select: {
          videoRatio: true,
          project: { select: { name: true } },
        },
      },
      clips: {
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      },
      storyboards: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          clipId: true,
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
              duration: true,
              targetDurationMs: true,
              description: true,
              videoUrl: true,
              audioMixedVideoUrl: true,
              lipSyncVideoUrl: true,
              linkedToNextPanel: true,
              speechPlan: {
                select: {
                  linesJson: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!episode) throw new Error('SUBTITLE_EPISODE_NOT_FOUND')

  const videoData = episode as unknown as VideoDownloadEpisodeData
  const candidates = collectOrderedVideoCandidates([videoData], params.panelPreferences || {})
  const panels = episode.storyboards.flatMap((storyboard) => storyboard.panels.map((panel) => ({
    id: panel.id,
    storyboardId: panel.storyboardId,
    panelIndex: panel.panelIndex,
    duration: panel.duration,
    targetDurationMs: panel.targetDurationMs,
    speechPlan: panel.speechPlan,
  })))
  return {
    projectName: episode.novelPromotionProject.project.name,
    videoRatio: episode.novelPromotionProject.videoRatio,
    candidates,
    panels,
  }
}

function buildSubtitleSegments(params: {
  source: SubtitleEpisodeSource
  durationsByPanelKey?: Map<string, number>
}): SubtitleVideoSegment[] {
  const panels = new Map(params.source.panels.map((panel) => [panelKey(panel.storyboardId, panel.panelIndex), panel]))
  return params.source.candidates.map((candidate) => ({
    storyboardId: candidate.storyboardId,
    panelIndex: candidate.panelIndex,
    videoUrl: candidate.videoUrl,
    durationMs: Math.max(1, params.durationsByPanelKey?.get(panelKey(candidate.storyboardId, candidate.panelIndex))
      || resolveFallbackPanelDurationMs(panels.get(panelKey(candidate.storyboardId, candidate.panelIndex)))),
  }))
}

function subtitleArtifactKeys(params: {
  projectId: string
  episodeId: string
  draft: SubtitleTrackDraft
}): { srtStorageKey: string; assStorageKey: string } {
  const styleHash = sha256(params.draft.style).slice(0, 16)
  const base = `subtitles/${params.projectId}/${params.episodeId}/${params.draft.sourceVideoHash.slice(0, 16)}-${params.draft.sourceSpeechHash.slice(0, 16)}-${styleHash}`
  return {
    srtStorageKey: `${base}.srt`,
    assStorageKey: `${base}.ass`,
  }
}

export async function persistSubtitleTrack(params: {
  projectId: string
  episodeId: string
  draft: SubtitleTrackDraft
  srtStorageKey: string | null
  assStorageKey: string | null
  burnedVideoStorageKey?: string | null
}): Promise<{ available: boolean; track: SubtitleTrackSnapshot | null }> {
  try {
    const existing = await prisma.novelPromotionSubtitleTrack.findFirst({
      where: {
        episodeId: params.episodeId,
        sourceVideoHash: params.draft.sourceVideoHash,
        sourceSpeechHash: params.draft.sourceSpeechHash,
      },
      orderBy: { updatedAt: 'desc' },
    }) as SubtitleTrackRow | null
    const data = {
      projectId: params.projectId,
      episodeId: params.episodeId,
      sourceVideoHash: params.draft.sourceVideoHash,
      sourceSpeechHash: params.draft.sourceSpeechHash,
      status: params.draft.status,
      timingSource: params.draft.timingSource,
      styleJson: asJson(params.draft.style),
      cuesJson: asJson(params.draft.cues),
      warningsJson: asJson(params.draft.warnings),
      srtStorageKey: params.srtStorageKey,
      assStorageKey: params.assStorageKey,
      burnedVideoStorageKey: params.burnedVideoStorageKey ?? null,
    }
    const track = existing
      ? await prisma.novelPromotionSubtitleTrack.update({ where: { id: existing.id }, data }) as SubtitleTrackRow
      : await prisma.novelPromotionSubtitleTrack.create({ data }) as SubtitleTrackRow
    return { available: true, track: toTrackSnapshot(track) }
  } catch (error) {
    if (isSubtitleTrackTableMissing(error)) return { available: false, track: null }
    throw error
  }
}

async function resolvePreparedSubtitleStyle(
  episodeId: string,
  style: unknown | undefined,
): Promise<SubtitleStyle> {
  if (style !== undefined) return normalizeSubtitleStyle(style)

  try {
    const track = await prisma.novelPromotionSubtitleTrack.findFirst({
      where: { episodeId },
      orderBy: { updatedAt: 'desc' },
      select: { styleJson: true },
    })
    return normalizeSubtitleStyle(track?.styleJson)
  } catch (error) {
    if (isSubtitleTrackTableMissing(error)) return DEFAULT_SUBTITLE_STYLE
    throw error
  }
}

export async function prepareEpisodeSubtitleTrack(params: {
  projectId: string
  episodeId: string
  panelPreferences?: Record<string, boolean>
  style?: unknown
  durationsByPanelKey?: Map<string, number>
  outputSize?: { width: number; height: number }
}): Promise<PreparedSubtitleTrack> {
  const source = await loadEpisodeSubtitleSource(params)
  const style = await resolvePreparedSubtitleStyle(params.episodeId, params.style)
  const draft = buildSubtitleTrackDraft({
    segments: buildSubtitleSegments({ source, durationsByPanelKey: params.durationsByPanelKey }),
    panels: source.panels,
    style,
  })
  const outputSize = params.outputSize || resolveSubtitleOutputSize(source.videoRatio)
  const srt = buildSrtDocument(draft.cues)
  const ass = buildAssDocument({ cues: draft.cues, style: draft.style, ...outputSize })
  let srtStorageKey: string | null = null
  let assStorageKey: string | null = null

  if (draft.cues.length > 0) {
    const keys = subtitleArtifactKeys({
      projectId: params.projectId,
      episodeId: params.episodeId,
      draft,
    })
    await uploadObject(Buffer.from(srt, 'utf8'), keys.srtStorageKey, 1, 'application/x-subrip')
    await uploadObject(Buffer.from(ass, 'utf8'), keys.assStorageKey, 1, 'text/x-ssa')
    srtStorageKey = keys.srtStorageKey
    assStorageKey = keys.assStorageKey
  }

  const persisted = await persistSubtitleTrack({
    projectId: params.projectId,
    episodeId: params.episodeId,
    draft,
    srtStorageKey,
    assStorageKey,
  })
  return {
    source,
    draft,
    srt,
    ass,
    srtStorageKey,
    assStorageKey,
    track: persisted.track,
    available: persisted.available,
  }
}

export async function getEpisodeSubtitleTrackState(params: {
  projectId: string
  episodeId: string
  panelPreferences?: Record<string, boolean>
}): Promise<{
  available: boolean
  track: SubtitleTrackSnapshot | null
  stale: boolean
  preview: SubtitleTrackDraft
  projectName: string
}> {
  const source = await loadEpisodeSubtitleSource(params)
  const preview = buildSubtitleTrackDraft({
    segments: buildSubtitleSegments({ source }),
    panels: source.panels,
  })
  try {
    const row = await prisma.novelPromotionSubtitleTrack.findFirst({
      where: { episodeId: params.episodeId },
      orderBy: { updatedAt: 'desc' },
    }) as SubtitleTrackRow | null
    const track = row ? toTrackSnapshot(row) : null
    const stale = !!track && (
      track.sourceVideoHash !== preview.sourceVideoHash
      || track.sourceSpeechHash !== preview.sourceSpeechHash
    )
    return {
      available: true,
      track,
      stale,
      preview,
      projectName: source.projectName,
    }
  } catch (error) {
    if (!isSubtitleTrackTableMissing(error)) throw error
    return {
      available: false,
      track: null,
      stale: false,
      preview,
      projectName: source.projectName,
    }
  }
}

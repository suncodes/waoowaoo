import { safeParseJson, safeParseJsonArray } from '@/lib/json-repair'
import { prisma } from '@/lib/prisma'
import {
  replaceEpisodePanelSpeeches,
  type PanelSpeechAssignment,
} from '@/lib/novel-promotion/panel-speech'
import type { StoryboardPanel } from '@/lib/storyboard-phases'

export type JsonRecord = Record<string, unknown>

const DEFAULT_PANEL_DURATION_SECONDS = 4

type DirectStoryboardSpeech = {
  speaker: string
  content: string
  emotionStrength: number
}

export type ClipPanelsResult = {
  clipId: string
  clipIndex: number
  finalPanels: StoryboardPanel[]
}

export type PersistedStoryboard = {
  storyboardId: string
  clipId: string
  panels: Array<{
    id: string
    panelIndex: number
    description: string | null
    srtSegment: string | null
    characters: string | null
    props: string | null
  }>
}

export type PersistedVoiceLine = {
  id: string
  episodeId: string
  lineIndex: number
  speaker: string
  content: string
  matchedPanelId: string | null
}

export function parseEffort(value: unknown): 'minimal' | 'low' | 'medium' | 'high' | null {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') return value
  return null
}

export function parseTemperature(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.7
  return Math.max(0, Math.min(2, value))
}

export function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const n = Math.floor(value)
  return n >= 0 ? n : null
}

function parsePanelCharacters(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean)
  } catch {
    return []
  }
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => (typeof item === 'string' ? item : '')).filter(Boolean)
  } catch {
    return []
  }
}

function readPanelString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function readPanelField(panel: StoryboardPanel, snakeKey: string, camelKey: string): unknown {
  return panel[snakeKey] ?? panel[camelKey]
}

function readPanelSpeech(panel: StoryboardPanel): DirectStoryboardSpeech | null | undefined {
  const rawSpeech = readPanelField(panel, 'speech', 'speech')
  if (rawSpeech === undefined) return undefined
  if (rawSpeech === null) return null
  const speech = asJsonRecord(rawSpeech)
  const content = readPanelString(speech?.content)
  const speaker = readPanelString(speech?.speaker)
  if (!speech || !content || !speaker) return undefined
  const rawEmotionStrength = speech.emotion_strength ?? speech.emotionStrength
  const emotionStrength = typeof rawEmotionStrength === 'number' && Number.isFinite(rawEmotionStrength)
    ? Math.min(1, Math.max(0.1, rawEmotionStrength))
    : 0.15
  return { speaker, content, emotionStrength }
}

function readPanelSpeechLines(panel: StoryboardPanel): DirectStoryboardSpeech[] {
  const speech = readPanelSpeech(panel)
  return speech ? [speech] : []
}

function resolvePanelDurationSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PANEL_DURATION_SECONDS
  return Math.max(DEFAULT_PANEL_DURATION_SECONDS, Math.round(value * 10) / 10)
}

export function buildVoiceLineRowsFromClipPanels(clipPanels: ClipPanelsResult[]): JsonRecord[] | null {
  const rows: JsonRecord[] = []
  let lineIndex = 1

  for (const clipEntry of clipPanels) {
    for (let panelIndex = 0; panelIndex < clipEntry.finalPanels.length; panelIndex += 1) {
      const panel = clipEntry.finalPanels[panelIndex]
      const speech = readPanelSpeech(panel)
      if (speech === undefined) return null
      if (!speech) continue
      rows.push({
        lineIndex,
        speaker: speech.speaker,
        content: speech.content,
        emotionStrength: speech.emotionStrength,
        matchedPanel: {
          storyboardId: clipEntry.clipId,
          panelIndex,
        },
      })
      lineIndex += 1
    }
  }

  return rows
}

function readPanelShotFunction(panel: StoryboardPanel): string {
  const value = readPanelString(readPanelField(panel, 'shot_function', 'shotFunction'))
  if (
    value === 'hook' ||
    value === 'setup' ||
    value === 'reaction' ||
    value === 'evidence' ||
    value === 'transition' ||
    value === 'payoff' ||
    value === 'breath' ||
    value === 'cta'
  ) {
    return value
  }
  if (panel.panel_number === 1) return 'hook'
  return panel.scene_type === 'emotion' ? 'reaction' : 'setup'
}

function readPanelCharacterNames(panel: StoryboardPanel): string[] {
  if (!Array.isArray(panel.characters)) return []
  return panel.characters.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()]
    const record = asJsonRecord(item)
    const name = readPanelString(record?.name)
    return name ? [name] : []
  })
}

function readPanelPropNames(panel: StoryboardPanel): string[] {
  if (!Array.isArray(panel.props)) return []
  return panel.props.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function readPanelPrimarySubject(panel: StoryboardPanel): string {
  return readPanelString(readPanelField(panel, 'primary_subject', 'primarySubject'))
    || readPanelCharacterNames(panel)[0]
    || readPanelPropNames(panel)[0]
    || readPanelString(panel.location)
    || readPanelString(panel.description)
    || '当前分镜主体'
}

function buildPanelVisibleAssets(panel: StoryboardPanel): JsonRecord[] {
  return [
    ...readPanelCharacterNames(panel).map((name) => ({ id: '', kind: 'character', name })),
    ...(readPanelString(panel.location) ? [{ id: '', kind: 'location', name: readPanelString(panel.location) }] : []),
    ...readPanelPropNames(panel).map((name) => ({ id: '', kind: 'prop', name })),
  ]
}

function readPanelContinuity(panel: StoryboardPanel): JsonRecord {
  const raw = asJsonRecord(panel.continuity) || {}
  return {
    fromPrevious: readPanelString(raw.fromPrevious) || readPanelString(raw.from_previous) || '承接上一镜已建立的空间、主体位置和情绪',
    toNext: readPanelString(raw.toNext) || readPanelString(raw.to_next) || '为下一镜保留清晰动作或信息方向',
    screenDirection: readPanelString(raw.screenDirection) || readPanelString(raw.screen_direction) || '保持既定视线和运动方向',
    lightingContinuity: readPanelString(raw.lightingContinuity) || readPanelString(raw.lighting_continuity) || '保持前后镜光色一致',
  }
}

function readPanelSingleImageFeasibility(panel: StoryboardPanel): JsonRecord {
  const raw = asJsonRecord(readPanelField(panel, 'single_image_feasibility', 'singleImageFeasibility')) || {}
  const status = readPanelString(raw.status)
  return {
    status: status === 'needs_split' || status === 'text_only' || status === 'composite_only'
      ? status
      : 'feasible',
    reason: readPanelString(raw.reason) || '单一时空、单一构图和单一主要视觉事件',
    riskFlags: Array.isArray(raw.riskFlags)
      ? raw.riskFlags.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : Array.isArray(raw.risk_flags)
        ? raw.risk_flags.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [],
  }
}

function buildPanelShotSpec(panel: StoryboardPanel): JsonRecord {
  const description = readPanelString(panel.description)
  const speechLines = readPanelSpeechLines(panel) || []
  return {
    narrativeIntent: description || readPanelString(panel.source_text) || '当前分镜目的',
    shotFunction: readPanelShotFunction(panel),
    primarySubject: readPanelPrimarySubject(panel),
    visibleAssets: buildPanelVisibleAssets(panel),
    subjectIdentity: readPanelCharacterNames(panel),
    startState: description || 'stable opening state',
    actionBeats: description ? [description] : [],
    endState: 'stable closing state',
    continuity: readPanelContinuity(panel),
    singleImageFeasibility: readPanelSingleImageFeasibility(panel),
    spatialContinuity: readPanelString(asJsonRecord(panel.continuity)?.screen_direction)
      || readPanelString(asJsonRecord(panel.continuity)?.screenDirection)
      || 'preserve established screen direction',
    camera: [readPanelString(panel.shot_type), readPanelString(panel.camera_move)].filter(Boolean).join('，') || 'locked camera',
    sceneLightingBaseline: 'follow photography plan',
    colorGrade: 'follow photography plan',
    dialogueAudio: speechLines.map((line) => `${line.speaker}: ${line.content}`).join(' '),
    constraints: ['one time, one place, one composition, one primary visual event'],
    durationIntent: typeof panel.duration === 'number' && Number.isFinite(panel.duration)
      ? `${panel.duration} seconds`
      : 'match clip pacing',
  }
}

function buildPanelPhotographyPlan(panel: StoryboardPanel): JsonRecord {
  const plan = asJsonRecord(panel.photographyPlan) || {}
  const existingShotSpec = asJsonRecord(plan.shotSpec) || {}
  return {
    ...plan,
    shotSpec: {
      ...buildPanelShotSpec(panel),
      ...existingShotSpec,
    },
  }
}

export function parseVoiceLinesJson(responseText: string): JsonRecord[] {
  const rows = safeParseJsonArray(responseText)
  if (rows.length === 0) {
    const raw = safeParseJson(responseText)
    if (Array.isArray(raw) && raw.length === 0) {
      return []
    }
    throw new Error('voice_analyze: invalid payload')
  }
  return rows as JsonRecord[]
}

export function asJsonRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : null
}

export function buildStoryboardJson(storyboards: PersistedStoryboard[]) {
  const rows: Array<{
    storyboardId: string
    panelIndex: number
    text_segment: string
    description: string
    characters: string[]
    props: string[]
  }> = []

  for (const storyboard of storyboards) {
    for (const panel of storyboard.panels) {
      rows.push({
        storyboardId: storyboard.storyboardId,
        panelIndex: panel.panelIndex,
        text_segment: panel.srtSegment || '',
        description: panel.description || '',
        characters: parsePanelCharacters(panel.characters),
        props: parseStringArray(panel.props),
      })
    }
  }

  if (rows.length === 0) return '无分镜数据'
  return JSON.stringify(rows, null, 2)
}

export function buildStoryboardJsonFromClipPanels(clipPanels: ClipPanelsResult[]) {
  const rows: Array<{
    storyboardId: string
    panelIndex: number
    text_segment: string
    description: string
    characters: string[]
    props: string[]
  }> = []

  for (const clipEntry of clipPanels) {
    for (let index = 0; index < clipEntry.finalPanels.length; index += 1) {
      const panel = clipEntry.finalPanels[index]
      rows.push({
        storyboardId: clipEntry.clipId,
        panelIndex: index,
        text_segment: panel.source_text || '',
        description: panel.description || '',
        characters: Array.isArray(panel.characters) ? panel.characters.filter(Boolean) : [],
        props: Array.isArray(panel.props) ? panel.props.filter(Boolean) : [],
      })
    }
  }

  if (rows.length === 0) return '无分镜数据'
  return JSON.stringify(rows, null, 2)
}

export async function persistStoryboardsAndPanels(params: {
  episodeId: string
  clipPanels: ClipPanelsResult[]
}) {
  const { episodeId, clipPanels } = params
  type PanelRow = {
    id: string
    panelIndex: number
    description: string | null
    srtSegment: string | null
    characters: string | null
    props: string | null
  }
  return await prisma.$transaction(async (tx) => {
    const persisted: PersistedStoryboard[] = []
    for (const clipEntry of clipPanels) {
      const storyboard = await tx.novelPromotionStoryboard.upsert({
        where: { clipId: clipEntry.clipId },
        create: {
          clipId: clipEntry.clipId,
          episodeId,
          panelCount: clipEntry.finalPanels.length,
        },
        update: {
          panelCount: clipEntry.finalPanels.length,
          episodeId,
          lastError: null,
        },
        select: { id: true, clipId: true },
      })

      await tx.novelPromotionPanel.deleteMany({
        where: { storyboardId: storyboard.id },
      })

      const panelModel = tx.novelPromotionPanel as unknown as {
        create: (args: {
          data: Record<string, unknown>
          select: {
            id: true
            panelIndex: true
            description: true
            srtSegment: true
            characters: true
            props: true
          }
        }) => Promise<PanelRow>
      }
      const persistedPanels: PersistedStoryboard['panels'] = []
      for (let i = 0; i < clipEntry.finalPanels.length; i += 1) {
        const panel = clipEntry.finalPanels[i]
        const created = await panelModel.create({
          data: {
            storyboardId: storyboard.id,
            panelIndex: i,
            panelNumber: panel.panel_number || i + 1,
            shotType: panel.shot_type || '中景',
            cameraMove: panel.camera_move || '固定',
            description: panel.description || null,
            videoPrompt: panel.video_prompt || null,
            location: panel.location || null,
            characters: panel.characters ? JSON.stringify(panel.characters) : null,
            props: panel.props ? JSON.stringify(panel.props) : null,
            srtSegment: panel.source_text || null,
            photographyRules: JSON.stringify(buildPanelPhotographyPlan(panel)),
            actingNotes: panel.actingNotes ? JSON.stringify(panel.actingNotes) : null,
            duration: resolvePanelDurationSeconds(panel.duration),
            targetDurationMs: Math.round(resolvePanelDurationSeconds(panel.duration) * 1000),
          },
          select: {
            id: true,
            panelIndex: true,
            description: true,
            srtSegment: true,
            characters: true,
            props: true,
          },
        })
        persistedPanels.push(created)
      }

      persisted.push({
        storyboardId: storyboard.id,
        clipId: storyboard.clipId,
        panels: persistedPanels,
      })
    }
    return persisted
  }, { timeout: 30000 })
}

export async function persistStoryboardOutputs(params: {
  episodeId: string
  clipPanels: ClipPanelsResult[]
  voiceLineRows: JsonRecord[] | null
  speechSource?: string
}) {
  const persistedStoryboards = await prisma.$transaction(async (tx) => {
    const persisted: PersistedStoryboard[] = []
    const panelIdByStoryboardRef = new Map<string, string>()
    const storyboardIdByRef = new Map<string, string>()

    for (const clipEntry of params.clipPanels) {
      const storyboard = await tx.novelPromotionStoryboard.upsert({
        where: { clipId: clipEntry.clipId },
        create: {
          clipId: clipEntry.clipId,
          episodeId: params.episodeId,
          panelCount: clipEntry.finalPanels.length,
        },
        update: {
          panelCount: clipEntry.finalPanels.length,
          episodeId: params.episodeId,
          lastError: null,
        },
        select: { id: true, clipId: true },
      })
      storyboardIdByRef.set(storyboard.id, storyboard.id)
      storyboardIdByRef.set(clipEntry.clipId, storyboard.id)

      await tx.novelPromotionPanel.deleteMany({
        where: { storyboardId: storyboard.id },
      })

      const panelModel = tx.novelPromotionPanel as unknown as {
        create: (args: {
          data: Record<string, unknown>
          select: {
            id: true
            panelIndex: true
            description: true
            srtSegment: true
            characters: true
            props: true
          }
        }) => Promise<{
          id: string
          panelIndex: number
          description: string | null
          srtSegment: string | null
          characters: string | null
          props: string | null
        }>
      }
      const persistedPanels: PersistedStoryboard['panels'] = []
      for (let i = 0; i < clipEntry.finalPanels.length; i += 1) {
        const panel = clipEntry.finalPanels[i]
        const created = await panelModel.create({
          data: {
            storyboardId: storyboard.id,
            panelIndex: i,
            panelNumber: panel.panel_number || i + 1,
            shotType: panel.shot_type || '中景',
            cameraMove: panel.camera_move || '固定',
            description: panel.description || null,
            videoPrompt: panel.video_prompt || null,
            location: panel.location || null,
            characters: panel.characters ? JSON.stringify(panel.characters) : null,
            props: panel.props ? JSON.stringify(panel.props) : null,
            srtSegment: panel.source_text || null,
            photographyRules: JSON.stringify(buildPanelPhotographyPlan(panel)),
            actingNotes: panel.actingNotes ? JSON.stringify(panel.actingNotes) : null,
            duration: resolvePanelDurationSeconds(panel.duration),
            targetDurationMs: Math.round(resolvePanelDurationSeconds(panel.duration) * 1000),
          },
          select: {
            id: true,
            panelIndex: true,
            description: true,
            srtSegment: true,
            characters: true,
            props: true,
          },
        })
        panelIdByStoryboardRef.set(`${storyboard.id}:${created.panelIndex}`, created.id)
        panelIdByStoryboardRef.set(`${clipEntry.clipId}:${created.panelIndex}`, created.id)
        persistedPanels.push(created)
      }

      persisted.push({
        storyboardId: storyboard.id,
        clipId: storyboard.clipId,
        panels: persistedPanels,
      })
    }

    const speechAssignments: PanelSpeechAssignment[] = []
    const assignedPanelIds = new Set<string>()
    const voiceLineRows = params.voiceLineRows ?? []

    for (let i = 0; i < voiceLineRows.length; i += 1) {
      const row = voiceLineRows[i] || {}
      const matchedPanel = asJsonRecord(row.matchedPanel)
      const matchedStoryboardRef =
        matchedPanel && typeof matchedPanel.storyboardId === 'string'
          ? matchedPanel.storyboardId.trim()
          : null
      const matchedPanelIndex = matchedPanel ? toPositiveInt(matchedPanel.panelIndex) : null
      if (!matchedPanel || !matchedStoryboardRef || matchedPanelIndex === null) {
        throw new Error(`PANEL_SPEECH_INVALID: voice line ${i + 1} must target exactly one storyboard panel`)
      }
      const matchedStoryboardId = storyboardIdByRef.get(matchedStoryboardRef) || null
      if (!matchedStoryboardId) {
        throw new Error(`voice line ${i + 1} references non-existent storyboard ${matchedStoryboardRef}`)
      }
      const panelKey = `${matchedStoryboardRef}:${matchedPanelIndex}`
      const matchedPanelId = panelIdByStoryboardRef.get(panelKey)
      if (!matchedPanelId) {
        throw new Error(`voice line ${i + 1} references non-existent panel ${panelKey}`)
      }
      if (assignedPanelIds.has(matchedPanelId)) {
        throw new Error(`PANEL_SPEECH_INVALID: multiple spoken lines are assigned to panel ${matchedPanelId}`)
      }
      assignedPanelIds.add(matchedPanelId)

      const emotionStrength = typeof row.emotionStrength === 'number' && Number.isFinite(row.emotionStrength)
        ? Math.min(1, Math.max(0.1, row.emotionStrength))
        : 0.15
      if (typeof row.speaker !== 'string' || !row.speaker.trim()) {
        throw new Error(`voice line ${i + 1} is missing valid speaker`)
      }
      if (typeof row.content !== 'string' || !row.content.trim()) {
        throw new Error(`voice line ${i + 1} is missing valid content`)
      }

      speechAssignments.push({
        panelId: matchedPanelId,
        speaker: row.speaker.trim(),
        content: row.content.trim(),
        emotionStrength,
        sourceAnchor: {
          storyboardId: matchedStoryboardId,
          storyboardReference: matchedStoryboardRef,
          panelIndex: matchedPanelIndex,
        },
      })
    }

    return {
      persistedStoryboards: persisted,
      speechAssignments,
    }
  }, { timeout: 30000 })

  const speechResult = await replaceEpisodePanelSpeeches({
    episodeId: params.episodeId,
    assignments: persistedStoryboards.speechAssignments,
    source: params.speechSource || 'storyboard',
  })
  if (!speechResult.available) {
    throw new Error('PANEL_SPEECH_TABLE_MISSING')
  }
  const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: { episodeId: params.episodeId },
    orderBy: { lineIndex: 'asc' },
    select: {
      id: true,
      episodeId: true,
      lineIndex: true,
      speaker: true,
      content: true,
      matchedPanelId: true,
    },
  })

  return {
    persistedStoryboards: persistedStoryboards.persistedStoryboards,
    voiceLineCount: voiceLines.length,
    voiceLines,
  }
}

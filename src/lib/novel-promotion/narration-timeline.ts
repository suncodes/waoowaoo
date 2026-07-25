import { prisma } from '@/lib/prisma'
import { logWarn as _ulogWarn } from '@/lib/logging/core'
import { isPanelVoiceSpanTableMissing } from './panel-voice-spans'

const DEFAULT_MIN_LINE_DURATION_MS = 1200
const DEFAULT_CHAR_DURATION_MS = 180

type VoiceLineRow = {
  id: string
  lineIndex: number
  content: string
  audioDuration: number | null
  estimatedDurationMs: number | null
  matchedStoryboardId: string | null
  timelineStartMs: number | null
  timelineEndMs: number | null
}

type PanelRow = {
  id: string
  storyboardId: string
  panelIndex: number
  duration: number | null
}

type StoryboardRow = {
  id: string
  clip: {
    start: number | null
    createdAt: Date
  }
  createdAt: Date
  panels: PanelRow[]
}

type TimedVoiceLine = VoiceLineRow & {
  estimatedMs: number
  startMs: number
  endMs: number
}

type TimedPanel = PanelRow & {
  startMs: number
  endMs: number
}

export interface NarrationTimelineResult {
  episodeId: string
  voiceLineCount: number
  panelCount: number
  spanCount: number
  totalDurationMs: number
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function estimateNarrationDurationMs(content: string | null | undefined): number {
  const compactLength = typeof content === 'string'
    ? content.replace(/\s+/g, '').length
    : 0
  return Math.max(DEFAULT_MIN_LINE_DURATION_MS, Math.round(compactLength * DEFAULT_CHAR_DURATION_MS))
}

function resolveVoiceDurationMs(line: VoiceLineRow): number {
  if (isPositiveNumber(line.audioDuration)) return Math.round(line.audioDuration)
  if (isPositiveNumber(line.estimatedDurationMs)) return Math.round(line.estimatedDurationMs)
  return estimateNarrationDurationMs(line.content)
}

function panelDurationWeight(panel: PanelRow): number {
  if (isPositiveNumber(panel.duration)) return Math.max(1000, Math.round(panel.duration * 1000))
  return 1
}

function sortStoryboards(storyboards: StoryboardRow[]): StoryboardRow[] {
  return [...storyboards].sort((left, right) => (
    (left.clip.start ?? Number.MAX_SAFE_INTEGER) - (right.clip.start ?? Number.MAX_SAFE_INTEGER)
    || left.clip.createdAt.getTime() - right.clip.createdAt.getTime()
    || left.createdAt.getTime() - right.createdAt.getTime()
  ))
}

function buildVoiceTimeline(voiceLines: VoiceLineRow[]): TimedVoiceLine[] {
  let cursorMs = 0
  return voiceLines.map((line) => {
    const estimatedMs = resolveVoiceDurationMs(line)
    const startMs = cursorMs
    const endMs = startMs + estimatedMs
    cursorMs = endMs
    return {
      ...line,
      estimatedMs,
      startMs,
      endMs,
    }
  })
}

function storyboardVoiceLines(params: {
  storyboard: StoryboardRow
  storyboardIndex: number
  timedLines: TimedVoiceLine[]
}): TimedVoiceLine[] {
  const direct = params.timedLines.filter((line) => line.matchedStoryboardId === params.storyboard.id)
  if (direct.length > 0) return direct
  const fallback = params.timedLines[params.storyboardIndex]
  return fallback ? [fallback] : []
}

function buildPanelTimeline(panels: PanelRow[], startMs: number, endMs: number): TimedPanel[] {
  if (panels.length === 0 || endMs <= startMs) return []

  const totalMs = endMs - startMs
  const weights = panels.map(panelDurationWeight)
  const weightTotal = weights.reduce((sum, item) => sum + item, 0) || panels.length
  let cursorMs = startMs

  return panels.map((panel, index) => {
    const panelStartMs = cursorMs
    const panelEndMs = index === panels.length - 1
      ? endMs
      : Math.min(endMs, panelStartMs + Math.max(800, Math.round(totalMs * (weights[index] / weightTotal))))
    cursorMs = panelEndMs
    return {
      ...panel,
      startMs: panelStartMs,
      endMs: Math.max(panelStartMs + 800, panelEndMs),
    }
  })
}

function intersectSpan(panel: TimedPanel, line: TimedVoiceLine) {
  const startMs = Math.max(panel.startMs, line.startMs)
  const endMs = Math.min(panel.endMs, line.endMs)
  if (endMs <= startMs) return null
  return {
    panelId: panel.id,
    voiceLineId: line.id,
    startMs,
    endMs,
    voiceStartMs: startMs - line.startMs,
    voiceEndMs: endMs - line.startMs,
    segmentText: line.content,
  }
}

export async function rebuildEpisodeNarrationTimeline(episodeId: string): Promise<NarrationTimelineResult> {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      voiceLines: {
        orderBy: { lineIndex: 'asc' },
        select: {
          id: true,
          lineIndex: true,
          content: true,
          audioDuration: true,
          estimatedDurationMs: true,
          matchedStoryboardId: true,
          timelineStartMs: true,
          timelineEndMs: true,
        },
      },
      storyboards: {
        select: {
          id: true,
          createdAt: true,
          clip: { select: { start: true, createdAt: true } },
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
              duration: true,
            },
          },
        },
      },
    },
  })
  if (!episode) throw new Error('NARRATION_TIMELINE_EPISODE_NOT_FOUND')

  const timedLines = buildVoiceTimeline(episode.voiceLines)
  const orderedStoryboards = sortStoryboards(episode.storyboards)
  const panelUpdates: Array<{
    id: string
    startMs: number
    endMs: number
  }> = []
  const spans: Array<{
    episodeId: string
    panelId: string
    voiceLineId: string
    startMs: number
    endMs: number
    voiceStartMs: number
    voiceEndMs: number
    segmentText: string
  }> = []
  const firstPanelByVoiceLine = new Map<string, string>()

  for (const [storyboardIndex, storyboard] of orderedStoryboards.entries()) {
    const lines = storyboardVoiceLines({ storyboard, storyboardIndex, timedLines })
    if (lines.length === 0) continue
    const startMs = Math.min(...lines.map((line) => line.startMs))
    const endMs = Math.max(...lines.map((line) => line.endMs))
    const panels = buildPanelTimeline(storyboard.panels, startMs, endMs)

    for (const panel of panels) {
      panelUpdates.push({
        id: panel.id,
        startMs: panel.startMs,
        endMs: panel.endMs,
      })
      for (const line of lines) {
        const span = intersectSpan(panel, line)
        if (!span) continue
        if (!firstPanelByVoiceLine.has(line.id)) {
          firstPanelByVoiceLine.set(line.id, panel.id)
        }
        spans.push({
          episodeId,
          ...span,
        })
      }
    }
  }

  const persistTimeline = async (includePanelVoiceSpans: boolean) => prisma.$transaction(async (tx) => {
    for (const line of timedLines) {
      await tx.novelPromotionVoiceLine.update({
        where: { id: line.id },
        data: {
          estimatedDurationMs: line.estimatedMs,
          timelineStartMs: line.startMs,
          timelineEndMs: line.endMs,
          ...(firstPanelByVoiceLine.has(line.id)
            ? { matchedPanelId: firstPanelByVoiceLine.get(line.id) || null }
            : {}),
        },
      })
    }

    if (includePanelVoiceSpans) {
      await tx.novelPromotionPanelVoiceSpan.deleteMany({ where: { episodeId } })
    }

    for (const panel of panelUpdates) {
      const targetDurationMs = Math.max(800, panel.endMs - panel.startMs)
      await tx.novelPromotionPanel.update({
        where: { id: panel.id },
        data: {
          timelineStartMs: panel.startMs,
          timelineEndMs: panel.endMs,
          targetDurationMs,
          duration: Math.round((targetDurationMs / 1000) * 10) / 10,
        },
      })
    }

    if (includePanelVoiceSpans && spans.length > 0) {
      await tx.novelPromotionPanelVoiceSpan.createMany({
        data: spans,
        skipDuplicates: true,
      })
    }
  }, { timeout: 30000 })
  let persistedSpanCount = spans.length
  try {
    await persistTimeline(true)
  } catch (error) {
    if (!isPanelVoiceSpanTableMissing(error)) throw error
    persistedSpanCount = 0
    _ulogWarn(
      '[NarrationTimeline] novel_promotion_panel_voice_spans 表不存在，已降级保存台词/镜头时间轴；请在部署环境执行 prisma db push 同步数据库。',
      { episodeId },
    )
    await persistTimeline(false)
  }

  return {
    episodeId,
    voiceLineCount: timedLines.length,
    panelCount: panelUpdates.length,
    spanCount: persistedSpanCount,
    totalDurationMs: timedLines.length > 0 ? timedLines[timedLines.length - 1].endMs : 0,
  }
}

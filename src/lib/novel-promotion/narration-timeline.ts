import { prisma } from '@/lib/prisma'

const DEFAULT_MIN_LINE_DURATION_MS = 1200
const DEFAULT_CHAR_DURATION_MS = 180
const DEFAULT_PANEL_DURATION_MS = 4000

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

function resolvePanelDurationMs(panel: {
  duration: number | null
  targetDurationMs: number | null
}): number {
  if (isPositiveNumber(panel.targetDurationMs)) return Math.round(panel.targetDurationMs)
  if (isPositiveNumber(panel.duration)) return Math.round(panel.duration * 1000)
  return DEFAULT_PANEL_DURATION_MS
}

export async function rebuildEpisodeNarrationTimeline(episodeId: string): Promise<NarrationTimelineResult> {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      storyboards: {
        select: {
          createdAt: true,
          clip: { select: { start: true, createdAt: true } },
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              duration: true,
              targetDurationMs: true,
              panelSpeech: { select: { id: true } },
            },
          },
        },
      },
    },
  })
  if (!episode) throw new Error('NARRATION_TIMELINE_EPISODE_NOT_FOUND')

  const storyboards = [...episode.storyboards].sort((left, right) => (
    (left.clip?.start ?? Number.MAX_SAFE_INTEGER) - (right.clip?.start ?? Number.MAX_SAFE_INTEGER)
    || (left.clip?.createdAt.getTime() ?? 0) - (right.clip?.createdAt.getTime() ?? 0)
    || left.createdAt.getTime() - right.createdAt.getTime()
  ))
  const panels = storyboards.flatMap((storyboard) => storyboard.panels)
  let cursorMs = 0

  await prisma.$transaction(async (tx) => {
    for (const panel of panels) {
      const durationMs = resolvePanelDurationMs(panel)
      const timelineStartMs = cursorMs
      const timelineEndMs = timelineStartMs + durationMs
      await tx.novelPromotionPanel.update({
        where: { id: panel.id },
        data: { timelineStartMs, timelineEndMs },
      })
      cursorMs = timelineEndMs
    }
  }, { timeout: 30000 })

  const speechCount = panels.filter((panel) => !!panel.panelSpeech).length
  return {
    episodeId,
    voiceLineCount: speechCount,
    panelCount: panels.length,
    spanCount: speechCount,
    totalDurationMs: cursorMs,
  }
}

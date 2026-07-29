import type { Prisma } from '@prisma/client'
import type { GuideContentPlan, GuideSegment } from '@/lib/content-planning'

type ClipLike = {
  id: string
  screenplay?: string | null
}

type GuideClipState = {
  format?: string
  segmentId?: string
  workspace?: {
    removed?: boolean
  }
}

function parseGuideClipState(screenplay: string | null | undefined): GuideClipState | null {
  if (!screenplay) return null
  try {
    const parsed = JSON.parse(screenplay)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as GuideClipState
      : null
  } catch {
    return null
  }
}

export function getGuideClipSegmentId(clip: Pick<ClipLike, 'screenplay'>): string | null {
  const state = parseGuideClipState(clip.screenplay)
  return state?.format === 'guide' && typeof state.segmentId === 'string'
    ? state.segmentId
    : null
}

export function isWorkspaceClipActive(clip: Pick<ClipLike, 'screenplay'>): boolean {
  return parseGuideClipState(clip.screenplay)?.workspace?.removed !== true
}

export function getActiveWorkspaceClipIds(
  clips: ReadonlyArray<Pick<ClipLike, 'id' | 'screenplay'>>,
): string[] {
  return clips.filter(isWorkspaceClipActive).map((clip) => clip.id)
}

function serializeSegment(segment: GuideSegment, removed: boolean) {
  return JSON.stringify({
    schemaVersion: 1,
    format: 'guide',
    segmentId: segment.id,
    title: segment.title,
    narration: segment.narration,
    visualPurpose: segment.visualPurpose,
    visualHints: segment.visualHints,
    onScreenText: segment.onScreenText || null,
    sourceAnchor: segment.sourceAnchor,
    workspace: { removed },
  })
}

function serializeRemovedClip(existing: GuideClipState) {
  return JSON.stringify({
    ...existing,
    workspace: {
      ...(existing.workspace || {}),
      removed: true,
    },
  })
}

export async function syncGuideClips(
  tx: Prisma.TransactionClient,
  episodeId: string,
  plan: GuideContentPlan,
) {
  const existingClips = await tx.novelPromotionClip.findMany({
    where: { episodeId },
    orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
  })
  const existingBySegmentId = new Map<string, typeof existingClips[number]>()
  for (const clip of existingClips) {
    const segmentId = getGuideClipSegmentId(clip)
    if (segmentId) existingBySegmentId.set(segmentId, clip)
  }

  let elapsedSec = 0
  for (const segment of plan.segments) {
    const duration = Math.max(1, Math.round(segment.estimatedDurationSec))
    const existing = existingBySegmentId.get(segment.id)
    const data = {
      start: elapsedSec,
      end: elapsedSec + duration,
      duration,
      summary: segment.title,
      content: segment.narration,
      startText: segment.sourceAnchor.startText || segment.sourceAnchor.quote || segment.sourceAnchor.label,
      endText: segment.sourceAnchor.endText || segment.sourceAnchor.quote || segment.sourceAnchor.label,
      shotCount: existing?.shotCount || 1,
      screenplay: serializeSegment(segment, false),
    }
    if (existing) {
      await tx.novelPromotionClip.update({ where: { id: existing.id }, data })
      existingBySegmentId.delete(segment.id)
    } else {
      await tx.novelPromotionClip.create({
        data: {
          episodeId,
          ...data,
        },
      })
    }
    elapsedSec += duration
  }

  for (const clip of existingBySegmentId.values()) {
    const state = parseGuideClipState(clip.screenplay)
    if (!state) continue
    await tx.novelPromotionClip.update({
      where: { id: clip.id },
      data: {
        screenplay: serializeRemovedClip(state),
      },
    })
  }
}

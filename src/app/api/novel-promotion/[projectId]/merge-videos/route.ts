import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'

interface EpisodeQueryBody {
  episodeId?: string
  panelPreferences?: Record<string, boolean>
  audioStrategy?: 'timeline' | 'none'
}

function normalizePanelPreferences(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const preferences: Record<string, boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'boolean') {
      preferences[key] = raw
    }
  }
  return preferences
}

function buildDedupeKey(projectId: string, episodeId: string | null, panelPreferences: Record<string, boolean>): string {
  const preferenceHash = crypto
    .createHash('sha1')
    .update(JSON.stringify(Object.keys(panelPreferences).sort().map((key) => [key, panelPreferences[key]])))
    .digest('hex')
    .slice(0, 16)
  return `video_merge_export:${projectId}:${episodeId || 'project'}:${preferenceHash}`
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = (await request.json()) as EpisodeQueryBody
  const episodeId = typeof body.episodeId === 'string' && body.episodeId.trim()
    ? body.episodeId.trim()
    : null
  const panelPreferences = normalizePanelPreferences(body.panelPreferences)
  const audioStrategy = body.audioStrategy === 'none' ? 'none' : 'timeline'

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const locale = resolveRequiredTaskLocale(request, body)

  if (episodeId) {
    const episode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: episodeId,
        novelPromotionProject: {
          projectId,
        },
      },
      select: { id: true },
    })
    if (!episode) {
      throw new ApiError('NOT_FOUND')
    }
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId,
    type: TASK_TYPE.VIDEO_MERGE_EXPORT,
    targetType: episodeId ? 'NovelPromotionEpisode' : 'NovelPromotionProject',
    targetId: episodeId || projectId,
    payload: {
      episodeId,
      panelPreferences,
      audioStrategy,
      hasOutputAtStart: false,
    },
    dedupeKey: buildDedupeKey(projectId, episodeId, panelPreferences),
    maxAttempts: 1,
  })

  return NextResponse.json({
    ...result,
    message: 'video merge export task submitted',
  })
})

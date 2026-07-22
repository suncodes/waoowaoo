import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'

export const runtime = 'nodejs'

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const episodeId = typeof body.episodeId === 'string' && body.episodeId.trim() ? body.episodeId.trim() : null
  const options = {
    episodeId,
    includeCandidates: readBoolean(body.includeCandidates, true),
    includeVideos: readBoolean(body.includeVideos, true),
    includeAllVideos: readBoolean(body.includeAllVideos, false),
    includeReasoning: readBoolean(body.includeReasoning, true),
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  if (episodeId) {
    const episode = await prisma.novelPromotionEpisode.findFirst({
      where: { id: episodeId, novelPromotionProject: { projectId } },
      select: { id: true },
    })
    if (!episode) throw new ApiError('NOT_FOUND')
  }

  const exportWindow = Math.floor(Date.now() / 60_000)
  const dedupeKey = `diagnostic_export:${projectId}:${episodeId || 'project'}:${exportWindow}:${crypto
    .createHash('sha1')
    .update(JSON.stringify(options))
    .digest('hex')
    .slice(0, 16)}`
  const result = await submitTask({
    userId: authResult.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    requestId: getRequestId(request),
    projectId,
    episodeId,
    type: TASK_TYPE.DIAGNOSTIC_EXPORT,
    targetType: episodeId ? 'NovelPromotionEpisode' : 'NovelPromotionProject',
    targetId: episodeId || projectId,
    payload: { options, flowId: 'diagnostic-export', flowStageTitle: '导出诊断包', flowStageIndex: 1, flowStageTotal: 1 },
    dedupeKey,
    priority: 1,
    maxAttempts: 1,
  })
  return NextResponse.json({ ...result, options, message: 'diagnostic export task submitted' })
})

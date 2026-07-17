import { NextRequest } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { TASK_TYPE } from '@/lib/task/types'

export const runtime = 'nodejs'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''
  if (!episodeId) throw new ApiError('INVALID_PARAMS')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const response = await maybeSubmitLLMTask({
    request,
    userId: authResult.session.user.id,
    projectId,
    episodeId,
    type: TASK_TYPE.VISUAL_PLAN_RUN,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    routePath: `/api/novel-promotion/${projectId}/visual-plan`,
    body: { ...body, displayMode: 'detail' },
    dedupeKey: `visual_plan_run:${episodeId}`,
    priority: 2,
  })
  if (response) return response
  throw new ApiError('INVALID_PARAMS')
})

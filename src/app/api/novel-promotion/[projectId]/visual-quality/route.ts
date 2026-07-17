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
  const panelId = typeof body?.panelId === 'string' ? body.panelId.trim() : ''
  if (!panelId) throw new ApiError('INVALID_PARAMS')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const response = await maybeSubmitLLMTask({
    request,
    userId: authResult.session.user.id,
    projectId,
    type: TASK_TYPE.VISUAL_QUALITY_REVIEW,
    targetType: 'NovelPromotionPanel',
    targetId: panelId,
    routePath: `/api/novel-promotion/${projectId}/visual-quality`,
    body: { ...body, displayMode: 'loading' },
    dedupeKey: `visual_quality_review:${panelId}`,
  })
  if (response) return response
  throw new ApiError('INVALID_PARAMS')
})

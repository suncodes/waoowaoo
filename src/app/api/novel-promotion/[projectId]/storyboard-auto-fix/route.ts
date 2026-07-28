import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import {
  acceptStoryboardReadinessRisk,
  applyStoryboardAutoFix,
  prepareStoryboardAutoFix,
} from '@/lib/novel-promotion/storyboard-readiness'

type AutoFixAction = 'prepare' | 'apply' | 'regenerate' | 'accept_risk'

function readAction(value: unknown): AutoFixAction {
  if (value === 'apply' || value === 'regenerate' || value === 'accept_risk') return value
  return 'prepare'
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId : ''
  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS', { detail: 'episodeId is required' })
  }

  const action = readAction(body?.action)
  if (action === 'apply') {
    const result = await applyStoryboardAutoFix({
      projectId,
      episodeId,
      userId: session.user.id,
      locale: request.headers.get('accept-language'),
    })
    return NextResponse.json(result)
  }
  if (action === 'accept_risk') {
    const result = await acceptStoryboardReadinessRisk({ projectId, episodeId })
    return NextResponse.json(result)
  }

  const result = await prepareStoryboardAutoFix({ projectId, episodeId })
  return NextResponse.json(result)
})

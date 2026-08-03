import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { startStoryboardAssetBackfill } from '@/lib/novel-promotion/storyboard-readiness'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const episodeId = typeof body.episodeId === 'string' ? body.episodeId.trim() : ''
  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS', { detail: 'episodeId is required' })
  }

  const result = await startStoryboardAssetBackfill({
    projectId,
    episodeId,
    userId: session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
  })
  return NextResponse.json(result)
})

import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { getAssetPromptSnapshotByArtifactId } from '@/lib/creative-quality/prompt-snapshot-query'

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const artifactId = request.nextUrl.searchParams.get('artifactId')?.trim() || ''
  if (!artifactId) throw new ApiError('INVALID_PARAMS')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const snapshot = await getAssetPromptSnapshotByArtifactId({ projectId, artifactId })
  if (!snapshot) throw new ApiError('NOT_FOUND')
  return NextResponse.json({ snapshot })
})

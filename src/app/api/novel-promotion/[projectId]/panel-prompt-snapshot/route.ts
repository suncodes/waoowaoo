import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  getLatestPanelPromptSnapshots,
  panelBelongsToProject,
} from '@/lib/creative-quality/prompt-snapshot-query'

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const panelId = request.nextUrl.searchParams.get('panelId')?.trim() || ''
  if (!panelId) throw new ApiError('INVALID_PARAMS')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const exists = await panelBelongsToProject({ projectId, panelId })
  if (!exists) throw new ApiError('NOT_FOUND')

  const snapshots = await getLatestPanelPromptSnapshots({ projectId, panelId })
  return NextResponse.json({ panelId, snapshots })
})

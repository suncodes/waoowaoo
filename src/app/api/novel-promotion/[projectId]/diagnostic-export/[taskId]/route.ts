import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/storage'
import { getTaskById } from '@/lib/task/service'
import { TASK_TYPE } from '@/lib/task/types'

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; taskId: string }> },
) => {
  const { projectId, taskId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const task = await getTaskById(taskId)
  if (!task || task.userId !== authResult.session.user.id || task.projectId !== projectId || task.type !== TASK_TYPE.DIAGNOSTIC_EXPORT) {
    throw new ApiError('NOT_FOUND')
  }
  const result = task.result && typeof task.result === 'object' && !Array.isArray(task.result)
    ? task.result as Record<string, unknown>
    : null
  const resultRecord = result || {}
  const storageKey = typeof resultRecord.storageKey === 'string' ? resultRecord.storageKey : ''
  if (task.status !== 'completed' || !storageKey) {
    return NextResponse.json({
      ready: false,
      status: task.status,
      taskId: task.id,
      errorCode: task.errorCode || null,
      errorMessage: task.errorMessage || null,
    }, { status: task.status === 'failed' ? 200 : 202 })
  }
  return NextResponse.json({
    ready: true,
    taskId: task.id,
    fileName: typeof resultRecord.fileName === 'string' ? resultRecord.fileName : 'diagnostic.zip',
    downloadUrl: getSignedUrl(storageKey, 3600),
  })
})

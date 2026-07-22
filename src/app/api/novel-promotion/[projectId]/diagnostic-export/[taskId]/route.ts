import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedObjectUrl, toFetchableUrl } from '@/lib/storage'
import { getTaskById } from '@/lib/task/service'
import { TASK_TYPE } from '@/lib/task/types'

export const runtime = 'nodejs'

function sanitizeDownloadFileName(value: string): string {
  const normalized = value.trim().replace(/[\r\n\\/:*?"<>|]/g, '_')
  return normalized || 'diagnostic.zip'
}

async function streamDiagnosticArchive(
  request: NextRequest,
  storageKey: string,
  fileName: string,
): Promise<Response> {
  const signedUrl = await getSignedObjectUrl(storageKey, 300)
  const range = request.headers.get('range')
  const upstream = await fetch(toFetchableUrl(signedUrl), {
    headers: range ? { Range: range } : undefined,
    cache: 'no-store',
    signal: request.signal,
  })
  if (!upstream.ok && upstream.status !== 416) {
    throw new Error(`Failed to fetch diagnostic archive: ${upstream.status} ${upstream.statusText}`)
  }

  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/zip')
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadFileName(fileName))}`)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes')
  headers.set('Vary', 'Range')
  for (const headerName of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const headerValue = upstream.headers.get(headerName)
    if (headerValue) headers.set(headerName, headerValue)
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
}

export const GET = apiHandler(async (
  request: NextRequest,
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
  const fileName = typeof resultRecord.fileName === 'string' ? resultRecord.fileName : 'diagnostic.zip'
  if (new URL(request.url).searchParams.get('download') === '1') {
    return streamDiagnosticArchive(request, storageKey, fileName)
  }
  return NextResponse.json({
    ready: true,
    taskId: task.id,
    fileName,
    downloadUrl: `/api/novel-promotion/${encodeURIComponent(projectId)}/diagnostic-export/${encodeURIComponent(taskId)}?download=1`,
  })
})

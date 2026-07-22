import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import { TASK_TYPE } from '@/lib/task/types'

const getTaskByIdMock = vi.hoisted(() => vi.fn())
const getSignedObjectUrlMock = vi.hoisted(() => vi.fn())
const toFetchableUrlMock = vi.hoisted(() => vi.fn((value: string) => value))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireProjectAuthLight: async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  }),
}))

vi.mock('@/lib/task/service', () => ({
  getTaskById: getTaskByIdMock,
}))

vi.mock('@/lib/storage', () => ({
  getSignedObjectUrl: getSignedObjectUrlMock,
  toFetchableUrl: toFetchableUrlMock,
}))

function completedTask() {
  return {
    id: 'task-1',
    userId: 'user-1',
    projectId: 'project-1',
    type: TASK_TYPE.DIAGNOSTIC_EXPORT,
    status: 'completed',
    result: {
      storageKey: 'diagnostics/project-1/task-1.zip',
      fileName: '项目诊断包.zip',
    },
    errorCode: null,
    errorMessage: null,
  }
}

describe('diagnostic export download route', () => {
  beforeEach(() => {
    getTaskByIdMock.mockReset()
    getSignedObjectUrlMock.mockReset()
    toFetchableUrlMock.mockClear()
    vi.unstubAllGlobals()
    getTaskByIdMock.mockResolvedValue(completedTask())
  })

  it('returns an application download URL instead of exposing the storage endpoint', async () => {
    const route = await import('@/app/api/novel-promotion/[projectId]/diagnostic-export/[taskId]/route')
    const request = buildMockRequest({
      path: '/api/novel-promotion/project-1/diagnostic-export/task-1',
      method: 'GET',
    })

    const response = await route.GET(request, {
      params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }),
    })
    const payload = await response.json() as { downloadUrl: string }

    expect(response.status).toBe(200)
    expect(payload.downloadUrl).toBe('/api/novel-promotion/project-1/diagnostic-export/task-1?download=1')
    expect(getSignedObjectUrlMock).not.toHaveBeenCalled()
  })

  it('streams the archive through the application server', async () => {
    const archive = new Uint8Array([80, 75, 3, 4])
    getSignedObjectUrlMock.mockResolvedValue('http://minio.internal/bucket/task-1.zip?signature=secret')
    const fetchMock = vi.fn(async () => new Response(archive, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-length': String(archive.length),
        etag: 'archive-etag',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const route = await import('@/app/api/novel-promotion/[projectId]/diagnostic-export/[taskId]/route')
    const request = buildMockRequest({
      path: '/api/novel-promotion/project-1/diagnostic-export/task-1',
      method: 'GET',
      query: { download: '1' },
    })
    const response = await route.GET(request, {
      params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }),
    })

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(archive)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toContain("attachment; filename*=UTF-8''")
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(getSignedObjectUrlMock).toHaveBeenCalledWith('diagnostics/project-1/task-1.zip', 300)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://minio.internal/bucket/task-1.zip?signature=secret',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})

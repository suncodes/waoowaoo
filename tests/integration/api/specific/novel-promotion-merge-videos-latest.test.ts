import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1', name: 'User 1' } },
    project: { id: 'project-1', userId: 'user-1', name: 'Project 1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => ({ id: 'episode-1' })),
  },
}))

const mergeExportMock = vi.hoisted(() => ({
  getLatestEpisodeVideoMergeExport: vi.fn(async () => ({
    taskId: 'task-1',
    mergedAt: '2026-07-28T08:00:00.000Z',
    outputKey: 'videos/merged/project-1/final.mp4',
    outputUrl: '/api/novel-promotion/project-1/video-proxy?key=videos%2Fmerged%2Fproject-1%2Ffinal.mp4',
    downloadUrl: '/api/novel-promotion/project-1/video-proxy?key=videos%2Fmerged%2Fproject-1%2Ffinal.mp4&download=1',
    fileName: 'final.mp4',
    videoCount: 3,
    sizeBytes: 1024,
  })),
}))

const taskSubmitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(),
}))

const taskLocaleMock = vi.hoisted(() => ({
  resolveRequiredTaskLocale: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/novel-promotion/video-merge-export', () => mergeExportMock)
vi.mock('@/lib/task/submitter', () => taskSubmitterMock)
vi.mock('@/lib/task/resolve-locale', () => taskLocaleMock)

describe('api specific - novel promotion latest merged video', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the latest saved merged video for the current episode', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/merge-videos/route')
    const request = buildMockRequest({
      path: '/api/novel-promotion/project-1/merge-videos',
      method: 'GET',
      query: { episodeId: 'episode-1' },
    })

    const response = await mod.GET(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.latest).toMatchObject({
      taskId: 'task-1',
      outputUrl: expect.stringContaining('/video-proxy?key='),
    })
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-1',
        novelPromotionProject: { projectId: 'project-1' },
      },
      select: { id: true },
    })
    expect(mergeExportMock.getLatestEpisodeVideoMergeExport).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
  })
})

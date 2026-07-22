import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const submitTaskMock = vi.hoisted(() => vi.fn(async (input: Record<string, unknown>) => ({
  async: true,
  taskId: `task-${String(input.targetId)}`,
})))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => ({ id: 'episode-1' })),
  },
  novelPromotionStoryboard: {
    findMany: vi.fn(async () => [{
      id: 'storyboard-1',
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      clip: {
        start: 0,
        createdAt: new Date('2026-07-22T00:00:00.000Z'),
      },
      panels: [
        {
          id: 'panel-1',
          storyboardId: 'storyboard-1',
          panelIndex: 0,
          imageUrl: 'frame-1.png',
          videoUrl: null,
          lipSyncVideoUrl: null,
          visualQualityState: null,
          linkedToNextPanel: true,
          firstLastFramePrompt: '从近景自然过渡到远景',
        },
        {
          id: 'panel-2',
          storyboardId: 'storyboard-1',
          panelIndex: 1,
          imageUrl: 'frame-2.png',
          videoUrl: null,
          lipSyncVideoUrl: null,
          visualQualityState: null,
          linkedToNextPanel: false,
          firstLastFramePrompt: null,
        },
        {
          id: 'panel-3',
          storyboardId: 'storyboard-1',
          panelIndex: 2,
          imageUrl: 'frame-3.png',
          videoUrl: null,
          lipSyncVideoUrl: null,
          visualQualityState: null,
          linkedToNextPanel: false,
          firstLastFramePrompt: null,
        },
      ],
    }]),
  },
}))

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: vi.fn(() => 'zh') }))
vi.mock('@/lib/task/has-output', () => ({ hasPanelVideoOutput: vi.fn(async () => false) }))
vi.mock('@/lib/billing', () => ({ buildDefaultTaskBillingInfo: vi.fn(() => ({ mode: 'default' })) }))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/model-pricing/lookup', () => ({ resolveBuiltinPricing: vi.fn(() => ({ status: 'ok' })) }))
vi.mock('@/lib/config-service', () => ({
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({
    generationMode: 'firstlastframe',
    resolution: '720p',
  })),
}))

describe('api specific - batch first-last-frame video generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits only linked adjacent pairs and builds per-panel first-last-frame payloads', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/generate-video/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/generate-video',
      method: 'POST',
      body: {
        all: true,
        episodeId: 'episode-1',
        batchMode: 'firstlastframe',
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          generationMode: 'firstlastframe',
          resolution: '720p',
        },
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      total: 1,
      skipped: 2,
      mode: 'firstlastframe',
      reasonCounts: {
        not_linked: 1,
        last_panel: 1,
      },
    })
    expect(submitTaskMock).toHaveBeenCalledTimes(1)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'panel-1',
      payload: expect.objectContaining({
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        firstLastFrame: {
          lastFrameStoryboardId: 'storyboard-1',
          lastFramePanelIndex: 1,
          flModel: 'ark::doubao-seedance-2-0-260128',
          customPrompt: '从近景自然过渡到远景',
        },
      }),
    }))
  })
})

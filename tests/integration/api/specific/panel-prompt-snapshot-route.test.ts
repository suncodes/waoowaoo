import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findFirst: vi.fn(),
  },
  graphArtifact: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('api specific - panel prompt snapshot route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({ id: 'panel-1' })
    prismaMock.graphArtifact.findMany.mockResolvedValue([
      {
        id: 'artifact-image-1',
        runId: 'run-2',
        stepKey: 'panel_image_prompt',
        artifactType: 'prompt.panel_image.snapshot',
        refId: 'panel-1',
        versionHash: 'hash-image',
        createdAt: new Date('2026-07-23T00:00:02.000Z'),
        payload: {
          snapshotType: 'panel_image_prompt',
          targetId: 'panel-1',
          modelKey: 'provider::image-model',
          promptTemplateId: 'single-panel-image',
          promptHash: 'hash-image',
          specHash: 'spec-image',
          inputHash: 'input-image',
          referenceImages: ['ref-1.png'],
          promptSpec: { primarySubject: '主角' },
          compiledPrompt: '真实图片 compiled prompt',
          createdAt: '2026-07-23T00:00:01.000Z',
        },
      },
      {
        id: 'artifact-video-1',
        runId: 'run-3',
        stepKey: 'panel_video_prompt',
        artifactType: 'prompt.panel_video.snapshot',
        refId: 'panel-1',
        versionHash: 'hash-video',
        createdAt: new Date('2026-07-23T00:00:03.000Z'),
        payload: {
          snapshotType: 'panel_video_prompt',
          targetId: 'panel-1',
          modelKey: 'provider::video-model',
          promptTemplateId: 'panel-video',
          promptHash: 'hash-video',
          specHash: 'spec-video',
          inputHash: 'input-video',
          referenceImages: ['first-frame.png'],
          promptSpec: { primaryMotion: '转身' },
          compiledPrompt: '真实视频 compiled prompt',
          createdAt: '2026-07-23T00:00:03.000Z',
        },
      },
    ])
  })

  it('returns latest prompt snapshots for a panel in the project', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/panel-prompt-snapshot/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/panel-prompt-snapshot?panelId=panel-1',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1')
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'panel-1',
        storyboard: {
          episode: {
            novelPromotionProject: {
              projectId: 'project-1',
            },
          },
        },
      },
      select: { id: true },
    })
    expect(prismaMock.graphArtifact.findMany).toHaveBeenCalledWith({
      where: {
        refId: 'panel-1',
        artifactType: { in: ['prompt.panel_image.snapshot', 'prompt.panel_video.snapshot'] },
        run: { projectId: 'project-1' },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    expect(body.snapshots.image.compiledPrompt).toBe('真实图片 compiled prompt')
    expect(body.snapshots.image.promptHash).toBe('hash-image')
    expect(body.snapshots.video.compiledPrompt).toBe('真实视频 compiled prompt')
  })

  it('does not expose snapshots when the panel is outside the project', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(null)
    const mod = await import('@/app/api/novel-promotion/[projectId]/panel-prompt-snapshot/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/panel-prompt-snapshot?panelId=panel-outside',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(404)
    expect(prismaMock.graphArtifact.findMany).not.toHaveBeenCalled()
  })
})

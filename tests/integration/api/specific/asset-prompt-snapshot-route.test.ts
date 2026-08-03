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
  graphArtifact: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('api specific - asset prompt snapshot route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.graphArtifact.findFirst.mockResolvedValue({
      id: 'artifact-asset-1',
      runId: 'run-1',
      stepKey: 'asset_image_prompt',
      artifactType: 'prompt.asset_image.snapshot',
      refId: 'appearance-1:0',
      versionHash: 'asset-prompt-hash',
      createdAt: new Date('2026-08-03T00:00:02.000Z'),
      payload: {
        snapshotType: 'asset_image_prompt',
        targetId: 'appearance-1',
        modelKey: 'provider::image-model',
        promptTemplateId: 'asset-image-reference',
        promptHash: 'asset-prompt-hash',
        specHash: 'asset-spec-hash',
        inputHash: 'asset-input-hash',
        referenceImages: ['style-ref.png'],
        promptSpec: { assetName: '尼摩船长' },
        compiledPrompt: '真实资产图片 compiled prompt',
        createdAt: '2026-08-03T00:00:01.000Z',
      },
    })
  })

  it('returns an asset prompt snapshot only from the requested project', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/asset-prompt-snapshot/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/asset-prompt-snapshot?artifactId=artifact-asset-1',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1')
    expect(prismaMock.graphArtifact.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'artifact-asset-1',
        artifactType: { in: ['prompt.asset_image.snapshot'] },
        run: { projectId: 'project-1' },
      },
    })
    expect(body.snapshot.targetId).toBe('appearance-1')
    expect(body.snapshot.compiledPrompt).toBe('真实资产图片 compiled prompt')
  })

  it('does not expose a prompt snapshot outside the project', async () => {
    prismaMock.graphArtifact.findFirst.mockResolvedValue(null)
    const mod = await import('@/app/api/novel-promotion/[projectId]/asset-prompt-snapshot/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/asset-prompt-snapshot?artifactId=artifact-outside',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(404)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import { createVisualQualityState } from '@/lib/quality-workflow'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({ id: 'panel-1' })),
  },
}))

const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn(() => 'generated.png'),
  downloadAndUploadImage: vi.fn(async () => 'generated.png'),
  toFetchableUrl: vi.fn((value: string) => value),
  resolveStorageKeyFromMediaValue: vi.fn(async (value: unknown) => {
    if (typeof value !== 'string') return null
    return value.replace(/^\/m\//, '')
  }),
  resolveMediaRefFromLegacyValue: vi.fn(async (value: unknown) => {
    if (typeof value !== 'string') return null
    const storageKey = value.replace(/^\/m\//, '')
    return { url: `/m/${storageKey}` }
  }),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => ({
  generateUniqueKey: storageMock.generateUniqueKey,
  downloadAndUploadImage: storageMock.downloadAndUploadImage,
  toFetchableUrl: storageMock.toFetchableUrl,
}))
vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: storageMock.resolveStorageKeyFromMediaValue,
  resolveMediaRefFromLegacyValue: storageMock.resolveMediaRefFromLegacyValue,
}))

describe('api specific - panel candidate quality approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      imageUrl: 'old.png',
      imageHistory: null,
      candidateImages: null,
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'human_required',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png'],
      }),
    })
  })

  it('accepts a recovered quality candidate and retains all candidates for later switching', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/panel/select-candidate/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/panel/select-candidate',
      method: 'POST',
      body: {
        panelId: 'panel-1',
        action: 'select',
        selectedImageUrl: '/m/candidate-1.png',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.visualQualityState).toMatchObject({
      status: 'approved',
      activeCandidateUrl: '/m/candidate-1.png',
      lastAction: 'select_candidate',
      humanConfirmedAt: expect.any(String),
    })
    expect(body.candidateImages).toEqual(['/m/candidate-1.png'])
    expect(body.imageUrl).toBe('/m/candidate-1.png')
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        imageUrl: 'candidate-1.png',
        candidateImages: JSON.stringify(['candidate-1.png']),
        visualQualityState: expect.objectContaining({
          status: 'approved',
          humanConfirmedAt: expect.any(String),
        }),
      }),
    })
  })

  it('rejects confirmation while automatic quality review is still running', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      imageUrl: 'old.png',
      imageHistory: null,
      candidateImages: JSON.stringify(['candidate-1.png']),
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'repairing',
        versionHash: 'version-1',
        candidateUrls: ['candidate-1.png'],
        attempt: 1,
      }),
    })
    const mod = await import('@/app/api/novel-promotion/[projectId]/panel/select-candidate/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/panel/select-candidate',
      method: 'POST',
      body: {
        panelId: 'panel-1',
        action: 'select',
        selectedImageUrl: '/m/candidate-1.png',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(409)
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })
})

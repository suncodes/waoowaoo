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
  getSignedUrl: vi.fn((key: string) => `/m/${key}`),
  generateUniqueKey: vi.fn(() => 'generated.png'),
  downloadAndUploadImage: vi.fn(async () => 'generated.png'),
  toFetchableUrl: vi.fn((value: string) => value),
  resolveStorageKeyFromMediaValue: vi.fn(async (value: unknown) => {
    if (typeof value !== 'string') return null
    return value.replace(/^\/m\//, '')
  }),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => ({
  getSignedUrl: storageMock.getSignedUrl,
  generateUniqueKey: storageMock.generateUniqueKey,
  downloadAndUploadImage: storageMock.downloadAndUploadImage,
  toFetchableUrl: storageMock.toFetchableUrl,
}))
vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: storageMock.resolveStorageKeyFromMediaValue,
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

  it('accepts a recovered quality candidate after candidateImages was cleared', async () => {
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
      activeCandidateUrl: 'candidate-1.png',
      lastAction: 'select_candidate',
    })
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        imageUrl: 'candidate-1.png',
        candidateImages: null,
        visualQualityState: expect.objectContaining({ status: 'approved' }),
      }),
    })
  })
})

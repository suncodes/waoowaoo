import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const submitTaskMock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{
  success: boolean
  async: boolean
  taskId: string
  status: string
  deduped: boolean
}>>(async () => ({
  success: true,
  async: true,
  taskId: 'task-1',
  status: 'queued',
  deduped: false,
})))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: null,
    characterModel: 'img::character',
    locationModel: 'img::location',
    storyboardModel: null,
    editModel: null,
    videoModel: null,
    videoRatio: '16:9',
    artStyle: 'american-comic',
    capabilityDefaults: {},
    capabilityOverrides: {},
  })),
  buildImageBillingPayload: vi.fn(async (input: { basePayload: Record<string, unknown> }) => ({
    ...input.basePayload,
  })),
}))

const hasOutputMock = vi.hoisted(() => ({
  hasCharacterAppearanceOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
}))

const prismaMock = vi.hoisted(() => ({
  characterAppearance: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  novelPromotionCharacter: {
    findFirst: vi.fn(),
  },
  novelPromotionLocation: {
    findUnique: vi.fn(),
  },
}))

const billingMock = vi.hoisted(() => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ billable: false })),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/task/has-output', () => hasOutputMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))

describe('api specific - novel promotion generate image art style', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.characterAppearance.findFirst.mockResolvedValue({ id: 'appearance-1' })
    prismaMock.characterAppearance.upsert.mockResolvedValue({ id: 'created-primary-appearance' })
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue({
      appearances: [{ id: 'appearance-1' }],
    })
  })

  it('accepts valid artStyle and forwards it into task payload', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/generate-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/generate-image',
      method: 'POST',
      body: {
        type: 'character',
        id: 'character-1',
        appearanceId: 'appearance-1',
        artStyle: 'realistic',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)

    const submitArg = submitTaskMock.mock.calls[0]?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload?.artStyle).toBe('realistic')
  })

  it('rejects invalid artStyle with invalid params', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/generate-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/generate-image',
      method: 'POST',
      body: {
        type: 'character',
        id: 'character-1',
        appearanceId: 'appearance-1',
        artStyle: 'anime',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('forwards requested count into task payload and dedupe key', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/generate-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/generate-image',
      method: 'POST',
      body: {
        type: 'character',
        id: 'character-1',
        appearanceId: 'appearance-1',
        count: 6,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)

    const submitArg = submitTaskMock.mock.calls[0]?.[0] as {
      payload?: Record<string, unknown>
      dedupeKey?: string
    } | undefined
    expect(submitArg?.payload?.count).toBe(4)
    expect(submitArg?.dedupeKey).toBe('image_character:appearance-1:4')
  })

  it('resolves the first character appearance when legacy callers omit appearanceId', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce({
      appearances: [{ id: 'appearance-primary' }],
    })

    const mod = await import('@/app/api/novel-promotion/[projectId]/generate-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/generate-image',
      method: 'POST',
      body: {
        type: 'character',
        id: 'character-1',
        count: 2,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)

    const submitArg = submitTaskMock.mock.calls[0]?.[0] as {
      targetId?: string
      payload?: Record<string, unknown>
      dedupeKey?: string
    } | undefined
    expect(submitArg?.targetId).toBe('appearance-primary')
    expect(submitArg?.payload?.appearanceId).toBe('appearance-primary')
    expect(submitArg?.dedupeKey).toBe('image_character:appearance-primary:2')
  })

  it('resolves appearanceIndex when legacy callers send an invalid appearanceId sentinel', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce({ id: 'appearance-index-2' })

    const mod = await import('@/app/api/novel-promotion/[projectId]/generate-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/generate-image',
      method: 'POST',
      body: {
        type: 'character',
        id: 'character-1',
        appearanceId: 'NaN',
        appearanceIndex: 2,
        count: 1,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)

    const submitArg = submitTaskMock.mock.calls[0]?.[0] as {
      targetId?: string
      payload?: Record<string, unknown>
      dedupeKey?: string
    } | undefined
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledWith({
      where: {
        characterId: 'character-1',
        appearanceIndex: 2,
        character: {
          novelPromotionProject: { projectId: 'project-1' },
        },
      },
      select: { id: true },
    })
    expect(submitArg?.targetId).toBe('appearance-index-2')
    expect(submitArg?.payload?.appearanceId).toBe('appearance-index-2')
    expect(submitArg?.dedupeKey).toBe('image_character:appearance-index-2:1')
  })

  it('rejects character generation when appearanceId does not belong to the character', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)

    const mod = await import('@/app/api/novel-promotion/[projectId]/generate-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/generate-image',
      method: 'POST',
      body: {
        type: 'character',
        id: 'character-1',
        appearanceId: 'other-appearance',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('creates a primary appearance when project character exists without appearance rows', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce({
      id: 'character-1',
      name: '女主角',
      introduction: '冷静敏锐的调查员',
      profileData: JSON.stringify({
        gender: '女性',
        age_range: '25岁左右',
        archetype: '调查员',
        era_period: '现代',
        social_class: '专业人士',
        visual_keywords: ['短发', '风衣', '警觉眼神'],
        identity_locks: ['短发轮廓稳定'],
      }),
      appearances: [],
    })

    const mod = await import('@/app/api/novel-promotion/[projectId]/generate-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/generate-image',
      method: 'POST',
      body: {
        type: 'character',
        id: 'character-1',
        appearanceId: 'character-1',
        count: 2,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)

    expect(prismaMock.characterAppearance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        characterId_appearanceIndex: {
          characterId: 'character-1',
          appearanceIndex: 0,
        },
      },
      create: expect.objectContaining({
        characterId: 'character-1',
        appearanceIndex: 0,
        changeReason: '初始形象',
      }),
      select: { id: true },
    }))
    const submitArg = submitTaskMock.mock.calls[0]?.[0] as {
      targetId?: string
      payload?: Record<string, unknown>
      dedupeKey?: string
    } | undefined
    expect(submitArg?.targetId).toBe('created-primary-appearance')
    expect(submitArg?.payload?.appearanceId).toBe('created-primary-appearance')
    expect(submitArg?.dedupeKey).toBe('image_character:created-primary-appearance:2')
  })
})

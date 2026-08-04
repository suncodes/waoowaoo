import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ locationModel: 'current-location-model', artStyle: 'japanese-anime' })),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
}))

const prismaMock = vi.hoisted(() => ({
  locationImage: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionLocation: {
    findUnique: vi.fn(),
    findMany: vi.fn(async () => []),
  },
}))

const sharedMock = vi.hoisted(() => ({
  generateProjectLabeledImageToStorage: vi.fn<(input: {
    prompt: string
    label: string
    modelId: string
    options?: { referenceImages?: string[]; aspectRatio?: string; generationOptions?: Record<string, unknown> }
  }) => Promise<string>>(async () => 'cos/location-generated-1.png'),
}))

const preparedPromptMock = vi.hoisted(() => ({
  requirePreparedPrompt: vi.fn(),
  attachPreparedPromptToSnapshot: vi.fn((snapshot: Record<string, unknown>, artifactId: string) => ({
    ...snapshot,
    preparedPromptArtifactId: artifactId,
  })),
}))

const runtimeArtifactMock = vi.hoisted(() => ({
  createOptionalGenerationSnapshotArtifact: vi.fn(async () => false),
}))

const storyboardReadinessMock = vi.hoisted(() => ({
  markStoryboardPanelsAwaitingAssetConfirmation: vi.fn(async () => []),
  reconcileStoryboardPanelsForAssetChanges: vi.fn(async () => ({
    reconciledPanelIds: [],
    promptFixedPanelIds: [],
    waitingPanelIds: [],
    failedPanels: [],
  })),
}))

const taskSubmitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(async () => ({ id: 'quality-task-1' })),
}))

vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/creative-quality/prepared-prompts', () => preparedPromptMock)
vi.mock('@/lib/creative-quality/runtime-artifacts', () => runtimeArtifactMock)
vi.mock('@/lib/novel-promotion/storyboard-readiness', () => storyboardReadinessMock)
vi.mock('@/lib/task/submitter', () => taskSubmitterMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    generateProjectLabeledImageToStorage: sharedMock.generateProjectLabeledImageToStorage,
  }
})

import { handleLocationImageTask } from '@/lib/workers/handlers/location-image-task-handler'

function buildPreparedPrompt(imageId: string, overrides: Record<string, unknown> = {}) {
  const artifactId = typeof overrides.artifactId === 'string'
    ? overrides.artifactId
    : `prepared-location-${imageId}`
  const modelKey = typeof overrides.modelKey === 'string'
    ? overrides.modelKey
    : 'prepared-location-model'
  const compiledPrompt = typeof overrides.compiledPrompt === 'string'
    ? overrides.compiledPrompt
    : `固定场景提示词 ${imageId}`
  const referenceImages = Array.isArray(overrides.referenceImages)
    ? overrides.referenceImages
    : ['cos/fixed-location-reference.png']
  const generationOptions = overrides.generationOptions && typeof overrides.generationOptions === 'object'
    ? overrides.generationOptions
    : { aspectRatio: '16:9', seed: 7 }
  return {
    artifactId,
    artifactType: 'prompt.asset_image.prepared',
    runId: 'run-prepared-location',
    kind: 'asset_image',
    refId: imageId,
    targetType: 'LocationImage',
    targetId: imageId,
    generationMode: null,
    generationOptions,
    snapshot: {
      schemaVersion: 1,
      snapshotType: 'asset_image_prompt',
      targetType: 'LocationImage',
      targetId: imageId,
      modelKey,
      promptTemplateId: 'asset-image-v2',
      promptHash: `prompt-hash-${imageId}`,
      specHash: `spec-hash-${imageId}`,
      inputHash: `input-hash-${imageId}`,
      assetVersionHash: null,
      referenceImages,
      promptSpec: { imageId },
      compiledPrompt,
      createdAt: '2026-08-03T00:00:00.000Z',
    },
    preparedAt: '2026-08-03T00:00:00.000Z',
  }
}

function buildJob(payload: Record<string, unknown>, targetId = 'location-image-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-location-image-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'LocationImage',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker location-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.locationImage.findUnique.mockResolvedValue({
      id: 'location-image-1',
      locationId: 'location-1',
      imageIndex: 0,
      description: '雨夜街道',
      availableSlots: JSON.stringify(['街道左侧靠墙的留白位置']),
      location: { name: 'Old Town' },
    })
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      name: 'Old Town',
      images: [
        {
          id: 'location-image-1',
          locationId: 'location-1',
          imageIndex: 0,
          description: '雨夜街道',
          availableSlots: JSON.stringify(['街道左侧靠墙的留白位置']),
        },
      ],
    })
    preparedPromptMock.requirePreparedPrompt.mockImplementation(async ({ artifactId }: { artifactId: string }) => {
      const imageId = artifactId.replace('prepared-location-', '') || 'location-image-1'
      return buildPreparedPrompt(imageId, { artifactId })
    })
  })

  it('缺少固定提示词版本时显式拒绝生成', async () => {
    await expect(handleLocationImageTask(buildJob({ imageIndex: 0 }))).rejects.toThrow(
      'PREPARED_PROMPT_REQUIRED: location image location-image-1',
    )
    expect(preparedPromptMock.requirePreparedPrompt).not.toHaveBeenCalled()
  })

  it('严格使用固定快照的模型、提示词、参考图和参数', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ locationModel: 'changed-after-preparation-model', artStyle: 'realistic' })
    const prepared = buildPreparedPrompt('location-image-1', {
      artifactId: 'prepared-location-location-image-1',
      modelKey: 'frozen-location-model',
      compiledPrompt: '这是已固定的场景图片提示词',
      referenceImages: ['cos/frozen-location-reference.png'],
      generationOptions: { aspectRatio: '4:5', seed: 123 },
    })
    preparedPromptMock.requirePreparedPrompt.mockResolvedValueOnce(prepared)

    const result = await handleLocationImageTask(buildJob({
      imageIndex: 0,
      preparedPromptArtifactId: prepared.artifactId,
      type: 'prop',
    }))

    expect(preparedPromptMock.requirePreparedPrompt).toHaveBeenCalledWith({
      artifactId: prepared.artifactId,
      projectId: 'project-1',
      targetId: 'location-image-1',
      refId: 'location-image-1',
      kind: 'asset_image',
      userId: 'user-1',
    })
    expect(sharedMock.generateProjectLabeledImageToStorage).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'frozen-location-model',
      prompt: '这是已固定的场景图片提示词',
      label: 'Old Town',
      targetId: 'location-image-1',
      options: expect.objectContaining({
        referenceImages: ['https://signed.example/cos/frozen-location-reference.png'],
        aspectRatio: '4:5',
        generationOptions: { aspectRatio: '4:5', seed: 123 },
      }),
    }))
    expect(result).toMatchObject({
      updated: 1,
      locationIds: ['location-1'],
      promptSnapshots: [expect.objectContaining({
        compiledPrompt: '这是已固定的场景图片提示词',
        preparedPromptArtifactId: prepared.artifactId,
      })],
    })
    expect(prismaMock.locationImage.update).toHaveBeenCalledWith({
      where: { id: 'location-image-1' },
      data: { imageUrl: 'cos/location-generated-1.png' },
    })
  })

  it('批量生成要求每个场景图都有对应的固定版本', async () => {
    prismaMock.locationImage.findUnique.mockResolvedValueOnce(null)
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValueOnce({
      id: 'location-1',
      name: 'Old Town',
      images: [
        { id: 'location-image-1', locationId: 'location-1', imageIndex: 0, description: '雨夜街道 A' },
        { id: 'location-image-2', locationId: 'location-1', imageIndex: 1, description: '雨夜街道 B' },
      ],
    })
    sharedMock.generateProjectLabeledImageToStorage
      .mockResolvedValueOnce('cos/location-generated-1.png')
      .mockResolvedValueOnce('cos/location-generated-2.png')

    const result = await handleLocationImageTask(buildJob({
      locationId: 'location-1',
      count: 2,
      preparedPromptArtifactIds: {
        'location-image-1': 'prepared-location-location-image-1',
        'location-image-2': 'prepared-location-location-image-2',
      },
    }, 'location-1'))

    expect(preparedPromptMock.requirePreparedPrompt).toHaveBeenCalledTimes(2)
    expect(preparedPromptMock.requirePreparedPrompt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      artifactId: 'prepared-location-location-image-2',
      targetId: 'location-image-2',
      refId: 'location-image-2',
    }))
    expect(sharedMock.generateProjectLabeledImageToStorage.mock.calls.map(([input]) => input.prompt)).toEqual([
      '固定场景提示词 location-image-1',
      '固定场景提示词 location-image-2',
    ])
    expect(result).toMatchObject({
      updated: 2,
      promptSnapshots: [
        expect.objectContaining({ preparedPromptArtifactId: 'prepared-location-location-image-1' }),
        expect.objectContaining({ preparedPromptArtifactId: 'prepared-location-location-image-2' }),
      ],
    })
  })
})

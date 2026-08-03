import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({
    characterModel: 'current-project-model',
    artStyle: 'realistic',
    artStyleReferenceEnabled: false,
  })),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
}))

const prismaMock = vi.hoisted(() => ({
  characterAppearance: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionCharacter: {
    findUnique: vi.fn(),
  },
}))

const sharedMock = vi.hoisted(() => ({
  generateProjectLabeledImageToStorage: vi.fn<(input: {
    prompt: string
    label: string
    modelId: string
    options?: { referenceImages?: string[]; aspectRatio?: string; generationOptions?: Record<string, unknown> }
  }) => Promise<string>>(async () => 'cos/character-generated-0.png'),
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

const panelBackfillMock = vi.hoisted(() => ({
  prepareReadyBackfilledPanelPrompts: vi.fn(async () => ({ prepared: [], failed: [] })),
}))

const taskSubmitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(async () => ({ id: 'quality-task-1' })),
}))

vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/creative-quality/prepared-prompts', () => preparedPromptMock)
vi.mock('@/lib/creative-quality/runtime-artifacts', () => runtimeArtifactMock)
vi.mock('@/lib/visual-production/panel-backfill-resume', () => panelBackfillMock)
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

import { handleCharacterImageTask } from '@/lib/workers/handlers/character-image-task-handler'

function buildPreparedPrompt(index: number, overrides: Record<string, unknown> = {}) {
  const artifactId = typeof overrides.artifactId === 'string'
    ? overrides.artifactId
    : `prepared-character-${index}`
  const modelKey = typeof overrides.modelKey === 'string'
    ? overrides.modelKey
    : 'prepared-character-model'
  const compiledPrompt = typeof overrides.compiledPrompt === 'string'
    ? overrides.compiledPrompt
    : `固定角色提示词 ${index}`
  const referenceImages = Array.isArray(overrides.referenceImages)
    ? overrides.referenceImages
    : ['cos/fixed-character-reference.png']
  const generationOptions = overrides.generationOptions && typeof overrides.generationOptions === 'object'
    ? overrides.generationOptions
    : { aspectRatio: '1:1', seed: 42 }
  return {
    artifactId,
    artifactType: 'prompt.asset_image.prepared',
    runId: 'run-prepared-character',
    kind: 'asset_image',
    refId: `appearance-2:${index}`,
    targetType: 'CharacterAppearance',
    targetId: 'appearance-2',
    generationMode: null,
    generationOptions,
    snapshot: {
      schemaVersion: 1,
      snapshotType: 'asset_image_prompt',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-2',
      modelKey,
      promptTemplateId: 'asset-image-v2',
      promptHash: `prompt-hash-${index}`,
      specHash: `spec-hash-${index}`,
      inputHash: `input-hash-${index}`,
      assetVersionHash: null,
      referenceImages,
      promptSpec: { index },
      compiledPrompt,
      createdAt: '2026-08-03T00:00:00.000Z',
    },
    preparedAt: '2026-08-03T00:00:00.000Z',
  }
}

function buildJob(payload: Record<string, unknown>, targetId = 'appearance-2'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-character-image-1',
      type: TASK_TYPE.IMAGE_CHARACTER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'CharacterAppearance',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker character-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: 'appearance-2',
      characterId: 'character-1',
      appearanceIndex: 1,
      descriptions: JSON.stringify(['角色描述A']),
      description: '角色描述A',
      imageUrls: JSON.stringify([]),
      selectedIndex: 0,
      imageUrl: null,
      changeReason: '战斗形态',
      character: { name: 'Hero' },
    })
    prismaMock.characterAppearance.findFirst.mockResolvedValue({
      imageUrl: 'cos/primary.png',
      imageUrls: JSON.stringify(['cos/primary.png']),
    })
    preparedPromptMock.requirePreparedPrompt.mockImplementation(async ({ artifactId }: { artifactId: string }) => {
      const index = Number(artifactId.split('-').at(-1)) || 0
      return buildPreparedPrompt(index, { artifactId })
    })
  })

  it('缺少固定提示词版本时显式拒绝生成', async () => {
    await expect(handleCharacterImageTask(buildJob({ imageIndex: 0 }))).rejects.toThrow(
      'PREPARED_PROMPT_REQUIRED: character image index 0',
    )
    expect(preparedPromptMock.requirePreparedPrompt).not.toHaveBeenCalled()
  })

  it('严格使用固定快照的模型、提示词、参考图和参数', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      characterModel: 'changed-after-preparation-model',
      artStyle: 'japanese-anime',
      artStyleReferenceEnabled: true,
    })
    const prepared = buildPreparedPrompt(0, {
      artifactId: 'prepared-character-0',
      modelKey: 'frozen-character-model',
      compiledPrompt: '这是已固定的角色图片提示词',
      referenceImages: ['cos/frozen-character-reference.png'],
      generationOptions: { aspectRatio: '3:2', seed: 99 },
    })
    preparedPromptMock.requirePreparedPrompt.mockResolvedValueOnce(prepared)

    const result = await handleCharacterImageTask(buildJob({
      imageIndex: 0,
      preparedPromptArtifactId: prepared.artifactId,
      artStyle: 'realistic',
    }))

    expect(preparedPromptMock.requirePreparedPrompt).toHaveBeenCalledWith({
      artifactId: prepared.artifactId,
      projectId: 'project-1',
      targetId: 'appearance-2',
      refId: 'appearance-2:0',
      kind: 'asset_image',
      userId: 'user-1',
    })
    expect(sharedMock.generateProjectLabeledImageToStorage).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'frozen-character-model',
      prompt: '这是已固定的角色图片提示词',
      label: 'Hero - 战斗形态',
      options: expect.objectContaining({
        referenceImages: ['https://signed.example/cos/frozen-character-reference.png'],
        aspectRatio: '3:2',
        generationOptions: { aspectRatio: '3:2', seed: 99 },
      }),
    }))
    expect(result).toMatchObject({
      appearanceId: 'appearance-2',
      imageCount: 1,
      imageUrl: 'cos/character-generated-0.png',
      promptSnapshots: [expect.objectContaining({
        compiledPrompt: '这是已固定的角色图片提示词',
        preparedPromptArtifactId: prepared.artifactId,
      })],
    })
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-2' },
      data: {
        imageUrls: JSON.stringify(['cos/character-generated-0.png']),
        imageUrl: 'cos/character-generated-0.png',
      },
    })
  })

  it('批量生成要求每个图片索引都有对应的固定版本', async () => {
    sharedMock.generateProjectLabeledImageToStorage
      .mockResolvedValueOnce('cos/character-generated-0.png')
      .mockResolvedValueOnce('cos/character-generated-1.png')
      .mockResolvedValueOnce('cos/character-generated-2.png')

    const result = await handleCharacterImageTask(buildJob({
      count: 3,
      preparedPromptArtifactIds: {
        0: 'prepared-character-0',
        1: 'prepared-character-1',
        2: 'prepared-character-2',
      },
    }))

    expect(preparedPromptMock.requirePreparedPrompt).toHaveBeenCalledTimes(3)
    expect(preparedPromptMock.requirePreparedPrompt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      artifactId: 'prepared-character-1',
      refId: 'appearance-2:1',
    }))
    expect(sharedMock.generateProjectLabeledImageToStorage).toHaveBeenCalledTimes(3)
    expect(sharedMock.generateProjectLabeledImageToStorage.mock.calls.map(([input]) => input.prompt)).toEqual([
      '固定角色提示词 0',
      '固定角色提示词 1',
      '固定角色提示词 2',
    ])
    expect(result).toMatchObject({
      imageCount: 3,
      promptSnapshots: [
        expect.objectContaining({ preparedPromptArtifactId: 'prepared-character-0' }),
        expect.objectContaining({ preparedPromptArtifactId: 'prepared-character-1' }),
        expect.objectContaining({ preparedPromptArtifactId: 'prepared-character-2' }),
      ],
    })
  })
})

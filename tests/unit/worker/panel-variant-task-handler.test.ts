import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import type { ProjectModelConfig } from '@/lib/config-service'
import type { VisualReference } from '@/lib/visual-production/references'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn<() => Promise<Partial<ProjectModelConfig>>>(async () => ({ storyboardModel: 'storyboard-model-1', artStyle: 'realistic' })),
  resolveImageSourceFromGeneration: vi.fn<(...args: unknown[]) => Promise<string>>(),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
  uploadImageSourceToCos: vi.fn(async () => 'cos/panel-variant-new.png'),
}))

const sharedMock = vi.hoisted(() => ({
  collectPanelVisualReferenceCandidates: vi.fn<() => Promise<VisualReference[]>>(async () => [{
    assetId: 'character-hero',
    renderId: 'render-hero',
    assetKind: 'character' as const,
    assetName: 'Hero',
    url: 'https://signed.example/ref-character.png',
    role: 'primary_identity' as const,
    usage: 'must_match' as const,
    weight: 1,
    source: 'requirement_plan' as const,
  }]),
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '16:9',
    characters: [{
      name: 'Hero',
      introduction: '主角',
      appearances: [{
        changeReason: 'default',
        imageUrls: JSON.stringify(['cos/hero-default.png']),
        imageUrl: 'cos/hero-default.png',
      }],
    }],
    locations: [{
      name: 'Old Town',
      images: [{
        isSelected: true,
        description: '老街中央留出明确人物站位',
        availableSlots: JSON.stringify([
          '街道左侧靠墙的留白位置',
        ]),
      }],
    }],
  })),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'panel-variant-prompt'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/logging/core', () => ({ logInfo: vi.fn() }))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    collectPanelVisualReferenceCandidates: sharedMock.collectPanelVisualReferenceCandidates,
    resolveNovelData: sharedMock.resolveNovelData,
  }
})
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_AGENT_SHOT_VARIANT_GENERATE: 'np_agent_shot_variant_generate' },
  buildPrompt: promptMock.buildPrompt,
}))

import { handlePanelVariantTask } from '@/lib/workers/handlers/panel-variant-task-handler'

function buildJob(
  payload: Record<string, unknown>,
  locale: TaskJobData['locale'] = 'zh',
): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-panel-variant-1',
      type: TASK_TYPE.PANEL_VARIANT,
      locale,
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-new',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker panel-variant-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    utilsMock.getProjectModels.mockResolvedValue({ storyboardModel: 'storyboard-model-1', artStyle: 'realistic' })
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValue('generated-variant-source')
    sharedMock.collectPanelVisualReferenceCandidates.mockResolvedValue([{
      assetId: 'character-hero',
      renderId: 'render-hero',
      assetKind: 'character',
      assetName: 'Hero',
      url: 'https://signed.example/ref-character.png',
      role: 'primary_identity',
      usage: 'must_match',
      weight: 1,
      source: 'requirement_plan',
    }])

    prismaMock.novelPromotionPanel.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'panel-new') {
        return {
          id: 'panel-new',
          storyboardId: 'storyboard-1',
          imageUrl: null,
          location: 'Old Town',
          characters: JSON.stringify([{ name: 'Hero', appearance: 'default', slot: '街道左侧靠墙的留白位置' }]),
        }
      }
      if (args.where.id === 'panel-source') {
        return {
          id: 'panel-source',
          storyboardId: 'storyboard-1',
          imageUrl: 'cos/panel-source.png',
          description: 'source description',
          shotType: 'medium',
          cameraMove: 'pan',
          location: 'Old Town',
          characters: JSON.stringify([{ name: 'Hero' }]),
        }
      }
      return null
    })
  })

  it('missing source/new panel ids -> explicit error', async () => {
    const job = buildJob({})
    await expect(handlePanelVariantTask(job)).rejects.toThrow('panel_variant missing newPanelId/sourcePanelId')
  })

  it('success path -> includes source panel image in referenceImages and persists new image', async () => {
    const payload = {
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
      variant: {
        title: '雨夜版本',
        description: '加强雨夜氛围',
      },
    }

    const result = await handlePanelVariantTask(buildJob(payload))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'storyboard-model-1',
        prompt: 'panel-variant-prompt',
        options: expect.objectContaining({
          aspectRatio: '16:9',
          referenceImages: [
            'https://signed.example/cos/panel-source.png',
            'https://signed.example/ref-character.png',
          ],
        }),
      }),
    )

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-new' },
      data: { imageUrl: 'cos/panel-variant-new.png' },
    })
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        characters_info: expect.stringContaining('固定位置：街道左侧靠墙的留白位置'),
        location_asset: expect.stringContaining('街道左侧靠墙的留白位置'),
      }),
    }))

    expect(result).toEqual({
      panelId: 'panel-new',
      storyboardId: 'storyboard-1',
      imageUrl: 'cos/panel-variant-new.png',
    })
  })

  it('respects reference asset toggles when character/location assets are disabled', async () => {
    const payload = {
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
      includeCharacterAssets: false,
      includeLocationAsset: false,
      variant: {
        title: '禁用资产版本',
        description: '只参考原镜头',
        video_prompt: '只参考原镜头',
      },
    }

    sharedMock.collectPanelVisualReferenceCandidates.mockResolvedValueOnce([])
    await handlePanelVariantTask(buildJob(payload))

    expect(sharedMock.collectPanelVisualReferenceCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        includeCharacterAssets: false,
        includeLocationAssets: false,
        includePropAssets: true,
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          referenceImages: ['https://signed.example/cos/panel-source.png'],
        }),
      }),
    )
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        character_assets: '未使用角色参考图',
        location_asset: '未使用场景参考图',
      }),
    }))
  })

  it('caps source, asset, and style references as one selection', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      storyboardModel: 'storyboard-model-1',
      artStyle: 'realistic',
      artStyleMode: 'custom',
      artStylePrompt: '电影感',
      customArtStyleReferenceImage: 'https://signed.example/style.png',
      artStyleReferenceEnabled: true,
    })
    sharedMock.collectPanelVisualReferenceCandidates.mockResolvedValueOnce([
      ...Array.from({ length: 4 }, (_, index) => ({
        assetId: `character-${index}`,
        renderId: `render-${index}`,
        assetKind: 'character' as const,
        assetName: `角色${index + 1}`,
        url: `https://signed.example/character-${index + 1}.png`,
        role: index === 0 ? 'primary_identity' as const : 'supporting_identity' as const,
        usage: 'must_match' as const,
        weight: index === 0 ? 1 : 0.75,
        source: 'requirement_plan' as const,
      })),
    ])

    await handlePanelVariantTask(buildJob({
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
      variant: { title: '超限版本', description: '测试参考图上限' },
    }))

    const generationCall = utilsMock.resolveImageSourceFromGeneration.mock.calls.at(-1)
    const options = generationCall?.[1] as { options: { referenceImages: string[] } } | undefined
    expect(options?.options.referenceImages).toHaveLength(4)
    expect(options?.options.referenceImages).toContain('https://signed.example/cos/panel-source.png')
  })

  it('uses localized slot labels in english variant prompts', async () => {
    const payload = {
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
      variant: {
        title: 'Rainy night version',
        description: 'Keep the same staging but change the mood',
        video_prompt: 'Keep the same staging but change the mood',
      },
    }

    await handlePanelVariantTask(buildJob(payload, 'en'))

    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'en',
      variables: expect.objectContaining({
        location_asset: expect.stringContaining('Available character slots:'),
      }),
    }))
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        location_asset: expect.not.stringContaining('可站位置：'),
      }),
    }))
  })
})

import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

type PanelRow = {
  id: string
  videoUrl: string | null
  imageUrl: string | null
  videoPrompt: string | null
  description: string | null
  firstLastFramePrompt: string | null
  duration: number | null
}

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
}))

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const withTaskLifecycleMock = vi.hoisted(() =>
  vi.fn(async (job: Job<TaskJobData>, handler: WorkerProcessor) => await handler(job)),
)

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  resolveLipSyncVideoSource: vi.fn(async () => 'https://provider.example/lipsync.mp4'),
  resolveVideoSourceFromGeneration: vi.fn<(...args: unknown[]) => Promise<{ url: string; actualVideoTokens?: number; downloadHeaders?: Record<string, string> }>>(async () => ({ url: 'https://provider.example/video.mp4' })),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
  uploadVideoSourceToCos: vi.fn(async () => 'cos/lip-sync/video.mp4'),
}))
const configServiceMock = vi.hoisted(() => ({
  getUserWorkflowConcurrencyConfig: vi.fn(async () => ({ analysis: 5, image: 5, video: 5 })),
}))
const concurrencyGateMock = vi.hoisted(() => ({
  withUserConcurrencyGate: vi.fn(async <T>(input: { run: () => Promise<T> }) => await input.run()),
}))
const artifactMock = vi.hoisted(() => ({
  createArtifact: vi.fn(async () => undefined),
}))
const audioMixMock = vi.hoisted(() => ({
  mixPanelAudioToStorage: vi.fn(async () => ({
    panelId: 'panel-1',
    outputKey: 'videos/audio-mixed/project-1/panel-1.mp4',
    outputUrl: '/m/audio-mixed-panel-1',
    videoDurationMs: 4000,
    audioDurationMs: 5200,
    outputDurationMs: 5200,
    voiceLineCount: 1,
  })),
}))
const panelSpeechMock = vi.hoisted(() => ({
  validatePanelSpeechReadyForVideo: vi.fn<() => Promise<{
    ready: boolean
    available: boolean
    speech: Record<string, unknown> | null
    reasons: string[]
    code: string
    voiceLineCount: number
  }>>(async () => ({
    ready: true,
    available: true,
    speech: null,
    reasons: [],
    code: 'NO_SPEECH',
    voiceLineCount: 0,
  })),
}))
const panelVideoReferenceAudioMock = vi.hoisted(() => ({
  resolvePanelVideoReferenceAudios: vi.fn<() => Promise<{
    referenceAudios: Array<Record<string, unknown>>
    referenceAudioSummary: Array<Record<string, unknown>>
  }>>(async () => ({ referenceAudios: [], referenceAudioSummary: [] })),
}))
const preparedPromptMock = vi.hoisted(() => ({
  requirePreparedPrompt: vi.fn(),
  attachPreparedPromptToSnapshot: vi.fn((snapshot: Record<string, unknown>, artifactId: string) => ({
    ...snapshot,
    preparedPromptArtifactId: artifactId,
  })),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  novelPromotionPanelSpeech: {
    findFirst: vi.fn(),
  },
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      void name
    }
  },
  Worker: class {
    constructor(name: string, processor: WorkerProcessor) {
      void name
      workerState.processor = processor
    }
  },
}))
vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  withTaskLifecycle: withTaskLifecycleMock,
}))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/model-config-contract', () => ({
  parseModelKeyStrict: vi.fn((modelKey: string | null | undefined) => {
    if (typeof modelKey === 'string' && modelKey.includes('::')) {
      const [provider, modelId] = modelKey.split('::')
      return { provider, modelId, modelKey }
    }
    return { provider: 'fal', modelId: modelKey || '', modelKey: modelKey || '' }
  }),
}))
vi.mock('@/lib/api-config', () => ({ getProviderConfig: vi.fn(async () => ({ apiKey: 'api-key' })) }))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/workers/user-concurrency-gate', () => concurrencyGateMock)
vi.mock('@/lib/run-runtime/service', () => artifactMock)
vi.mock('@/lib/novel-promotion/audio-mix', () => audioMixMock)
vi.mock('@/lib/novel-promotion/panel-speech', () => panelSpeechMock)
vi.mock('@/lib/workers/panel-video-reference-audio', () => panelVideoReferenceAudioMock)
vi.mock('@/lib/creative-quality/prepared-prompts', () => preparedPromptMock)

function buildPanel(overrides?: Partial<PanelRow>): PanelRow {
  return {
    id: 'panel-1',
    videoUrl: 'cos/base-video.mp4',
    imageUrl: 'cos/panel-image.png',
    videoPrompt: 'panel prompt',
    description: 'panel description',
    firstLastFramePrompt: null,
    duration: 5,
    ...(overrides || {}),
  }
}

function buildPreparedPrompt(overrides: Record<string, unknown> = {}) {
  const artifactId = typeof overrides.artifactId === 'string' ? overrides.artifactId : 'prepared-panel-video-1'
  const modelKey = typeof overrides.modelKey === 'string' ? overrides.modelKey : 'prepared-video-model'
  const compiledPrompt = typeof overrides.compiledPrompt === 'string' ? overrides.compiledPrompt : '已固定的视频提示词'
  const referenceImages = Array.isArray(overrides.referenceImages)
    ? overrides.referenceImages
    : ['cos/fixed-panel-image.png']
  const generationOptions = overrides.generationOptions && typeof overrides.generationOptions === 'object'
    ? overrides.generationOptions
    : { duration: 8, resolution: '720p', aspectRatio: '16:9' }
  const generationMode = overrides.generationMode === 'firstlastframe' ? 'firstlastframe' : 'normal'
  return {
    artifactId,
    artifactType: 'prompt.panel_video.prepared',
    runId: 'run-prepared-panel-video',
    kind: 'panel_video',
    refId: 'panel-1',
    targetType: 'NovelPromotionPanel',
    targetId: 'panel-1',
    generationMode,
    generationOptions,
    snapshot: {
      schemaVersion: 1,
      snapshotType: 'panel_video_prompt',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      modelKey,
      promptTemplateId: 'panel-video-v2',
      promptHash: 'panel-video-prompt-hash',
      specHash: 'panel-video-spec-hash',
      inputHash: 'panel-video-input-hash',
      assetVersionHash: 'panel-video-assets-hash',
      referenceImages,
      promptSpec: { motion: 'fixed' },
      compiledPrompt,
      createdAt: '2026-08-03T00:00:00.000Z',
    },
    preparedAt: '2026-08-03T00:00:00.000Z',
  }
}

function buildJob(params: {
  type: TaskJobData['type']
  payload?: Record<string, unknown>
  targetType?: string
  targetId?: string
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: params.type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: params.targetType ?? 'NovelPromotionPanel',
      targetId: params.targetId ?? 'panel-1',
      payload: params.payload ?? {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker video processor behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionPanelSpeech.findFirst.mockResolvedValue({
      id: 'speech-1',
      audio: { audioUrl: 'cos/line-1.mp3', audioDuration: 1200 },
    })
    preparedPromptMock.requirePreparedPrompt.mockImplementation(async ({ artifactId }: { artifactId: string }) => {
      return buildPreparedPrompt({ artifactId })
    })
    panelSpeechMock.validatePanelSpeechReadyForVideo.mockResolvedValue({
      ready: true,
      available: true,
      speech: null,
      reasons: [],
      code: 'NO_SPEECH',
      voiceLineCount: 0,
    })
    panelVideoReferenceAudioMock.resolvePanelVideoReferenceAudios.mockResolvedValue({
      referenceAudios: [],
      referenceAudioSummary: [],
    })

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_PANEL: 缺少固定提示词版本时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    await expect(processor!(buildJob({ type: TASK_TYPE.VIDEO_PANEL }))).rejects.toThrow(
      'PREPARED_PROMPT_REQUIRED: panel video generation requires a prepared prompt',
    )
    expect(preparedPromptMock.requirePreparedPrompt).not.toHaveBeenCalled()
  })

  it('VIDEO_PANEL: 严格使用固定快照并透传下载头', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    const prepared = buildPreparedPrompt({
      artifactId: 'prepared-panel-video-1',
      modelKey: 'frozen-video-model',
      compiledPrompt: '这是已固定的视频提示词',
      referenceImages: ['cos/frozen-first-frame.png'],
      generationOptions: { duration: 8, resolution: '720p', aspectRatio: '9:16' },
    })
    preparedPromptMock.requirePreparedPrompt.mockResolvedValueOnce(prepared)
    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      downloadHeaders: { Authorization: 'Bearer oa-key' },
    })

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        preparedPromptArtifactId: prepared.artifactId,
        videoModel: 'untrusted-runtime-model',
        generationOptions: { duration: 3 },
      },
    }))

    expect(preparedPromptMock.requirePreparedPrompt).toHaveBeenCalledWith({
      artifactId: prepared.artifactId,
      projectId: 'project-1',
      targetId: 'panel-1',
      kind: 'panel_video',
      userId: 'user-1',
    })
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'frozen-video-model',
        imageUrl: 'https://signed.example/cos/frozen-first-frame.png',
        options: expect.objectContaining({
          prompt: '这是已固定的视频提示词',
          duration: 8,
          resolution: '720p',
          aspectRatio: '9:16',
          generationMode: 'normal',
        }),
      }),
    )
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/video.mp4',
      'panel-video',
      'panel-1',
      { Authorization: 'Bearer oa-key' },
    )
  })

  it('VIDEO_PANEL: 将实际视频 token 用量透传到任务结果', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      actualVideoTokens: 108000,
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: { preparedPromptArtifactId: 'prepared-panel-video-1' },
    })) as { panelId: string; videoUrl: string; actualVideoTokens: number }

    expect(result).toEqual({
      panelId: 'panel-1',
      videoUrl: 'cos/lip-sync/video.mp4',
      actualVideoTokens: 108000,
    })
  })

  it('VIDEO_PANEL: 首尾帧模式只使用固定快照中的两张参考图', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    const prepared = buildPreparedPrompt({
      artifactId: 'prepared-panel-video-firstlast',
      generationMode: 'firstlastframe',
      referenceImages: ['cos/frozen-first-frame.png', 'cos/frozen-last-frame.png'],
    })
    preparedPromptMock.requirePreparedPrompt.mockResolvedValueOnce(prepared)

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: { preparedPromptArtifactId: prepared.artifactId },
    }))

    const generationCall = utilsMock.resolveVideoSourceFromGeneration.mock.calls[0]?.[1] as {
      options?: Record<string, unknown>
    }
    expect(generationCall.options).toMatchObject({
      generationMode: 'firstlastframe',
      lastFrameImageUrl: 'https://signed.example/cos/frozen-last-frame.png',
    })
  })

  it('VIDEO_PANEL: 已固定的原生音频参数决定参考音频输入，快照不携带 base64', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    const referenceAudio = {
      url: 'data:audio/wav;base64,AAAA',
      speaker: '旁白',
      source: 'speaker',
      provider: 'fal',
      voiceType: 'narration',
      mimeType: 'audio/wav',
      byteSize: 4,
      hash: 'audiohash',
      sourceKind: 'storage',
    }
    const prepared = buildPreparedPrompt({
      artifactId: 'prepared-panel-video-audio',
      compiledPrompt: '已固定的视频提示词，含原生音频计划',
      generationOptions: { generateAudio: true, duration: 4 },
    })
    preparedPromptMock.requirePreparedPrompt.mockResolvedValueOnce(prepared)
    panelVideoReferenceAudioMock.resolvePanelVideoReferenceAudios.mockResolvedValueOnce({
      referenceAudios: [referenceAudio],
      referenceAudioSummary: [{ hash: 'audiohash', sourceKind: 'storage' }],
    })

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        runId: 'run-video-audio',
        preparedPromptArtifactId: prepared.artifactId,
        generationOptions: { generateAudio: false },
      },
    }))

    const generationCall = utilsMock.resolveVideoSourceFromGeneration.mock.calls[0]?.[1] as {
      options?: Record<string, unknown>
    }
    expect(generationCall.options).toMatchObject({
      generateAudio: true,
      referenceAudios: [referenceAudio],
      prompt: '已固定的视频提示词，含原生音频计划',
    })
    const artifactPayload = artifactMock.createArtifact.mock.calls[0]?.[0]?.payload
    expect(JSON.stringify(artifactPayload)).not.toContain('base64')
  })

  it('LIP_SYNC: 缺少 panel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(null)

    await expect(processor!(buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: { speechId: 'speech-1' },
      targetId: 'panel-missing',
    }))).rejects.toThrow('Lip-sync panel not found')
  })

  it('LIP_SYNC: 正常路径写回 lipSyncVideoUrl 并清理 lipSyncTaskId', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const result = await processor!(buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: { speechId: 'speech-1', lipSyncModel: 'fal::lipsync-model' },
      targetId: 'panel-1',
    })) as { panelId: string; speechId: string; lipSyncVideoUrl: string }

    expect(result).toEqual({
      panelId: 'panel-1',
      speechId: 'speech-1',
      lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
    })
    expect(utilsMock.resolveLipSyncVideoSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        modelKey: 'fal::lipsync-model',
        audioDurationMs: 1200,
        videoDurationMs: 5000,
      }),
    )
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: { lipSyncVideoUrl: 'cos/lip-sync/video.mp4', lipSyncTaskId: null },
    })
  })

  it('AUDIO_MIX: 调用镜头音频混合服务并返回混音结果', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const result = await processor!(buildJob({
      type: TASK_TYPE.AUDIO_MIX,
      payload: { speechIds: ['speech-1'] },
      targetId: 'panel-1',
    }))

    expect(result).toEqual({
      panelId: 'panel-1',
      outputKey: 'videos/audio-mixed/project-1/panel-1.mp4',
      outputUrl: '/m/audio-mixed-panel-1',
      videoDurationMs: 4000,
      audioDurationMs: 5200,
      outputDurationMs: 5200,
      voiceLineCount: 1,
    })
    expect(audioMixMock.mixPanelAudioToStorage).toHaveBeenCalledWith(
      { projectId: 'project-1', panelId: 'panel-1', speechIds: ['speech-1'] },
      expect.any(Function),
    )
    expect(reportTaskProgressMock).toHaveBeenCalledWith(
      expect.anything(),
      95,
      expect.objectContaining({ stage: 'audio_mix_upload', outputUrl: '/m/audio-mixed-panel-1' }),
    )
  })

  it('未知任务类型: 显式报错', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    await expect(processor!(buildJob({ type: TASK_TYPE.AI_CREATE_CHARACTER }))).rejects.toThrow(
      'Unsupported video task type',
    )
  })
})

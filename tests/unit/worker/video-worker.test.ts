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
  imagePrompt?: string | null
  cameraMove?: string | null
  photographyRules?: unknown
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
  getProjectModels: vi.fn(async () => ({ videoRatio: '16:9' })),
  resolveLipSyncVideoSource: vi.fn(async () => 'https://provider.example/lipsync.mp4'),
  resolveVideoSourceFromGeneration: vi.fn<(...args: unknown[]) => Promise<{ url: string; actualVideoTokens?: number; downloadHeaders?: Record<string, string> }>>(async () => ({ url: 'https://provider.example/video.mp4' })),
  toSignedUrlIfCos: vi.fn((url: string | null) => (url ? `https://signed.example/${url}` : null)),
  uploadVideoSourceToCos: vi.fn(async () => 'cos/lip-sync/video.mp4'),
}))
const configServiceMock = vi.hoisted(() => ({
  getUserWorkflowConcurrencyConfig: vi.fn(async () => ({
    analysis: 5,
    image: 5,
    video: 5,
  })),
}))
const concurrencyGateMock = vi.hoisted(() => ({
  withUserConcurrencyGate: vi.fn(async <T>(input: {
    run: () => Promise<T>
  }) => await input.run()),
}))
const artifactMock = vi.hoisted(() => ({
  createArtifact: vi.fn(async (_input: Record<string, unknown>) => undefined),
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
const speechPlanMock = vi.hoisted(() => ({
  ensurePanelSpeechPlan: vi.fn<() => Promise<{ available: boolean; plan: Record<string, unknown> | null }>>(async () => ({ available: true, plan: null })),
  compileSpeechPlanPromptSection: vi.fn(() => ''),
  getPanelSpeechReferenceVoiceConfigs: vi.fn<() => Array<Record<string, unknown>>>(() => []),
  panelSpeechPlanHasSpeech: vi.fn(() => false),
}))
const outboundAudioMock = vi.hoisted(() => ({
  resolveOutboundAudioReferences: vi.fn<() => Promise<{ references: Array<Record<string, unknown>>; issues: unknown[] }>>(async () => ({ references: [], issues: [] })),
  summarizeOutboundAudioReferences: vi.fn((references: Array<Record<string, unknown>>) => (
    references.map((reference) => ({
      speaker: reference.speaker,
      source: reference.source,
      provider: reference.provider,
      voiceType: reference.voiceType,
      mimeType: reference.mimeType,
      byteSize: reference.byteSize,
      hash: reference.hash,
      sourceKind: reference.sourceKind,
    }))
  )),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  novelPromotionVoiceLine: {
    findUnique: vi.fn(),
  },
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      void name
    }

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
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
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn(async (input: string) => input),
}))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/model-config-contract', () => ({
  parseModelKeyStrict: vi.fn((modelKey: string | null | undefined) => {
    if (typeof modelKey === 'string' && modelKey.includes('::')) {
      const [provider, modelId] = modelKey.split('::')
      return { provider, modelId, modelKey }
    }
    return { provider: 'fal', modelId: modelKey || '', modelKey: modelKey || '' }
  }),
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'api-key' })),
}))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/workers/user-concurrency-gate', () => concurrencyGateMock)
vi.mock('@/lib/run-runtime/service', () => artifactMock)
vi.mock('@/lib/novel-promotion/audio-mix', () => audioMixMock)
vi.mock('@/lib/novel-promotion/speech-plan', () => speechPlanMock)
vi.mock('@/lib/media/outbound-audio', () => outboundAudioMock)

function buildPanel(overrides?: Partial<PanelRow>): PanelRow {
  return {
    id: 'panel-1',
    videoUrl: 'cos/base-video.mp4',
    imageUrl: 'cos/panel-image.png',
    videoPrompt: 'panel prompt',
    description: 'panel description',
    imagePrompt: 'panel image prompt',
    cameraMove: 'slow push',
    firstLastFramePrompt: null,
    duration: 5,
    ...(overrides || {}),
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
    prismaMock.novelPromotionVoiceLine.findUnique.mockResolvedValue({
      id: 'line-1',
      audioUrl: 'cos/line-1.mp3',
      audioDuration: 1200,
    })
    speechPlanMock.ensurePanelSpeechPlan.mockResolvedValue({ available: true, plan: null })
    speechPlanMock.compileSpeechPlanPromptSection.mockReturnValue('')
    speechPlanMock.getPanelSpeechReferenceVoiceConfigs.mockReturnValue([])
    speechPlanMock.panelSpeechPlanHasSpeech.mockReturnValue(false)
    outboundAudioMock.resolveOutboundAudioReferences.mockResolvedValue({ references: [], issues: [] })
    outboundAudioMock.summarizeOutboundAudioReferences.mockImplementation((references: Array<Record<string, unknown>>) => (
      references.map((reference) => ({
        speaker: reference.speaker,
        source: reference.source,
        provider: reference.provider,
        voiceType: reference.voiceType,
        mimeType: reference.mimeType,
        byteSize: reference.byteSize,
        hash: reference.hash,
        sourceKind: reference.sourceKind,
      }))
    ))

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_PANEL: 缺少 payload.videoModel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {},
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_MODEL_REQUIRED: payload.videoModel is required')
  })

  it('VIDEO_PANEL: 透传异步轮询返回的下载头到 COS 上传', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'openai-compatible:oa-1::sora-2',
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/video.mp4',
      'panel-video',
      'panel-1',
      {
        Authorization: 'Bearer oa-key',
      },
    )
  })

  it('VIDEO_PANEL: 将 Ark 返回的实际视频 token 用量透传到任务结果', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      actualVideoTokens: 108000,
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
    })

    const result = await processor!(job) as { panelId: string; videoUrl: string; actualVideoTokens: number }
    expect(result).toEqual({
      panelId: 'panel-1',
      videoUrl: 'cos/lip-sync/video.mp4',
      actualVideoTokens: 108000,
    })
  })

  it('VIDEO_PANEL: 使用结构化视频 prompt compiler 并写入快照 artifact', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      videoPrompt: '缓慢转头看向窗外',
      photographyRules: {
        shotSpec: {
          narrativeIntent: '建立人物压迫感',
          primarySubject: '尼摩船长',
          startState: '站在舷窗前',
          actionBeats: ['缓慢转头看向窗外', '窗外微光流动'],
          endState: '停在凝视深海的姿态',
          continuity: {
            fromPrevious: '承接潜艇外观',
            toNext: '进入驾驶舱细节',
            screenDirection: '看向画面右侧',
            lightingContinuity: '冷色舷窗光',
          },
        },
      },
    }))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        runId: 'run-video-1',
        videoModel: 'ark::doubao-seedance-2-0-260128',
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          prompt: expect.stringContaining('图生视频镜头'),
        }),
      }),
    )
    const generationCall = utilsMock.resolveVideoSourceFromGeneration.mock.calls[0]?.[1] as { options?: { prompt?: string } }
    expect(generationCall.options?.prompt).toContain('主体主运动：缓慢转头看向窗外')
    expect(generationCall.options?.prompt).toContain('不要改变角色身份')
    expect(artifactMock.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-video-1',
      stepKey: 'panel_video_prompt',
      artifactType: 'prompt.panel_video.snapshot',
      refId: 'panel-1',
    }))
  })

  it('VIDEO_PANEL: Seedance 2.0 原生音频传入参考音频并在快照中只记录摘要', async () => {
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
    speechPlanMock.ensurePanelSpeechPlan.mockResolvedValueOnce({
      available: true,
      plan: {
        mode: 'voiceover',
        status: 'ready',
        linesJson: [{ voiceLineId: 'line-1', lineIndex: 1, order: 1, speaker: '旁白', content: '海底的阴影逼近。' }],
        voiceConfigJson: [{ speaker: '旁白', hasVoice: true, source: 'speaker', provider: 'fal', previewAudioUrl: 'voice/ref.wav' }],
        updatedAt: new Date('2026-07-23T00:00:00.000Z'),
      },
    })
    speechPlanMock.getPanelSpeechReferenceVoiceConfigs.mockReturnValueOnce([
      { speaker: '旁白', hasVoice: true, source: 'speaker', provider: 'fal', voiceType: 'narration', previewAudioUrl: 'voice/ref.wav' },
    ])
    outboundAudioMock.resolveOutboundAudioReferences.mockResolvedValueOnce({
      references: [referenceAudio],
      issues: [],
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        runId: 'run-video-audio',
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          generateAudio: true,
          duration: 4,
        },
      },
    })

    await processor!(job)

    const generationCall = utilsMock.resolveVideoSourceFromGeneration.mock.calls[0]?.[1] as {
      options?: Record<string, unknown>
    }
    expect(generationCall.options).toMatchObject({
      generateAudio: true,
      referenceAudios: [referenceAudio],
    })

    const artifactPayload = artifactMock.createArtifact.mock.calls[0]?.[0]?.payload as {
      structuredReferences?: { referenceAudioSummary?: unknown }
    }
    expect(JSON.stringify(artifactPayload.structuredReferences?.referenceAudioSummary)).toContain('audiohash')
    expect(JSON.stringify(artifactPayload.structuredReferences?.referenceAudioSummary)).not.toContain('base64')
  })

  it('LIP_SYNC: 缺少 panel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(null)
    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: { voiceLineId: 'line-1' },
      targetId: 'panel-missing',
    })

    await expect(processor!(job)).rejects.toThrow('Lip-sync panel not found')
  })

  it('LIP_SYNC: 正常路径写回 lipSyncVideoUrl 并清理 lipSyncTaskId', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: {
        voiceLineId: 'line-1',
        lipSyncModel: 'fal::lipsync-model',
      },
      targetId: 'panel-1',
    })

    const result = await processor!(job) as { panelId: string; voiceLineId: string; lipSyncVideoUrl: string }
    expect(result).toEqual({
      panelId: 'panel-1',
      voiceLineId: 'line-1',
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
      data: {
        lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
        lipSyncTaskId: null,
      },
    })
  })

  it('AUDIO_MIX: 调用镜头音频混合服务并返回混音结果', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.AUDIO_MIX,
      payload: {
        voiceLineIds: ['line-1'],
      },
      targetId: 'panel-1',
    })

    const result = await processor!(job)
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
      {
        projectId: 'project-1',
        panelId: 'panel-1',
        voiceLineIds: ['line-1'],
      },
      expect.any(Function),
    )
    expect(reportTaskProgressMock).toHaveBeenCalledWith(
      expect.anything(),
      95,
      expect.objectContaining({
        stage: 'audio_mix_upload',
        outputUrl: '/m/audio-mixed-panel-1',
      }),
    )
  })

  it('未知任务类型: 显式报错', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const unsupportedJob = buildJob({
      type: TASK_TYPE.AI_CREATE_CHARACTER,
    })

    await expect(processor!(unsupportedJob)).rejects.toThrow('Unsupported video task type')
  })
})

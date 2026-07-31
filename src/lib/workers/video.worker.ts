import { Worker, type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'
import {
  assertTaskActive,
  getProjectModels,
  resolveLipSyncVideoSource,
  resolveVideoSourceFromGeneration,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
} from './utils'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { getProviderConfig } from '@/lib/api-config'
import { mergeProjectVideosToStorage } from '@/lib/novel-promotion/video-merge-export'
import { mixPanelAudioToStorage } from '@/lib/novel-promotion/audio-mix'
import { createCreativeQualityHash } from '@/lib/creative-quality/contracts'
import { createOptionalGenerationSnapshotArtifact } from '@/lib/creative-quality/runtime-artifacts'
import {
  buildPanelVideoGenerationSnapshot,
} from '@/lib/prompt-compiler/panel-video-prompt-compiler'
import {
  validatePanelSpeechReadyForVideo,
} from '@/lib/novel-promotion/panel-speech'
import { resolvePanelVideoReferenceAudios } from './panel-video-reference-audio'
import {
  buildPanelVideoPromptFromResolvedInputs,
  resolveNativeAudioRequest,
} from '@/lib/novel-promotion/panel-generation-prompt-preview'

type AnyObj = Record<string, unknown>
type VideoOptionValue = string | number | boolean
type VideoOptionMap = Record<string, VideoOptionValue>
type VideoGenerationMode = 'normal' | 'firstlastframe'
type PanelRecord = NonNullable<Awaited<ReturnType<typeof prisma.novelPromotionPanel.findUnique>>>

function toDurationMs(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value > 1000 ? Math.round(value) : Math.round(value * 1000)
}

function extractGenerationOptions(payload: AnyObj): VideoOptionMap {
  const fromEnvelope = payload.generationOptions
  if (!fromEnvelope || typeof fromEnvelope !== 'object' || Array.isArray(fromEnvelope)) {
    return {}
  }

  const next: VideoOptionMap = {}
  for (const [key, value] of Object.entries(fromEnvelope as Record<string, unknown>)) {
    if (key === 'aspectRatio') continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value
    }
  }
  return next
}

async function fetchPanelByStoryboardIndex(storyboardId: string, panelIndex: number) {
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId,
      panelIndex,
    },
  })
}

async function getPanelForVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj

  // 优先使用 targetType=NovelPromotionPanel 直接定位
  if (job.data.targetType === 'NovelPromotionPanel') {
    const panel = await prisma.novelPromotionPanel.findUnique({ where: { id: job.data.targetId } })
    if (!panel) throw new Error('Panel not found')
    return panel
  }

  // 兜底：通过 storyboardId + panelIndex 定位
  const storyboardId = payload.storyboardId
  const panelIndex = payload.panelIndex
  if (typeof storyboardId !== 'string' || !storyboardId || panelIndex === undefined || panelIndex === null) {
    throw new Error('Missing storyboardId/panelIndex for video task')
  }

  const panel = await fetchPanelByStoryboardIndex(storyboardId, Number(panelIndex))
  if (!panel) throw new Error('Panel not found by storyboardId/panelIndex')
  return panel
}

async function generateVideoForPanel(
  job: Job<TaskJobData>,
  panel: PanelRecord,
  payload: AnyObj,
  modelId: string,
  projectVideoRatio: string | null | undefined,
  generationOptions: VideoOptionMap,
): Promise<{ cosKey: string; generationMode: VideoGenerationMode; actualVideoTokens?: number }> {
  if (!panel.imageUrl) {
    throw new Error(`Panel ${panel.id} has no imageUrl`)
  }

  const firstLastFramePayload =
    typeof payload.firstLastFrame === 'object' && payload.firstLastFrame !== null
      ? (payload.firstLastFrame as AnyObj)
      : null
  const firstLastCustomPrompt = typeof firstLastFramePayload?.customPrompt === 'string' ? firstLastFramePayload.customPrompt : null
  const persistedFirstLastPrompt = firstLastFramePayload ? panel.firstLastFramePrompt : null
  const customPrompt = typeof payload.customPrompt === 'string' ? payload.customPrompt : null
  const sourcePrompt = firstLastCustomPrompt || persistedFirstLastPrompt || customPrompt || panel.videoPrompt || panel.description
  if (!sourcePrompt) {
    throw new Error(`Panel ${panel.id} has no video prompt`)
  }

  const sourceImageUrl = toSignedUrlIfCos(panel.imageUrl, 3600)
  if (!sourceImageUrl) {
    throw new Error(`Panel ${panel.id} image url invalid`)
  }
  let lastFrameImageUrl: string | undefined
  const generationMode: VideoGenerationMode = firstLastFramePayload ? 'firstlastframe' : 'normal'
  let model = modelId

  if (firstLastFramePayload) {
    model =
      typeof firstLastFramePayload.flModel === 'string' && firstLastFramePayload.flModel
        ? firstLastFramePayload.flModel
        : modelId
    const firstLastFrameCapabilities = resolveBuiltinCapabilitiesByModelKey('video', model)
    if (firstLastFrameCapabilities?.video?.firstlastframe !== true) {
      throw new Error(`VIDEO_FIRSTLASTFRAME_MODEL_UNSUPPORTED: ${model}`)
    }
    if (
      typeof firstLastFramePayload.lastFrameStoryboardId === 'string' &&
      firstLastFramePayload.lastFrameStoryboardId &&
      firstLastFramePayload.lastFramePanelIndex !== undefined
    ) {
      const lastPanel = await fetchPanelByStoryboardIndex(
        firstLastFramePayload.lastFrameStoryboardId,
        Number(firstLastFramePayload.lastFramePanelIndex),
      )
      if (lastPanel?.imageUrl) {
        const lastFrameUrl = toSignedUrlIfCos(lastPanel.imageUrl, 3600)
        if (lastFrameUrl) {
          lastFrameImageUrl = lastFrameUrl
        }
      }
    }
  }
  const panelSpeechState = await validatePanelSpeechReadyForVideo(panel.id)
  const panelSpeech = panelSpeechState.speech
  if (!panelSpeechState.ready) {
    throw new Error(`PANEL_SPEECH_NOT_READY: ${panel.id}: ${panelSpeechState.reasons.join(' | ')}`)
  }
  const requestedGenerateAudio = resolveNativeAudioRequest(model, generationOptions, panelSpeech)
  const { referenceAudios, referenceAudioSummary } = await resolvePanelVideoReferenceAudios({
    job,
    modelKey: model,
    requestedGenerateAudio,
    speech: panelSpeech,
  })
  const videoPromptCompilation = buildPanelVideoPromptFromResolvedInputs({
    panel: {
      id: panel.id,
      storyboardId: panel.storyboardId,
      panelIndex: panel.panelIndex,
      description: panel.description,
      videoPrompt: panel.videoPrompt,
      imagePrompt: panel.imagePrompt,
      cameraMove: panel.cameraMove,
      duration: panel.duration,
      photographyRules: (panel as { photographyRules?: unknown }).photographyRules,
      promptSpec: (panel as { promptSpec?: unknown }).promptSpec,
      referencePlan: (panel as { referencePlan?: unknown }).referencePlan,
      continuityGroupId: (panel as { continuityGroupId?: string | null }).continuityGroupId,
      generationRoute: (panel as { generationRoute?: string | null }).generationRoute,
      primarySubject: (panel as { primarySubject?: string | null }).primarySubject,
      imageUrl: panel.imageUrl,
    },
    locale: job.data.locale,
    generationMode,
    customPrompt: firstLastCustomPrompt || persistedFirstLastPrompt || customPrompt || null,
    lastFrameProvided: Boolean(lastFrameImageUrl),
    generationOptions,
    panelSpeech,
  })
  const promptSpec = videoPromptCompilation.promptSpec
  const prompt = videoPromptCompilation.compiledPrompt
  const promptSnapshot = buildPanelVideoGenerationSnapshot({
    targetId: panel.id,
    modelKey: model,
    promptTemplateId: videoPromptCompilation.promptTemplateId,
    referenceImages: [sourceImageUrl, ...(lastFrameImageUrl ? [lastFrameImageUrl] : [])],
    promptSpec,
    compiledPrompt: prompt,
    referenceAudioSummary,
    assetVersionHash: createCreativeQualityHash({
      sourceImageUrl,
      lastFrameImageUrl: lastFrameImageUrl || null,
      generationMode,
      referenceAudioSummary,
      panelSpeech: panelSpeech
        ? {
          speaker: panelSpeech.speaker,
          originalContent: panelSpeech.originalContent,
          deliveryContent: panelSpeech.deliveryContent,
          status: panelSpeech.status,
          voiceConfigJson: panelSpeech.voiceConfigJson,
          updatedAt: panelSpeech.updatedAt?.toISOString?.() || null,
        }
        : null,
    }),
  })
  await createOptionalGenerationSnapshotArtifact({
    job,
    stepKey: 'panel_video_prompt',
    artifactType: 'prompt.panel_video.snapshot',
    refId: panel.id,
    versionHash: promptSnapshot.promptHash,
    payload: promptSnapshot,
  })

  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: model,
    imageUrl: sourceImageUrl,
    options: {
      prompt,
      ...(projectVideoRatio ? { aspectRatio: projectVideoRatio } : {}),
      ...generationOptions,
      generationMode,
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
      ...(referenceAudios.length > 0 ? { referenceAudios } : {}),
      ...(lastFrameImageUrl ? { lastFrameImageUrl } : {}),
    },
  })

  let downloadHeaders: Record<string, string> | undefined
  const videoSource = generatedVideo.url
  if (generatedVideo.downloadHeaders) {
    downloadHeaders = generatedVideo.downloadHeaders
  } else if (typeof videoSource === 'string') {
    const parsedModel = parseModelKeyStrict(model)
    const isGoogleDownloadUrl = videoSource.includes('generativelanguage.googleapis.com/')
      && videoSource.includes('/files/')
      && videoSource.includes(':download')
    if (parsedModel?.provider === 'google' && isGoogleDownloadUrl) {
      const { apiKey } = await getProviderConfig(job.data.userId, 'google')
      downloadHeaders = { 'x-goog-api-key': apiKey }
    }
  }

  const cosKey = await uploadVideoSourceToCos(videoSource, 'panel-video', panel.id, downloadHeaders)
  return {
    cosKey,
    generationMode,
    ...(typeof generatedVideo.actualVideoTokens === 'number'
      ? { actualVideoTokens: generatedVideo.actualVideoTokens }
      : {}),
  }
}

async function handleVideoPanelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)

  const modelId = typeof payload.videoModel === 'string' ? payload.videoModel.trim() : ''
  if (!modelId) throw new Error('VIDEO_MODEL_REQUIRED: payload.videoModel is required')

  const panel = await getPanelForVideoTask(job)

  const generationOptions = extractGenerationOptions(payload)

  await reportTaskProgress(job, 10, {
    stage: 'generate_panel_video',
    panelId: panel.id,
  })

  const { cosKey, generationMode, actualVideoTokens } = await generateVideoForPanel(
    job,
    panel,
    payload,
    modelId,
    projectModels.videoRatio,
    generationOptions,
  )

  await assertTaskActive(job, 'persist_panel_video')
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      videoUrl: cosKey,
      videoGenerationMode: generationMode,
    },
  })

  return {
    panelId: panel.id,
    videoUrl: cosKey,
    ...(typeof actualVideoTokens === 'number' ? { actualVideoTokens } : {}),
  }
}

async function handleLipSyncTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const lipSyncModel = typeof payload.lipSyncModel === 'string' && payload.lipSyncModel.trim()
    ? payload.lipSyncModel.trim()
    : undefined

  let panel: PanelRecord | null = null
  if (job.data.targetType === 'NovelPromotionPanel') {
    panel = await prisma.novelPromotionPanel.findUnique({ where: { id: job.data.targetId } })
  }

  if (
    !panel &&
    typeof payload.storyboardId === 'string' &&
    payload.storyboardId &&
    payload.panelIndex !== undefined
  ) {
    panel = await fetchPanelByStoryboardIndex(payload.storyboardId, Number(payload.panelIndex))
  }

  if (!panel) throw new Error('Lip-sync panel not found')
  if (!panel.videoUrl) throw new Error('Panel has no base video')

  const speechId = typeof payload.speechId === 'string'
    ? payload.speechId
    : typeof payload.voiceLineId === 'string'
      ? payload.voiceLineId
      : null
  if (!speechId) throw new Error('Lip-sync task missing speechId')

  const speech = await prisma.novelPromotionPanelSpeech.findFirst({
    where: {
      id: speechId,
      panelId: panel.id,
    },
    select: {
      audio: {
        select: {
          audioUrl: true,
          audioDuration: true,
        },
      },
    },
  })
  if (!speech?.audio?.audioUrl) {
    throw new Error('Panel speech audioUrl not found')
  }

  const signedVideoUrl = toSignedUrlIfCos(panel.videoUrl, 7200)
  const signedAudioUrl = toSignedUrlIfCos(speech.audio.audioUrl, 7200)

  if (!signedVideoUrl || !signedAudioUrl) {
    throw new Error('Lip-sync input media url invalid')
  }

  await reportTaskProgress(job, 25, { stage: 'submit_lip_sync' })

  const source = await resolveLipSyncVideoSource(job, {
    userId: job.data.userId,
    videoUrl: signedVideoUrl,
    audioUrl: signedAudioUrl,
    audioDurationMs: typeof speech.audio.audioDuration === 'number' ? speech.audio.audioDuration : undefined,
    videoDurationMs: toDurationMs(panel.duration),
    modelKey: lipSyncModel,
  })

  await reportTaskProgress(job, 93, { stage: 'persist_lip_sync' })

  const cosKey = await uploadVideoSourceToCos(source, 'lip-sync', panel.id)

  await assertTaskActive(job, 'persist_lip_sync_video')
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      lipSyncVideoUrl: cosKey,
      lipSyncTaskId: null,
    },
  })

  return {
    panelId: panel.id,
    speechId,
    lipSyncVideoUrl: cosKey,
  }
}

function readPanelPreferences(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'boolean') {
      result[key] = raw
    }
  }
  return { ...result }
}

async function handleVideoMergeExportTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const episodeId = typeof payload.episodeId === 'string' && payload.episodeId.trim()
    ? payload.episodeId.trim()
    : job.data.episodeId || null

  const result = await mergeProjectVideosToStorage({
    projectId: job.data.projectId,
    episodeId,
    panelPreferences: readPanelPreferences(payload.panelPreferences),
    audioStrategy: payload.audioStrategy === 'none' ? 'none' : 'timeline',
    subtitleStrategy: payload.subtitleStrategy === 'burned' ? 'burned' : 'none',
    subtitleStyle: payload.subtitleStyle,
  }, async (progress, progressPayload) => {
    await reportTaskProgress(job, progress, progressPayload)
  })

  await reportTaskProgress(job, 95, {
    stage: 'merge_upload',
    outputUrl: result.outputUrl,
  })

  return {
    success: true,
    ...result,
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
}

async function handleAudioMixTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const panelId = job.data.targetType === 'NovelPromotionPanel'
    ? job.data.targetId
    : (typeof payload.panelId === 'string' ? payload.panelId.trim() : '')
  if (!panelId) {
    throw new Error('AUDIO_MIX_PANEL_ID_REQUIRED')
  }
  const speechIds = readStringArray(payload.speechIds)

  const result = await mixPanelAudioToStorage({
    projectId: job.data.projectId,
    panelId,
    speechIds: speechIds.length > 0 ? speechIds : readStringArray(payload.voiceLineIds),
  }, async (progress, progressPayload) => {
    await reportTaskProgress(job, progress, progressPayload)
  })

  await reportTaskProgress(job, 95, {
    stage: 'audio_mix_upload',
    outputUrl: result.outputUrl,
  })

  return { ...result }
}

async function processVideoTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.VIDEO_PANEL:
      return await handleVideoPanelTask(job)
    case TASK_TYPE.VIDEO_MERGE_EXPORT:
      return await handleVideoMergeExportTask(job)
    case TASK_TYPE.AUDIO_MIX:
      return await handleAudioMixTask(job)
    case TASK_TYPE.LIP_SYNC:
      return await handleLipSyncTask(job)
    default:
      throw new Error(`Unsupported video task type: ${job.data.type}`)
  }
}

export function createVideoWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VIDEO,
    async (job) => await withTaskLifecycle(job, async (taskJob) => {
      const workflowConcurrency = await getUserWorkflowConcurrencyConfig(taskJob.data.userId)
      return await withUserConcurrencyGate({
        scope: 'video',
        userId: taskJob.data.userId,
        limit: workflowConcurrency.video,
        run: async () => await processVideoTask(taskJob),
      })
    }),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_VIDEO || '4', 10) || 4,
    },
  )
}

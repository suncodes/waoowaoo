import { prisma } from '@/lib/prisma'
import { getProviderKey, resolveModelSelection } from '@/lib/api-config'
import { arkSeedanceSupportsReferenceAudio } from '@/lib/generators/ark'
import { getComfyUIReferenceAudioMaxCount } from '@/lib/comfyui/capabilities'

export const MAX_VIDEO_REFERENCE_AUDIO_COUNT = 3

export type VideoReferenceAudioErrorCode =
  | 'VIDEO_REFERENCE_AUDIO_IDS_INVALID'
  | 'VIDEO_REFERENCE_AUDIO_MAX_COUNT'
  | 'VIDEO_REFERENCE_AUDIO_UNSUPPORTED'
  | 'VIDEO_REFERENCE_AUDIO_MODEL_MAX_COUNT'
  | 'VIDEO_REFERENCE_AUDIO_NOT_FOUND'
  | 'VIDEO_REFERENCE_AUDIO_SOURCE_MISSING'
  | 'VIDEO_REFERENCE_AUDIO_SOURCE_UNSTABLE'

export class VideoReferenceAudioError extends Error {
  constructor(
    readonly code: VideoReferenceAudioErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'VideoReferenceAudioError'
  }
}

export interface VideoReferenceAudioSource {
  sourceId: string
  name: string
  url: string
  voiceType?: string
  language?: string
}

export interface VideoReferenceAudioSummary {
  sourceId: string
  name: string
  voiceType?: string
  language?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeVideoReferenceAudioIds(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new VideoReferenceAudioError(
      'VIDEO_REFERENCE_AUDIO_IDS_INVALID',
      '参考音频必须是音色库 ID 数组。',
    )
  }
  const ids = Array.from(new Set(value.map(readTrimmedString).filter(Boolean)))
  if (ids.length > MAX_VIDEO_REFERENCE_AUDIO_COUNT) {
    throw new VideoReferenceAudioError(
      'VIDEO_REFERENCE_AUDIO_MAX_COUNT',
      `参考音频最多只能选择 ${MAX_VIDEO_REFERENCE_AUDIO_COUNT} 条。`,
    )
  }
  return ids
}

export function summarizeVideoReferenceAudioSources(
  sources: VideoReferenceAudioSource[],
): VideoReferenceAudioSummary[] {
  return sources.map((source) => ({
    sourceId: source.sourceId,
    name: source.name,
    ...(source.voiceType ? { voiceType: source.voiceType } : {}),
    ...(source.language ? { language: source.language } : {}),
  }))
}

export function readVideoReferenceAudioSources(value: unknown): VideoReferenceAudioSource[] {
  const root = isRecord(value) ? value : {}
  const rawSources = Array.isArray(root.referenceAudioSources) ? root.referenceAudioSources : []
  const sources: VideoReferenceAudioSource[] = []
  const seenIds = new Set<string>()
  for (const rawSource of rawSources) {
    if (!isRecord(rawSource)) continue
    const sourceId = readTrimmedString(rawSource.sourceId)
    const name = readTrimmedString(rawSource.name)
    const url = readTrimmedString(rawSource.url)
    if (!sourceId || !name || !url || seenIds.has(sourceId)) continue
    seenIds.add(sourceId)
    sources.push({
      sourceId,
      name,
      url,
      ...(readTrimmedString(rawSource.voiceType) ? { voiceType: readTrimmedString(rawSource.voiceType) } : {}),
      ...(readTrimmedString(rawSource.language) ? { language: readTrimmedString(rawSource.language) } : {}),
    })
    if (sources.length >= MAX_VIDEO_REFERENCE_AUDIO_COUNT) break
  }
  return sources
}

/** 根据当前已验证的模型配置返回可安全提交的独立参考音频数量。 */
export async function resolveVideoReferenceAudioMaxCount(input: {
  userId: string
  modelKey: string
}): Promise<number> {
  const selection = await resolveModelSelection(input.userId, input.modelKey, 'video')
  const providerKey = getProviderKey(selection.provider).toLowerCase()
  if (providerKey === 'ark' && arkSeedanceSupportsReferenceAudio(selection.modelId)) {
    return MAX_VIDEO_REFERENCE_AUDIO_COUNT
  }
  if (providerKey === 'comfyui' && selection.comfyuiProfile) {
    return getComfyUIReferenceAudioMaxCount(selection.comfyuiProfile)
  }
  return 0
}

/**
 * 固定提示词前读取并校验音色库资产。快照只保存稳定源地址和非敏感摘要，
 * 不保存 data URL/base64；Worker 会在真正执行时再规范化音频字节。
 */
export async function resolveVideoReferenceAudioSources(input: {
  userId: string
  referenceAudioIds: string[]
  maxCount: number
}): Promise<VideoReferenceAudioSource[]> {
  if (input.referenceAudioIds.length === 0) return []
  if (input.maxCount < 1) {
    throw new VideoReferenceAudioError(
      'VIDEO_REFERENCE_AUDIO_UNSUPPORTED',
      '当前视频模型不支持独立参考音频。',
    )
  }
  if (input.referenceAudioIds.length > input.maxCount) {
    throw new VideoReferenceAudioError(
      'VIDEO_REFERENCE_AUDIO_MODEL_MAX_COUNT',
      `当前视频模型最多支持 ${input.maxCount} 条参考音频。`,
    )
  }

  const voices = await prisma.globalVoice.findMany({
    where: {
      userId: input.userId,
      id: { in: input.referenceAudioIds },
    },
    select: {
      id: true,
      name: true,
      voiceType: true,
      language: true,
      customVoiceUrl: true,
      customVoiceMedia: {
        select: { storageKey: true },
      },
    },
  })
  const byId = new Map(voices.map((voice) => [voice.id, voice] as const))
  const sources: VideoReferenceAudioSource[] = []
  for (const id of input.referenceAudioIds) {
    const voice = byId.get(id)
    if (!voice) {
      throw new VideoReferenceAudioError(
        'VIDEO_REFERENCE_AUDIO_NOT_FOUND',
        '所选参考音频不存在，或不属于当前用户。',
      )
    }
    const url = readTrimmedString(voice.customVoiceMedia?.storageKey) || readTrimmedString(voice.customVoiceUrl)
    if (!url) {
      throw new VideoReferenceAudioError(
        'VIDEO_REFERENCE_AUDIO_SOURCE_MISSING',
        `参考音频“${readTrimmedString(voice.name) || id}”缺少可用的原始文件。`,
      )
    }
    if (/^data:/i.test(url) || /;base64,/i.test(url)) {
      throw new VideoReferenceAudioError(
        'VIDEO_REFERENCE_AUDIO_SOURCE_UNSTABLE',
        `参考音频“${readTrimmedString(voice.name) || id}”仍是临时数据，需重新上传到音色库后再使用。`,
      )
    }
    const name = readTrimmedString(voice.name) || `Audio ${sources.length + 1}`
    sources.push({
      sourceId: voice.id,
      name,
      url,
      ...(readTrimmedString(voice.voiceType) ? { voiceType: readTrimmedString(voice.voiceType) } : {}),
      ...(readTrimmedString(voice.language) ? { language: readTrimmedString(voice.language) } : {}),
    })
  }
  return sources
}

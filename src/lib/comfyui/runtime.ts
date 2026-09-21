import type { GenerateOptions, GenerateResult } from '@/lib/generators/base'
import { loadImageResource } from '@/lib/media/outbound-image'
import type { OutboundAudioReference } from '@/lib/media/outbound-audio'
import {
  submitComfyUIWorkflow,
  uploadComfyUIInputFile,
  uploadComfyUIImage,
} from './client'
import { formatComfyUIExternalId } from './external-id'
import {
  getComfyUIScalarInputMapping,
  isComfyUICollectionInputMapping,
  patchComfyUIWorkflow,
  type ComfyUIProfile,
} from './profile'

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseDimensions(value: unknown): { width?: number; height?: number } {
  if (typeof value !== 'string') return {}
  const match = value.trim().match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i)
  if (!match) return {}
  const width = Number.parseInt(match[1] || '', 10)
  const height = Number.parseInt(match[2] || '', 10)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return {}
  return { width, height }
}

function buildMappedValues(input: {
  prompt: string
  image?: string
  lastFrameImage?: string
  referenceAudios?: string[]
  options?: GenerateOptions
}): Record<string, unknown> {
  const options = input.options || {}
  const directWidth = readFiniteNumber(options.width)
  const directHeight = readFiniteNumber(options.height)
  const dimensions = parseDimensions(options.size)
  const resolutionDimensions = parseDimensions(options.resolution)
  const width = directWidth ?? dimensions.width ?? resolutionDimensions.width
  const height = directHeight ?? dimensions.height ?? resolutionDimensions.height

  const values: Record<string, unknown> = {
    prompt: input.prompt,
    ...(input.image ? { image: input.image } : {}),
    ...(input.lastFrameImage ? { lastFrameImage: input.lastFrameImage } : {}),
    ...(input.referenceAudios ? { referenceAudios: input.referenceAudios } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  }

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    values[`options.${key}`] = value
  }
  return values
}

async function uploadSingleReferenceImage(input: {
  baseUrl: string
  referenceImages: string[] | undefined
  profile: ComfyUIProfile
  required: boolean
}): Promise<string | undefined> {
  const references = (input.referenceImages || []).filter((value) => typeof value === 'string' && value.trim())
  if (references.length > 1) {
    throw new Error('INVALID_PARAMS: COMFYUI_MULTIPLE_REFERENCE_IMAGES_UNSUPPORTED')
  }

  const hasImageMapping = !!getComfyUIScalarInputMapping(input.profile, 'image')
  if (references.length === 0) {
    if (input.required) {
      throw new Error('INVALID_PARAMS: COMFYUI_REFERENCE_IMAGE_REQUIRED')
    }
    return undefined
  }
  if (!hasImageMapping) {
    throw new Error('INVALID_PARAMS: COMFYUI_IMAGE_MAPPING_REQUIRED')
  }

  const resource = await loadImageResource(references[0])
  return await uploadComfyUIImage({
    baseUrl: input.baseUrl,
    bytes: resource.bytes,
    mimeType: resource.mimeType,
    filename: resource.filename,
  })
}

async function uploadReferenceImage(input: {
  baseUrl: string
  imageUrl: string
}): Promise<string> {
  const resource = await loadImageResource(input.imageUrl)
  return await uploadComfyUIImage({
    baseUrl: input.baseUrl,
    bytes: resource.bytes,
    mimeType: resource.mimeType,
    filename: resource.filename,
  })
}

function decodeReferenceAudio(value: unknown): { bytes: Buffer; mimeType: 'audio/mpeg' | 'audio/wav' } {
  if (typeof value !== 'string') {
    throw new Error('INVALID_PARAMS: COMFYUI_REFERENCE_AUDIO_DATA_URL_REQUIRED')
  }
  const match = value.trim().match(/^data:(audio\/(?:mpeg|mp3|wav|wave|x-wav));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) {
    throw new Error('INVALID_PARAMS: COMFYUI_REFERENCE_AUDIO_DATA_URL_REQUIRED')
  }
  const normalizedMimeType = match[1].toLowerCase()
  const mimeType: 'audio/mpeg' | 'audio/wav' = normalizedMimeType === 'audio/mpeg' || normalizedMimeType === 'audio/mp3'
    ? 'audio/mpeg'
    : 'audio/wav'
  const encoded = match[2].replace(/\s/g, '')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) {
    throw new Error('INVALID_PARAMS: COMFYUI_REFERENCE_AUDIO_SIZE_INVALID')
  }
  return { bytes, mimeType }
}

function referenceAudioFilename(reference: OutboundAudioReference, index: number, mimeType: 'audio/mpeg' | 'audio/wav'): string {
  const hash = typeof reference.hash === 'string' && /^[a-f0-9]{8,64}$/i.test(reference.hash)
    ? reference.hash.toLowerCase()
    : `audio-${index + 1}`
  return `reference-audio-${index + 1}-${hash}.${mimeType === 'audio/wav' ? 'wav' : 'mp3'}`
}

async function uploadReferenceAudios(input: {
  baseUrl: string
  profile: ComfyUIProfile
  referenceAudios?: OutboundAudioReference[]
}): Promise<string[] | undefined> {
  const references = input.referenceAudios || []
  if (references.length === 0) return undefined

  const mapping = input.profile.inputMappings.referenceAudios
  if (!mapping || !isComfyUICollectionInputMapping(mapping)) {
    throw new Error('INVALID_PARAMS: COMFYUI_REFERENCE_AUDIO_MAPPING_REQUIRED')
  }
  if (references.length > mapping.itemMappings.length) {
    throw new Error('INVALID_PARAMS: COMFYUI_REFERENCE_AUDIO_EXCEEDS_PROFILE_CAPACITY')
  }

  const uploaded: string[] = []
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index]
    const resource = decodeReferenceAudio(reference?.url)
    uploaded.push(await uploadComfyUIInputFile({
      baseUrl: input.baseUrl,
      bytes: resource.bytes,
      mimeType: resource.mimeType,
      filename: referenceAudioFilename(reference, index, resource.mimeType),
    }))
  }
  return uploaded
}

async function submitComfyUITask(input: {
  baseUrl: string
  providerId: string
  profile: ComfyUIProfile
  prompt: string
  image?: string
  lastFrameImage?: string
  referenceAudios?: string[]
  options?: GenerateOptions
}): Promise<GenerateResult> {
  const workflow = patchComfyUIWorkflow(
    input.profile,
    buildMappedValues({
      prompt: input.prompt,
      image: input.image,
      lastFrameImage: input.lastFrameImage,
      referenceAudios: input.referenceAudios,
      options: input.options,
    }),
  )
  const promptId = await submitComfyUIWorkflow(input.baseUrl, workflow)
  return {
    success: true,
    async: true,
    requestId: promptId,
    externalId: formatComfyUIExternalId({
      mediaType: input.profile.mediaType,
      providerId: input.providerId,
      outputNodeId: input.profile.outputNodeId,
      promptId,
    }),
  }
}

export async function generateComfyUIImage(input: {
  baseUrl: string
  providerId: string
  profile: ComfyUIProfile
  prompt: string
  referenceImages?: string[]
  options?: GenerateOptions
}): Promise<GenerateResult> {
  if (input.profile.mediaType !== 'image') {
    throw new Error('INVALID_PARAMS: COMFYUI_PROFILE_MEDIA_TYPE_MISMATCH')
  }

  const imageMapping = getComfyUIScalarInputMapping(input.profile, 'image')
  const uploadedImage = await uploadSingleReferenceImage({
    baseUrl: input.baseUrl,
    referenceImages: input.referenceImages,
    profile: input.profile,
    required: imageMapping?.required === true,
  })

  return await submitComfyUITask({
    baseUrl: input.baseUrl,
    providerId: input.providerId,
    profile: input.profile,
    prompt: input.prompt,
    image: uploadedImage,
    options: input.options,
  })
}

export async function generateComfyUIVideo(input: {
  baseUrl: string
  providerId: string
  profile: ComfyUIProfile
  imageUrl: string
  lastFrameImageUrl?: string
  referenceAudios?: OutboundAudioReference[]
  prompt: string
  options?: GenerateOptions
}): Promise<GenerateResult> {
  if (input.profile.mediaType !== 'video') {
    throw new Error('INVALID_PARAMS: COMFYUI_PROFILE_MEDIA_TYPE_MISMATCH')
  }
  const imageMapping = getComfyUIScalarInputMapping(input.profile, 'image')
  const lastFrameImageMapping = getComfyUIScalarInputMapping(input.profile, 'lastFrameImage')
  if (!imageMapping) {
    throw new Error('INVALID_PARAMS: COMFYUI_IMAGE_MAPPING_REQUIRED')
  }
  if (!input.imageUrl.trim()) {
    throw new Error('INVALID_PARAMS: COMFYUI_REFERENCE_IMAGE_REQUIRED')
  }

  if (input.lastFrameImageUrl?.trim() && !lastFrameImageMapping) {
    throw new Error('INVALID_PARAMS: COMFYUI_LAST_FRAME_IMAGE_MAPPING_REQUIRED')
  }
  if (lastFrameImageMapping?.required === true && !input.lastFrameImageUrl?.trim()) {
    throw new Error('INVALID_PARAMS: COMFYUI_LAST_FRAME_IMAGE_REQUIRED')
  }

  const uploadedImage = await uploadReferenceImage({
    baseUrl: input.baseUrl,
    imageUrl: input.imageUrl,
  })
  const uploadedLastFrameImage = input.lastFrameImageUrl?.trim()
    ? await uploadReferenceImage({
      baseUrl: input.baseUrl,
      imageUrl: input.lastFrameImageUrl,
    })
    : undefined
  const uploadedReferenceAudios = await uploadReferenceAudios({
    baseUrl: input.baseUrl,
    profile: input.profile,
    referenceAudios: input.referenceAudios,
  })

  return await submitComfyUITask({
    baseUrl: input.baseUrl,
    providerId: input.providerId,
    profile: input.profile,
    prompt: input.prompt,
    image: uploadedImage,
    lastFrameImage: uploadedLastFrameImage,
    referenceAudios: uploadedReferenceAudios,
    options: input.options,
  })
}

/**
 * 提交不含图片输入映射的 ComfyUI 文生视频工作流。
 *
 * 不上传图片，避免把图生视频输入误注入文生视频工作流。
 */
export async function generateComfyUITextToVideo(input: {
  baseUrl: string
  providerId: string
  profile: ComfyUIProfile
  referenceAudios?: OutboundAudioReference[]
  prompt: string
  options?: GenerateOptions
}): Promise<GenerateResult> {
  if (input.profile.mediaType !== 'video') {
    throw new Error('INVALID_PARAMS: COMFYUI_PROFILE_MEDIA_TYPE_MISMATCH')
  }
  if (getComfyUIScalarInputMapping(input.profile, 'image')) {
    throw new Error('INVALID_PARAMS: COMFYUI_TEXT_TO_VIDEO_IMAGE_MAPPING_UNSUPPORTED')
  }

  const uploadedReferenceAudios = await uploadReferenceAudios({
    baseUrl: input.baseUrl,
    profile: input.profile,
    referenceAudios: input.referenceAudios,
  })

  return await submitComfyUITask({
    baseUrl: input.baseUrl,
    providerId: input.providerId,
    profile: input.profile,
    prompt: input.prompt,
    referenceAudios: uploadedReferenceAudios,
    options: input.options,
  })
}

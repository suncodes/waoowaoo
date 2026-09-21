import type { GenerateOptions, GenerateResult } from '@/lib/generators/base'
import { loadImageResource } from '@/lib/media/outbound-image'
import {
  submitComfyUIWorkflow,
  uploadComfyUIImage,
} from './client'
import { formatComfyUIExternalId } from './external-id'
import {
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

  const hasImageMapping = !!input.profile.inputMappings.image
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

async function submitComfyUITask(input: {
  baseUrl: string
  providerId: string
  profile: ComfyUIProfile
  prompt: string
  image?: string
  options?: GenerateOptions
}): Promise<GenerateResult> {
  const workflow = patchComfyUIWorkflow(
    input.profile,
    buildMappedValues({
      prompt: input.prompt,
      image: input.image,
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

  const imageMapping = input.profile.inputMappings.image
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
  prompt: string
  options?: GenerateOptions
}): Promise<GenerateResult> {
  if (input.profile.mediaType !== 'video') {
    throw new Error('INVALID_PARAMS: COMFYUI_PROFILE_MEDIA_TYPE_MISMATCH')
  }
  if (!input.profile.inputMappings.image) {
    throw new Error('INVALID_PARAMS: COMFYUI_IMAGE_MAPPING_REQUIRED')
  }
  if (!input.imageUrl.trim()) {
    throw new Error('INVALID_PARAMS: COMFYUI_REFERENCE_IMAGE_REQUIRED')
  }

  const resource = await loadImageResource(input.imageUrl)
  const uploadedImage = await uploadComfyUIImage({
    baseUrl: input.baseUrl,
    bytes: resource.bytes,
    mimeType: resource.mimeType,
    filename: resource.filename,
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

/**
 * 提交不含图片输入映射的 ComfyUI 文生视频工作流。
 *
 * 不上传图片，避免把图生视频输入误注入文生视频工作流。
 */
export async function generateComfyUITextToVideo(input: {
  baseUrl: string
  providerId: string
  profile: ComfyUIProfile
  prompt: string
  options?: GenerateOptions
}): Promise<GenerateResult> {
  if (input.profile.mediaType !== 'video') {
    throw new Error('INVALID_PARAMS: COMFYUI_PROFILE_MEDIA_TYPE_MISMATCH')
  }
  if (input.profile.inputMappings.image) {
    throw new Error('INVALID_PARAMS: COMFYUI_TEXT_TO_VIDEO_IMAGE_MAPPING_UNSUPPORTED')
  }

  return await submitComfyUITask({
    baseUrl: input.baseUrl,
    providerId: input.providerId,
    profile: input.profile,
    prompt: input.prompt,
    options: input.options,
  })
}

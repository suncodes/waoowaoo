import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyUIProfile } from '@/lib/comfyui/profile'
import { parseComfyUIExternalId } from '@/lib/comfyui/external-id'

const loadImageResourceMock = vi.hoisted(() => vi.fn(async () => ({
  bytes: Buffer.from('image-bytes'),
  mimeType: 'image/png',
  filename: 'reference.png',
})))
const uploadComfyUIImageMock = vi.hoisted(() => vi.fn(async () => 'input/reference.png'))
const submitComfyUIWorkflowMock = vi.hoisted(() => vi.fn(async () => 'prompt-123'))

vi.mock('@/lib/media/outbound-image', () => ({
  loadImageResource: loadImageResourceMock,
}))

vi.mock('@/lib/comfyui/client', () => ({
  uploadComfyUIImage: uploadComfyUIImageMock,
  submitComfyUIWorkflow: submitComfyUIWorkflowMock,
}))

import {
  generateComfyUIImage,
  generateComfyUITextToVideo,
  generateComfyUIVideo,
} from '@/lib/comfyui/runtime'

const imageProfile: ComfyUIProfile = {
  version: 1,
  mediaType: 'image',
  workflow: {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'template prompt' } },
    '2': { class_type: 'KSampler', inputs: { steps: 20, seed: 1 } },
    '3': { class_type: 'LoadImage', inputs: { image: 'template.png' } },
    '9': { class_type: 'SaveImage', inputs: { images: ['2', 0] } },
  },
  inputMappings: {
    prompt: { nodeId: '1', inputName: 'text', required: true },
    'options.steps': { nodeId: '2', inputName: 'steps' },
    image: { nodeId: '3', inputName: 'image' },
  },
  outputNodeId: '9',
}

const videoProfile: ComfyUIProfile = {
  version: 1,
  mediaType: 'video',
  workflow: {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '3': { class_type: 'LoadImage', inputs: { image: '' } },
    '4': { class_type: 'VideoSampler', inputs: { fps: 12 } },
    '9': { class_type: 'SaveAnimatedWEBP', inputs: { images: ['4', 0] } },
  },
  inputMappings: {
    prompt: { nodeId: '1', inputName: 'text', required: true },
    image: { nodeId: '3', inputName: 'image', required: true },
    'options.fps': { nodeId: '4', inputName: 'fps' },
  },
  outputNodeId: '9',
}

const textToVideoProfile: ComfyUIProfile = {
  version: 1,
  mediaType: 'video',
  workflow: {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '4': { class_type: 'VideoSampler', inputs: { fps: 12 } },
    '9': { class_type: 'SaveAnimatedWEBP', inputs: { images: ['4', 0] } },
  },
  inputMappings: {
    prompt: { nodeId: '1', inputName: 'text', required: true },
    'options.fps': { nodeId: '4', inputName: 'fps' },
  },
  outputNodeId: '9',
}

describe('ComfyUI runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadImageResourceMock.mockResolvedValue({
      bytes: Buffer.from('image-bytes'),
      mimeType: 'image/png',
      filename: 'reference.png',
    })
    uploadComfyUIImageMock.mockResolvedValue('input/reference.png')
    submitComfyUIWorkflowMock.mockResolvedValue('prompt-123')
  })

  it('uploads one image reference, patches a cloned workflow, and submits it', async () => {
    const result = await generateComfyUIImage({
      baseUrl: 'http://10.0.0.12:8188',
      providerId: 'comfyui',
      profile: imageProfile,
      prompt: 'a red fox',
      referenceImages: ['https://storage.example/reference.png'],
      options: { steps: 28 },
    })

    expect(loadImageResourceMock).toHaveBeenCalledWith('https://storage.example/reference.png')
    expect(uploadComfyUIImageMock).toHaveBeenCalledWith({
      baseUrl: 'http://10.0.0.12:8188',
      bytes: Buffer.from('image-bytes'),
      mimeType: 'image/png',
      filename: 'reference.png',
    })
    expect(submitComfyUIWorkflowMock).toHaveBeenCalledWith(
      'http://10.0.0.12:8188',
      expect.objectContaining({
        '1': expect.objectContaining({ inputs: expect.objectContaining({ text: 'a red fox' }) }),
        '2': expect.objectContaining({ inputs: expect.objectContaining({ steps: 28 }) }),
        '3': expect.objectContaining({ inputs: expect.objectContaining({ image: 'input/reference.png' }) }),
      }),
    )
    expect(imageProfile.workflow['1']?.inputs.text).toBe('template prompt')
    expect(imageProfile.workflow['3']?.inputs.image).toBe('template.png')
    expect(result.success).toBe(true)
    expect(result.async).toBe(true)
    expect(parseComfyUIExternalId(result.externalId || '')).toMatchObject({
      type: 'IMAGE',
      providerId: 'comfyui',
      outputNodeId: '9',
      promptId: 'prompt-123',
    })
  })

  it('uploads the source image and submits a video workflow through the same client', async () => {
    const result = await generateComfyUIVideo({
      baseUrl: 'http://10.0.0.12:8188/comfy',
      providerId: 'comfyui',
      profile: videoProfile,
      imageUrl: 'https://storage.example/source.jpg',
      prompt: 'make it move',
      options: { fps: 24 },
    })

    expect(loadImageResourceMock).toHaveBeenCalledWith('https://storage.example/source.jpg')
    expect(uploadComfyUIImageMock).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://10.0.0.12:8188/comfy',
    }))
    expect(submitComfyUIWorkflowMock).toHaveBeenCalledWith(
      'http://10.0.0.12:8188/comfy',
      expect.objectContaining({
        '1': expect.objectContaining({ inputs: expect.objectContaining({ text: 'make it move' }) }),
        '3': expect.objectContaining({ inputs: expect.objectContaining({ image: 'input/reference.png' }) }),
        '4': expect.objectContaining({ inputs: expect.objectContaining({ fps: 24 }) }),
      }),
    )
    expect(parseComfyUIExternalId(result.externalId || '')).toMatchObject({
      type: 'VIDEO',
      promptId: 'prompt-123',
    })
  })

  it('submits a text-to-video workflow without loading or uploading an image', async () => {
    const result = await generateComfyUITextToVideo({
      baseUrl: 'http://10.0.0.12:8188/comfy',
      providerId: 'comfyui',
      profile: textToVideoProfile,
      prompt: 'a fox runs through a snowy forest',
      options: { fps: 24 },
    })

    expect(loadImageResourceMock).not.toHaveBeenCalled()
    expect(uploadComfyUIImageMock).not.toHaveBeenCalled()
    expect(submitComfyUIWorkflowMock).toHaveBeenCalledWith(
      'http://10.0.0.12:8188/comfy',
      expect.objectContaining({
        '1': expect.objectContaining({ inputs: expect.objectContaining({ text: 'a fox runs through a snowy forest' }) }),
        '4': expect.objectContaining({ inputs: expect.objectContaining({ fps: 24 }) }),
      }),
    )
    expect(parseComfyUIExternalId(result.externalId || '')).toMatchObject({
      type: 'VIDEO',
      promptId: 'prompt-123',
    })
  })

  it('rejects an image-to-video workflow without a source image before any upload', async () => {
    await expect(generateComfyUIVideo({
      baseUrl: 'http://10.0.0.12:8188',
      providerId: 'comfyui',
      profile: videoProfile,
      imageUrl: '  ',
      prompt: 'make it move',
    })).rejects.toThrow('COMFYUI_REFERENCE_IMAGE_REQUIRED')

    expect(loadImageResourceMock).not.toHaveBeenCalled()
    expect(uploadComfyUIImageMock).not.toHaveBeenCalled()
    expect(submitComfyUIWorkflowMock).not.toHaveBeenCalled()
  })

  it('rejects multiple reference images instead of silently dropping them', async () => {
    await expect(generateComfyUIImage({
      baseUrl: 'http://10.0.0.12:8188',
      providerId: 'comfyui',
      profile: imageProfile,
      prompt: 'a red fox',
      referenceImages: [
        'https://storage.example/first.png',
        'https://storage.example/second.png',
      ],
    })).rejects.toThrow('COMFYUI_MULTIPLE_REFERENCE_IMAGES_UNSUPPORTED')

    expect(loadImageResourceMock).not.toHaveBeenCalled()
    expect(uploadComfyUIImageMock).not.toHaveBeenCalled()
    expect(submitComfyUIWorkflowMock).not.toHaveBeenCalled()
  })
})

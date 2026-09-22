import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveModelSelectionMock = vi.hoisted(() =>
  vi.fn<typeof import('@/lib/api-config').resolveModelSelection>(async () => ({
    provider: 'google',
    modelId: 'gemini-3.1',
    modelKey: 'google::gemini-3.1',
    mediaType: 'image',
  })),
)
const getProviderConfigMock = vi.hoisted(() =>
  vi.fn<typeof import('@/lib/api-config').getProviderConfig>(async () => ({
    id: 'google',
    name: 'Google',
    apiKey: 'google-key',
    apiMode: undefined,
    gatewayRoute: undefined,
  })),
)
const getComfyUIProviderConfigMock = vi.hoisted(() =>
  vi.fn<typeof import('@/lib/api-config').getComfyUIProviderConfig>(async () => ({
    id: 'comfyui',
    name: 'ComfyUI',
    baseUrl: 'http://10.0.0.12:8188',
  })),
)

const generateImageViaOpenAICompatMock = vi.hoisted(() => vi.fn(async () => ({ success: true, imageUrl: 'compat-image' })))
const generateVideoViaOpenAICompatMock = vi.hoisted(() => vi.fn(async () => ({ success: true, videoUrl: 'compat-video' })))
const generateImageViaOpenAICompatTemplateMock = vi.hoisted(() => vi.fn(async () => ({ success: true, imageUrl: 'compat-template-image' })))
const generateVideoViaOpenAICompatTemplateMock = vi.hoisted(() => vi.fn(async () => ({ success: true, videoUrl: 'compat-template-video' })))
const resolveModelGatewayRouteMock = vi.hoisted(() => vi.fn(() => 'official'))

const imageGeneratorGenerateMock = vi.hoisted(() => vi.fn(async () => ({ success: true, imageUrl: 'official-image' })))
const videoGeneratorGenerateMock = vi.hoisted(() => vi.fn(async () => ({ success: true, videoUrl: 'official-video' })))
const audioGeneratorGenerateMock = vi.hoisted(() => vi.fn(async () => ({ success: true, audioUrl: 'audio' })))

const createImageGeneratorMock = vi.hoisted(() => vi.fn(() => ({ generate: imageGeneratorGenerateMock })))
const createVideoGeneratorMock = vi.hoisted(() => vi.fn(() => ({ generate: videoGeneratorGenerateMock })))
const createAudioGeneratorMock = vi.hoisted(() => vi.fn(() => ({ generate: audioGeneratorGenerateMock })))
const generateBailianImageMock = vi.hoisted(() => vi.fn(async () => ({ success: true, imageUrl: 'bailian-image' })))
const generateBailianVideoMock = vi.hoisted(() => vi.fn(async () => ({ success: true, videoUrl: 'bailian-video' })))
const generateBailianAudioMock = vi.hoisted(() => vi.fn(async () => ({ success: true, audioUrl: 'bailian-audio' })))
const generateSiliconFlowImageMock = vi.hoisted(() => vi.fn(async () => ({ success: true, imageUrl: 'siliconflow-image' })))
const generateSiliconFlowVideoMock = vi.hoisted(() => vi.fn(async () => ({ success: true, videoUrl: 'siliconflow-video' })))
const generateSiliconFlowAudioMock = vi.hoisted(() => vi.fn(async () => ({ success: true, audioUrl: 'siliconflow-audio' })))
const generateComfyUIImageMock = vi.hoisted(() => vi.fn(async () => ({ success: true, async: true, externalId: 'COMFY:IMAGE:token' })))
const generateComfyUIVideoMock = vi.hoisted(() => vi.fn(async () => ({ success: true, async: true, externalId: 'COMFY:VIDEO:token' })))
const generateComfyUITextToVideoMock = vi.hoisted(() => vi.fn(async () => ({ success: true, async: true, externalId: 'COMFY:VIDEO:token' })))

vi.mock('@/lib/api-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-config')>()
  return {
    ...actual,
    resolveModelSelection: resolveModelSelectionMock,
    getProviderConfig: getProviderConfigMock,
    getComfyUIProviderConfig: getComfyUIProviderConfigMock,
  }
})

vi.mock('@/lib/model-gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/model-gateway')>()
  return {
    ...actual,
    generateImageViaOpenAICompat: generateImageViaOpenAICompatMock,
    generateVideoViaOpenAICompat: generateVideoViaOpenAICompatMock,
    generateImageViaOpenAICompatTemplate: generateImageViaOpenAICompatTemplateMock,
    generateVideoViaOpenAICompatTemplate: generateVideoViaOpenAICompatTemplateMock,
    resolveModelGatewayRoute: resolveModelGatewayRouteMock,
  }
})

vi.mock('@/lib/generators/factory', () => ({
  createImageGenerator: createImageGeneratorMock,
  createVideoGenerator: createVideoGeneratorMock,
  createAudioGenerator: createAudioGeneratorMock,
}))

vi.mock('@/lib/providers/bailian', () => ({
  generateBailianImage: generateBailianImageMock,
  generateBailianVideo: generateBailianVideoMock,
  generateBailianAudio: generateBailianAudioMock,
}))

vi.mock('@/lib/providers/siliconflow', () => ({
  generateSiliconFlowImage: generateSiliconFlowImageMock,
  generateSiliconFlowVideo: generateSiliconFlowVideoMock,
  generateSiliconFlowAudio: generateSiliconFlowAudioMock,
}))

vi.mock('@/lib/comfyui/runtime', () => ({
  generateComfyUIImage: generateComfyUIImageMock,
  generateComfyUITextToVideo: generateComfyUITextToVideoMock,
  generateComfyUIVideo: generateComfyUIVideoMock,
}))

import { generateAudio, generateImage, generateVideo } from '@/lib/generator-api'

describe('generator-api gateway routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveModelGatewayRouteMock.mockReset()
    resolveModelGatewayRouteMock.mockReturnValue('official')
    getProviderConfigMock.mockResolvedValue({
      id: 'google',
      name: 'Google',
      apiKey: 'google-key',
      apiMode: undefined,
      gatewayRoute: undefined,
    })
    getComfyUIProviderConfigMock.mockResolvedValue({
      id: 'comfyui',
      name: 'ComfyUI',
      baseUrl: 'http://10.0.0.12:8188',
    })
  })

  it('routes openai-compatible image requests to openai-compat gateway', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'openai-compatible:oa-1',
      modelId: 'gpt-image-1',
      modelKey: 'openai-compatible:oa-1::gpt-image-1',
      mediaType: 'image',
      compatMediaTemplate: {
        version: 1,
        mediaType: 'image',
        mode: 'sync',
        create: { method: 'POST', path: '/v1/images/generations' },
        response: { outputUrlPath: 'data[0].url' },
      },
    })
    resolveModelGatewayRouteMock.mockReturnValueOnce('openai-compat')

    const result = await generateImage('user-1', 'openai-compatible:oa-1::gpt-image-1', 'draw cat', {
      size: '1024x1024',
    })

    expect(generateImageViaOpenAICompatTemplateMock).toHaveBeenCalledTimes(1)
    expect(createImageGeneratorMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, imageUrl: 'compat-template-image' })
  })

  it('routes official image requests to provider generator', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'google',
      modelId: 'imagen-4.0',
      modelKey: 'google::imagen-4.0',
      mediaType: 'image',
    })
    resolveModelGatewayRouteMock.mockReturnValueOnce('official')

    const result = await generateImage('user-1', 'google::imagen-4.0', 'draw house')

    expect(createImageGeneratorMock).toHaveBeenCalledWith('google', 'imagen-4.0')
    expect(generateImageViaOpenAICompatMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, imageUrl: 'official-image' })
  })

  it('routes gemini-compatible image to official generator', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'gemini-compatible:gm-1',
      modelId: 'gemini-2.5-flash-image-preview',
      modelKey: 'gemini-compatible:gm-1::gemini-2.5-flash-image-preview',
      mediaType: 'image',
    })
    getProviderConfigMock.mockResolvedValueOnce({
      id: 'gemini-compatible:gm-1',
      name: 'Gemini Compatible',
      apiKey: 'gm-key',
      baseUrl: 'https://gm.test',
      apiMode: 'gemini-sdk',
      gatewayRoute: 'official',
    })

    const result = await generateImage(
      'user-1',
      'gemini-compatible:gm-1::gemini-2.5-flash-image-preview',
      'draw cat',
      { aspectRatio: '3:4' },
    )

    expect(createImageGeneratorMock).toHaveBeenCalledWith('gemini-compatible:gm-1', 'gemini-2.5-flash-image-preview')
    expect(generateImageViaOpenAICompatMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, imageUrl: 'official-image' })
  })

  it('routes openai-compatible video requests to openai-compat gateway', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'openai-compatible:oa-1',
      modelId: 'sora-2',
      modelKey: 'openai-compatible:oa-1::sora-2',
      mediaType: 'video',
      compatMediaTemplate: {
        version: 1,
        mediaType: 'video',
        mode: 'async',
        create: { method: 'POST', path: '/v1/videos/generations' },
        response: { taskIdPath: 'id' },
      },
    })
    resolveModelGatewayRouteMock.mockReturnValueOnce('openai-compat')

    const result = await generateVideo(
      'user-1',
      'openai-compatible:oa-1::sora-2',
      'https://example.com/source.png',
      { prompt: 'animate' },
    )

    expect(generateVideoViaOpenAICompatTemplateMock).toHaveBeenCalledTimes(1)
    expect(createVideoGeneratorMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, videoUrl: 'compat-template-video' })
  })

  it('routes gemini-compatible video to official provider generator', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'gemini-compatible:gm-1',
      modelId: 'veo-3.1-generate-preview',
      modelKey: 'gemini-compatible:gm-1::veo-3.1-generate-preview',
      mediaType: 'video',
    })
    resolveModelGatewayRouteMock.mockReturnValueOnce('official')

    const result = await generateVideo('user-1', 'gemini-compatible:gm-1::veo-3.1-generate-preview', 'https://example.com/source.png')

    expect(createVideoGeneratorMock).toHaveBeenCalledWith('gemini-compatible:gm-1')
    expect(generateVideoViaOpenAICompatMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, videoUrl: 'official-video' })
  })

  it('routes official video requests to provider generator', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'fal',
      modelId: 'kling',
      modelKey: 'fal::kling',
      mediaType: 'video',
    })
    resolveModelGatewayRouteMock.mockReturnValueOnce('official')

    const result = await generateVideo('user-1', 'fal::kling', 'https://example.com/source.png')

    expect(createVideoGeneratorMock).toHaveBeenCalledWith('fal')
    expect(generateVideoViaOpenAICompatMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, videoUrl: 'official-video' })
  })

  it('keeps a source image mandatory for non-ComfyUI video providers', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'fal',
      modelId: 'kling',
      modelKey: 'fal::kling',
      mediaType: 'video',
    })

    await expect(generateVideo('user-1', 'fal::kling', undefined, { prompt: 'animate' }))
      .rejects.toThrow('VIDEO_SOURCE_IMAGE_REQUIRED')

    expect(createVideoGeneratorMock).not.toHaveBeenCalled()
  })

  it('keeps audio generation on provider generator path', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'fal',
      modelId: 'tts-1',
      modelKey: 'fal::tts-1',
      mediaType: 'audio',
    })

    const result = await generateAudio('user-1', 'fal::tts-1', 'hello')

    expect(createAudioGeneratorMock).toHaveBeenCalledWith('fal')
    expect(result).toEqual({ success: true, audioUrl: 'audio' })
  })

  it('routes bailian image generation to official provider adapter', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'bailian',
      modelId: 'wanx-image',
      modelKey: 'bailian::wanx-image',
      mediaType: 'image',
    })
    getProviderConfigMock.mockResolvedValueOnce({
      id: 'bailian',
      name: 'Bailian',
      apiKey: 'bl-key',
      gatewayRoute: 'official',
      apiMode: undefined,
    })

    const result = await generateImage('user-1', 'bailian::wanx-image', 'draw sky')

    expect(generateBailianImageMock).toHaveBeenCalledTimes(1)
    expect(generateImageViaOpenAICompatMock).not.toHaveBeenCalled()
    expect(createImageGeneratorMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, imageUrl: 'bailian-image' })
  })

  it('routes siliconflow video generation to official provider adapter', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'siliconflow',
      modelId: 'sf-video',
      modelKey: 'siliconflow::sf-video',
      mediaType: 'video',
    })
    getProviderConfigMock.mockResolvedValueOnce({
      id: 'siliconflow',
      name: 'SiliconFlow',
      apiKey: 'sf-key',
      gatewayRoute: 'official',
      apiMode: undefined,
    })

    const result = await generateVideo('user-1', 'siliconflow::sf-video', 'https://example.com/source.png', {
      prompt: 'animate',
    })

    expect(generateSiliconFlowVideoMock).toHaveBeenCalledTimes(1)
    expect(generateVideoViaOpenAICompatMock).not.toHaveBeenCalled()
    expect(createVideoGeneratorMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, videoUrl: 'siliconflow-video' })
  })

  it('routes bailian audio generation to official provider adapter', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'bailian',
      modelId: 'bailian-tts',
      modelKey: 'bailian::bailian-tts',
      mediaType: 'audio',
    })

    const result = await generateAudio('user-1', 'bailian::bailian-tts', 'hello')

    expect(generateBailianAudioMock).toHaveBeenCalledTimes(1)
    expect(createAudioGeneratorMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, audioUrl: 'bailian-audio' })
  })

  it('routes ComfyUI image generation to the workflow runtime without an API key', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'comfyui',
      modelId: 'flux-dev',
      modelKey: 'comfyui::flux-dev',
      mediaType: 'image',
      comfyuiProfile: {
        version: 1,
        mediaType: 'image',
        workflow: {
          '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
          '9': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
        },
        inputMappings: {
          prompt: { nodeId: '1', inputName: 'text', required: true },
        },
        outputNodeId: '9',
      },
    })

    const result = await generateImage('user-1', 'comfyui::flux-dev', 'draw a fox', {
      referenceImages: ['https://storage.example/reference.png'],
      size: '1024x1024',
    })

    expect(getComfyUIProviderConfigMock).toHaveBeenCalledWith('user-1', 'comfyui')
    expect(getProviderConfigMock).not.toHaveBeenCalled()
    expect(generateComfyUIImageMock).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://10.0.0.12:8188',
      prompt: 'draw a fox',
      referenceImages: ['https://storage.example/reference.png'],
      options: expect.objectContaining({
        size: '1024x1024',
        provider: 'comfyui',
        modelId: 'flux-dev',
        modelKey: 'comfyui::flux-dev',
      }),
    }))
    expect(result).toEqual({ success: true, async: true, externalId: 'COMFY:IMAGE:token' })
  })

  it('routes ComfyUI video generation to the workflow runtime', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'comfyui',
      modelId: 'wan-video',
      modelKey: 'comfyui::wan-video',
      mediaType: 'video',
      comfyuiProfile: {
        version: 1,
        mediaType: 'video',
        workflow: {
          '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
          '3': { class_type: 'LoadImage', inputs: { image: '' } },
          '9': { class_type: 'SaveAnimatedWEBP', inputs: { images: ['3', 0] } },
        },
        inputMappings: {
          prompt: { nodeId: '1', inputName: 'text', required: true },
          image: { nodeId: '3', inputName: 'image', required: true },
        },
        outputNodeId: '9',
      },
    })

    const result = await generateVideo(
      'user-1',
      'comfyui::wan-video',
      'https://storage.example/source.png',
      { prompt: 'make it move', fps: 24 },
    )

    expect(getComfyUIProviderConfigMock).toHaveBeenCalledWith('user-1', 'comfyui')
    expect(getProviderConfigMock).not.toHaveBeenCalled()
    expect(generateComfyUIVideoMock).toHaveBeenCalledWith(expect.objectContaining({
      imageUrl: 'https://storage.example/source.png',
      prompt: 'make it move',
      options: expect.objectContaining({ fps: 24, modelId: 'wan-video' }),
    }))
    expect(result).toEqual({ success: true, async: true, externalId: 'COMFY:VIDEO:token' })
  })

  it('routes a ComfyUI video profile without an image mapping to text-to-video', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'comfyui',
      modelId: 'minimax-h3',
      modelKey: 'comfyui::minimax-h3',
      mediaType: 'video',
      comfyuiProfile: {
        version: 1,
        mediaType: 'video',
        workflow: {
          '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
          '9': { class_type: 'SaveVideo', inputs: { images: ['1', 0] } },
        },
        inputMappings: {
          prompt: { nodeId: '1', inputName: 'text', required: true },
        },
        outputNodeId: '9',
      },
    })

    const result = await generateVideo(
      'user-1',
      'comfyui::minimax-h3',
      undefined,
      { prompt: 'a cinematic city at dusk', duration: 5 },
    )

    expect(getComfyUIProviderConfigMock).toHaveBeenCalledWith('user-1', 'comfyui')
    expect(generateComfyUITextToVideoMock).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://10.0.0.12:8188',
      prompt: 'a cinematic city at dusk',
      options: expect.objectContaining({ duration: 5, modelId: 'minimax-h3' }),
    }))
    expect(generateComfyUIVideoMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, async: true, externalId: 'COMFY:VIDEO:token' })
  })

  it('routes a ComfyUI Profile Set first-last-frame request to its dedicated workflow and drops incompatible reference audio', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'comfyui',
      modelId: 'minimax-h3',
      modelKey: 'comfyui::minimax-h3',
      mediaType: 'video',
      comfyuiProfile: {
        version: 1,
        mediaType: 'video',
        variants: {
          firstLastFrame: {
            version: 1,
            mediaType: 'video',
            workflow: {
              '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
              '3': { class_type: 'LoadImage', inputs: { image: '' } },
              '4': { class_type: 'LoadImage', inputs: { image: '' } },
              '9': { class_type: 'SaveVideo', inputs: { video: ['3', 0] } },
            },
            inputMappings: {
              prompt: { nodeId: '1', inputName: 'text', required: true },
              image: { nodeId: '3', inputName: 'image', required: true },
              lastFrameImage: { nodeId: '4', inputName: 'image', required: true },
            },
            outputNodeId: '9',
          },
        },
      },
    })
    const referenceAudio = {
      url: 'data:audio/mpeg;base64,SUQz',
      mimeType: 'audio/mpeg' as const,
      byteSize: 3,
      hash: 'abc12345',
      sourceKind: 'data-url' as const,
    }

    await generateVideo(
      'user-1',
      'comfyui::minimax-h3',
      'https://storage.example/first.png',
      {
        prompt: 'walk into the final pose',
        generationMode: 'firstlastframe',
        lastFrameImageUrl: 'https://storage.example/last.png',
        referenceAudios: [referenceAudio],
      },
    )

    expect(generateComfyUIVideoMock).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        inputMappings: expect.objectContaining({
          lastFrameImage: expect.any(Object),
        }),
      }),
      lastFrameImageUrl: 'https://storage.example/last.png',
      referenceAudios: undefined,
    }))
    expect(generateComfyUITextToVideoMock).not.toHaveBeenCalled()
  })
})

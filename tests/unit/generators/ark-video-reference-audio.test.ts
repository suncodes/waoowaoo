import { beforeEach, describe, expect, it, vi } from 'vitest'
import { arkCreateVideoTask } from '@/lib/ark-api'
import { ArkVideoGenerator } from '@/lib/generators/ark'

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'ark-key' })),
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn(async (input: string) => `data:image/png;base64,${Buffer.from(input).toString('base64')}`),
}))

vi.mock('@/lib/ark-api', () => ({
  arkCreateVideoTask: vi.fn(async () => ({ id: 'ark-task-1' })),
}))

describe('Ark video reference audio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits Seedance 2.0 reference audio as audio_url content and enables native audio', async () => {
    const generator = new ArkVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'images/panel.png',
      prompt: '镜头缓慢推进。',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        duration: 4,
        referenceAudios: [{
          url: 'data:audio/wav;base64,AAAA',
          speaker: '旁白',
          source: 'speaker',
          provider: 'fal',
          voiceType: 'narration',
          mimeType: 'audio/wav',
          byteSize: 4,
          hash: 'audiohash',
          sourceKind: 'data-url',
        }],
      },
    })

    expect(result).toMatchObject({
      success: true,
      async: true,
      externalId: 'ARK:VIDEO:ark-task-1',
    })
    expect(arkCreateVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'doubao-seedance-2-0-260128',
        generate_audio: true,
        content: expect.arrayContaining([
          { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AAAA' }, role: 'reference_audio' },
        ]),
      }),
      expect.objectContaining({
        apiKey: 'ark-key',
      }),
    )
  })

  it('rejects reference audio on Seedance models without reference audio support', async () => {
    const generator = new ArkVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'images/panel.png',
      prompt: '镜头缓慢推进。',
      options: {
        modelId: 'doubao-seedance-1-5-pro-251215',
        referenceAudios: [{
          url: 'data:audio/wav;base64,AAAA',
          mimeType: 'audio/wav',
          byteSize: 4,
          hash: 'audiohash',
          sourceKind: 'data-url',
        }],
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('ARK_VIDEO_OPTION_UNSUPPORTED: referenceAudios')
    expect(arkCreateVideoTask).not.toHaveBeenCalled()
  })
})

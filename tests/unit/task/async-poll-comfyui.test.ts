import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatComfyUIExternalId } from '@/lib/comfyui/external-id'

const getComfyUIProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'comfyui',
  name: 'ComfyUI',
  baseUrl: 'http://10.0.0.12:8188/comfy',
})))

vi.mock('@/lib/api-config', () => ({
  getComfyUIProviderConfig: getComfyUIProviderConfigMock,
  getProviderConfig: vi.fn(),
  getUserModels: vi.fn(),
}))

import { pollAsyncTask } from '@/lib/async-poll'

describe('async poll ComfyUI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getComfyUIProviderConfigMock.mockResolvedValue({
      id: 'comfyui',
      name: 'ComfyUI',
      baseUrl: 'http://10.0.0.12:8188/comfy',
    })
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  it('uses the saved remote provider address to turn a history output into a view URL', async () => {
    const externalId = formatComfyUIExternalId({
      mediaType: 'video',
      providerId: 'comfyui',
      outputNodeId: '9',
      promptId: 'prompt-123',
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      'prompt-123': {
        status: { status_str: 'success' },
        outputs: {
          '9': {
            gifs: [{ filename: 'render.webm', subfolder: 'video/run-1', type: 'output' }],
          },
        },
      },
    }), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(pollAsyncTask(externalId, 'user-1')).resolves.toEqual({
      status: 'completed',
      resultUrl: 'http://10.0.0.12:8188/comfy/view?filename=render.webm&type=output&subfolder=video%2Frun-1',
      videoUrl: 'http://10.0.0.12:8188/comfy/view?filename=render.webm&type=output&subfolder=video%2Frun-1',
    })
    expect(getComfyUIProviderConfigMock).toHaveBeenCalledWith('user-1', 'comfyui')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://10.0.0.12:8188/comfy/history/prompt-123',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('keeps a queued task pending until its configured output node appears', async () => {
    const externalId = formatComfyUIExternalId({
      mediaType: 'image',
      providerId: 'comfyui',
      outputNodeId: '9',
      promptId: 'prompt-queued',
    })
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch

    await expect(pollAsyncTask(externalId, 'user-1')).resolves.toEqual({ status: 'pending' })
  })
})

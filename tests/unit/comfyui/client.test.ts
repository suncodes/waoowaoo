import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ComfyUISubmissionUnknownError,
  buildComfyUIEndpoint,
  buildComfyUIViewUrl,
  normalizeComfyUIBaseUrl,
  resolveComfyUIHistoryResult,
  submitComfyUIWorkflow,
} from '@/lib/comfyui/client'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

const workflow = {
  '1': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'test' },
  },
}

describe('ComfyUI HTTP client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('keeps a reverse-proxy path on a remote intranet base URL', () => {
    expect(normalizeComfyUIBaseUrl(' http://10.0.0.12:8188/comfy/ ')).toBe('http://10.0.0.12:8188/comfy')
    expect(buildComfyUIEndpoint('http://10.0.0.12:8188/comfy', '/prompt')).toBe('http://10.0.0.12:8188/comfy/prompt')
  })

  it('rejects loopback URLs because ComfyUI is deployed on another machine', () => {
    for (const value of [
      'http://localhost:8188',
      'http://localhost.:8188',
      'http://127.0.0.1:8188',
      'http://2130706433:8188',
      'http://[::1]:8188',
      'http://[::ffff:127.0.0.1]:8188',
    ]) {
      expect(() => normalizeComfyUIBaseUrl(value)).toThrow('COMFYUI_BASE_URL_REMOTE_REQUIRED')
    }
  })

  it('submits an API workflow to the configured remote endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: 'prompt-123' }), { status: 200 }))

    await expect(submitComfyUIWorkflow('http://10.0.0.12:8188/comfy', workflow)).resolves.toBe('prompt-123')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://10.0.0.12:8188/comfy/prompt',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
      }),
    )
  })

  it('does not classify explicit node validation errors as an unknown submission', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      node_errors: { '1': { errors: [{ message: 'checkpoint is missing' }] } },
    }), { status: 200 }))

    await expect(submitComfyUIWorkflow('http://10.0.0.12:8188', workflow)).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      provider: 'comfyui',
    })
  })

  it('marks a network failure or missing prompt id as non-retryable unknown submission', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(submitComfyUIWorkflow('http://10.0.0.12:8188', workflow)).rejects.toBeInstanceOf(ComfyUISubmissionUnknownError)

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
    await expect(submitComfyUIWorkflow('http://10.0.0.12:8188', workflow)).rejects.toMatchObject({
      code: 'COMFYUI_SUBMISSION_UNKNOWN',
    })
  })

  it('maps history output into a ComfyUI view URL while preserving the media format', () => {
    const result = resolveComfyUIHistoryResult({
      history: {
        'prompt-123': {
          status: { status_str: 'success' },
          outputs: {
            '9': {
              gifs: [{ filename: 'render.webm', subfolder: 'videos/run-1', type: 'output' }],
            },
          },
        },
      },
      promptId: 'prompt-123',
      outputNodeId: '9',
      mediaType: 'video',
    })

    expect(result).toEqual({
      status: 'completed',
      file: { filename: 'render.webm', subfolder: 'videos/run-1', type: 'output' },
    })
    if (result.status !== 'completed') throw new Error('expected completed result')
    expect(buildComfyUIViewUrl('http://10.0.0.12:8188/comfy', result.file)).toBe(
      'http://10.0.0.12:8188/comfy/view?filename=render.webm&type=output&subfolder=videos%2Frun-1',
    )
  })
})

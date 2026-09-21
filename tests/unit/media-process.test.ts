import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}.${ext}`),
  toFetchableUrl: vi.fn((url: string) => url),
  uploadObject: vi.fn(async () => 'storage-key'),
  downloadAndUploadVideo: vi.fn(async () => 'video-storage-key'),
}))

vi.mock('@/lib/storage', () => storageMock)

import { processMediaResult } from '@/lib/media-process'

describe('media process source format preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn(async () => new Response(Buffer.from('image'), { status: 200 })) as unknown as typeof fetch
  })

  it('keeps the image extension and MIME type from a ComfyUI view filename', async () => {
    await expect(processMediaResult({
      source: 'http://10.0.0.12:8188/view?filename=render.png&type=output',
      type: 'image',
      keyPrefix: 'images/render',
      targetId: 'task-1',
    })).resolves.toBe('storage-key')

    expect(storageMock.generateUniqueKey).toHaveBeenCalledWith('images/render-task-1', 'png')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      expect.any(Buffer),
      'images/render-task-1.png',
      undefined,
      'image/png',
    )
  })

  it('keeps WebM output as video/webm when downloading a ComfyUI video', async () => {
    await expect(processMediaResult({
      source: 'http://10.0.0.12:8188/view?filename=render.webm&type=output',
      type: 'video',
      keyPrefix: 'video/render',
      targetId: 'task-2',
    })).resolves.toBe('video-storage-key')

    expect(storageMock.generateUniqueKey).toHaveBeenCalledWith('video/render-task-2', 'webm')
    expect(storageMock.downloadAndUploadVideo).toHaveBeenCalledWith(
      'http://10.0.0.12:8188/view?filename=render.webm&type=output',
      'video/render-task-2.webm',
      3,
      undefined,
      'video/webm',
    )
  })
})

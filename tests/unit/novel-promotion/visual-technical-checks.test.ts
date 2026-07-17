import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const imageState = vi.hoisted(() => ({
  buffers: new Map<string, Buffer>(),
}))

vi.mock('@/lib/media/outbound-image', () => ({
  loadImageResource: vi.fn(async (url: string) => {
    const bytes = imageState.buffers.get(url)
    if (!bytes) throw new Error(`missing image: ${url}`)
    return { bytes, mimeType: 'image/png' }
  }),
}))

import { inspectVisualCandidates } from '@/lib/visual-quality'

describe('visual technical checks', () => {
  beforeAll(async () => {
    imageState.buffers.set('wide-a', await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#445566' },
    }).png().toBuffer())
    imageState.buffers.set('wide-copy', imageState.buffers.get('wide-a')!)
    imageState.buffers.set('small-square', await sharp({
      create: { width: 320, height: 320, channels: 3, background: '#ddeeff' },
    }).png().toBuffer())
  })

  it('detects duplicates, low resolution, unreadable images, and ratio mismatches', async () => {
    const checks = await inspectVisualCandidates(
      ['wide-a', 'wide-copy', 'small-square', 'missing'],
      '16:9',
    )

    expect(checks[0]).toMatchObject({ readable: true, width: 1600, height: 900 })
    expect(checks[1].issues.map((issue) => issue.code)).toContain('DUPLICATE_CANDIDATE')
    expect(checks[2].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'LOW_TECHNICAL_QUALITY',
      'ASPECT_RATIO_MISMATCH',
    ]))
    expect(checks[3]).toMatchObject({ readable: false, byteLength: 0 })
    expect(checks[3].issues[0].code).toBe('UNREADABLE_IMAGE')
  })
})

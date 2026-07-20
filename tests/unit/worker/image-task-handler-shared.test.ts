import { describe, expect, it, vi } from 'vitest'

const utilsMock = vi.hoisted(() => ({
  resolveImageSourceFromGeneration: vi.fn(),
  toSignedUrlIfCos: vi.fn((value: string | null | undefined) => value || null),
  uploadImageSourceToCos: vi.fn(),
  withLabelBar: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/utils', () => utilsMock)

import { collectPanelReferenceImages } from '@/lib/workers/handlers/image-task-handler-shared'

describe('collectPanelReferenceImages', () => {
  it('resolves a stable visual asset id to its finalized reference image', async () => {
    const referenceImages = await collectPanelReferenceImages({
      characters: [],
      locations: [{
        id: 'asset-nautilus',
        name: '鹦鹉螺号',
        assetKind: 'prop',
        images: [
          { isSelected: false, imageUrl: 'https://example.com/nautilus-candidate.png' },
          { isSelected: true, imageUrl: 'https://example.com/nautilus-final.png' },
        ],
      }],
    }, {
      sourceAnchor: {
        label: '鹦鹉螺号穿过海底峡谷',
        visualAssetIds: ['asset-nautilus'],
      },
    })

    expect(referenceImages).toEqual(['https://example.com/nautilus-final.png'])
    expect(utilsMock.toSignedUrlIfCos).toHaveBeenCalledWith(
      'https://example.com/nautilus-final.png',
      3600,
    )
  })
})

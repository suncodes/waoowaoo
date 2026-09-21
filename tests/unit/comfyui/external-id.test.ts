import { describe, expect, it } from 'vitest'
import {
  formatComfyUIExternalId,
  parseComfyUIExternalId,
} from '@/lib/comfyui/external-id'

describe('ComfyUI externalId', () => {
  it('round-trips provider, output node, and prompt id without delimiter ambiguity', () => {
    const externalId = formatComfyUIExternalId({
      mediaType: 'video',
      providerId: 'comfyui:studio-a',
      outputNodeId: 'Save Video: 42',
      promptId: 'a0b1c2d3-e4f5-6789-0123-456789abcdef',
    })

    expect(externalId).toMatch(/^COMFY:VIDEO:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
    expect(parseComfyUIExternalId(externalId)).toEqual({
      type: 'VIDEO',
      providerId: 'comfyui:studio-a',
      outputNodeId: 'Save Video: 42',
      promptId: 'a0b1c2d3-e4f5-6789-0123-456789abcdef',
    })
  })

  it('rejects malformed external ids', () => {
    expect(() => parseComfyUIExternalId('COMFY:IMAGE:only-two-parts')).toThrow('COMFYUI_EXTERNAL_ID_INVALID')
  })
})

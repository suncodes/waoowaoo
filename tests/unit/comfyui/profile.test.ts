import { describe, expect, it } from 'vitest'
import {
  ComfyUIProfileInputError,
  patchComfyUIWorkflow,
  validateComfyUIProfile,
} from '@/lib/comfyui/profile'

function createProfile(mediaType: 'image' | 'video' = 'image') {
  return {
    version: 1,
    mediaType,
    workflow: {
      '1': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'template prompt' },
      },
      '2': {
        class_type: 'KSampler',
        inputs: { seed: 1, width: 512, height: 512 },
      },
      '9': {
        class_type: mediaType === 'video' ? 'VHS_VideoCombine' : 'SaveImage',
        inputs: { images: ['2', 0] },
      },
    },
    inputMappings: {
      prompt: { nodeId: '1', inputName: 'text', required: true },
      seed: { nodeId: '2', inputName: 'seed' },
      width: { nodeId: '2', inputName: 'width' },
      height: { nodeId: '2', inputName: 'height' },
      ...(mediaType === 'video'
        ? { image: { nodeId: '2', inputName: 'image', required: true } }
        : {}),
      'options.negativePrompt': { nodeId: '1', inputName: 'negative_prompt' },
    },
    outputNodeId: '9',
  }
}

describe('ComfyUI profile', () => {
  it('validates and deep-clones an API-format image workflow', () => {
    const raw = createProfile()
    const result = validateComfyUIProfile(raw, { expectedMediaType: 'image' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.profile).toMatchObject({
      version: 1,
      mediaType: 'image',
      outputNodeId: '9',
    })

    raw.workflow['1'].inputs.text = 'changed after validation'
    expect(result.profile.workflow['1']?.inputs.text).toBe('template prompt')
  })

  it('requires an image mapping for image-to-video workflows', () => {
    const raw = createProfile('video')
    delete raw.inputMappings.image

    expect(validateComfyUIProfile(raw)).toMatchObject({
      ok: false,
      code: 'COMFYUI_PROFILE_IMAGE_MAPPING_REQUIRED',
    })
  })

  it('rejects a profile whose media type differs from the configured model', () => {
    expect(validateComfyUIProfile(createProfile('image'), { expectedMediaType: 'video' })).toMatchObject({
      ok: false,
      code: 'COMFYUI_PROFILE_MEDIA_TYPE_MISMATCH',
    })
  })

  it('patches only mapped values without mutating the saved workflow template', () => {
    const validated = validateComfyUIProfile(createProfile())
    if (!validated.ok) throw new Error(validated.message)

    const patched = patchComfyUIWorkflow(validated.profile, {
      prompt: 'a cinematic city at night',
      seed: 42,
      width: 1024,
      height: 576,
      'options.negativePrompt': 'blurry',
    })

    expect(patched['1']?.inputs).toMatchObject({
      text: 'a cinematic city at night',
      negative_prompt: 'blurry',
    })
    expect(patched['2']?.inputs).toMatchObject({ seed: 42, width: 1024, height: 576 })
    expect(validated.profile.workflow['1']?.inputs.text).toBe('template prompt')
    expect(validated.profile.workflow['2']?.inputs.seed).toBe(1)
  })

  it('fails explicitly when a required mapped input is absent', () => {
    const validated = validateComfyUIProfile(createProfile())
    if (!validated.ok) throw new Error(validated.message)

    expect(() => patchComfyUIWorkflow(validated.profile, {})).toThrow(ComfyUIProfileInputError)
  })
})

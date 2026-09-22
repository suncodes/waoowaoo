import { describe, expect, it } from 'vitest'
import {
  ComfyUIProfileInputError,
  patchComfyUIWorkflow,
  validateComfyUIProfileDefinition,
  validateComfyUIProfile,
} from '@/lib/comfyui/profile'
import { deriveComfyUIProfileCapabilities } from '@/lib/comfyui/capabilities'
import { routeComfyUIVideoProfile } from '@/lib/comfyui/video-routing'

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

function createVideoProfileWithFrameAndAudioMappings() {
  return {
    version: 1,
    mediaType: 'video' as const,
    workflow: {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'template prompt' } },
      '3': { class_type: 'LoadImage', inputs: { image: 'first.png' } },
      '4': { class_type: 'LoadImage', inputs: { image: 'last.png' } },
      '5': { class_type: 'MiniMaxH3ImageToVideo', inputs: { first_frame: ['3', 0], last_frame: ['4', 0] } },
      '6': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { ref_audios: { ref_audio_1: ['7', 0] } } },
      '7': { class_type: 'LoadAudio', inputs: { audio: 'template-1.mp3' } },
      '8': { class_type: 'LoadAudio', inputs: { audio: 'template-2.mp3' } },
      '10': { class_type: 'LoadAudio', inputs: { audio: 'template-3.mp3' } },
      '9': { class_type: 'SaveVideo', inputs: { video: ['5', 0] } },
    },
    inputMappings: {
      prompt: { nodeId: '1', inputName: 'text', required: true },
      image: { nodeId: '3', inputName: 'image', required: true },
      lastFrameImage: { nodeId: '4', inputName: 'image', required: true },
      referenceAudios: {
        type: 'collection',
        nodeId: '6',
        inputName: 'ref_audios',
        itemPrefix: 'ref_audio_',
        itemMappings: [
          { nodeId: '7', inputName: 'audio' },
          { nodeId: '8', inputName: 'audio' },
          { nodeId: '10', inputName: 'audio' },
        ],
      },
    },
    outputNodeId: '9',
  }
}

function createTextToVideoProfile() {
  const profile = createProfile('video')
  delete profile.inputMappings.image
  return profile
}

function createFirstLastFrameProfile() {
  const profile = createVideoProfileWithFrameAndAudioMappings()
  const { referenceAudios: _referenceAudios, ...inputMappings } = profile.inputMappings
  void _referenceAudios
  return {
    ...profile,
    inputMappings,
  }
}

function createReferenceAudioProfile() {
  const profile = createVideoProfileWithFrameAndAudioMappings()
  const { image: _image, lastFrameImage: _lastFrameImage, ...inputMappings } = profile.inputMappings
  void _image
  void _lastFrameImage
  return {
    ...profile,
    inputMappings,
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

  it('allows a video profile without an image mapping for text-to-video workflows', () => {
    const raw = createProfile('video')
    delete raw.inputMappings.image

    expect(validateComfyUIProfile(raw)).toMatchObject({ ok: true })
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

  it('requires a first-frame mapping when a profile maps a last frame', () => {
    const source = createVideoProfileWithFrameAndAudioMappings()
    const { image: _image, ...inputMappingsWithoutImage } = source.inputMappings
    void _image
    const raw = {
      ...source,
      inputMappings: inputMappingsWithoutImage,
    }

    expect(validateComfyUIProfile(raw)).toMatchObject({
      ok: false,
      code: 'COMFYUI_PROFILE_LAST_FRAME_IMAGE_REQUIRES_IMAGE',
    })
  })

  it('patches first and last frames plus a dynamic reference-audio collection', () => {
    const validated = validateComfyUIProfile(createVideoProfileWithFrameAndAudioMappings())
    if (!validated.ok) throw new Error(validated.message)

    const patched = patchComfyUIWorkflow(validated.profile, {
      prompt: 'a character crosses the room',
      image: 'input/first.png',
      lastFrameImage: 'input/last.png',
      referenceAudios: ['input/voice-1.mp3', 'input/voice-2.wav'],
    })

    expect(patched['3']?.inputs.image).toBe('input/first.png')
    expect(patched['4']?.inputs.image).toBe('input/last.png')
    expect(patched['7']?.inputs.audio).toBe('input/voice-1.mp3')
    expect(patched['8']?.inputs.audio).toBe('input/voice-2.wav')
    expect(patched['6']?.inputs.ref_audios).toEqual({
      ref_audio_1: ['7', 0],
      ref_audio_2: ['8', 0],
    })
    expect(validated.profile.workflow['6']?.inputs.ref_audios).toEqual({
      ref_audio_1: ['7', 0],
    })
  })

  it('clears template audio links when no reference audio is requested', () => {
    const validated = validateComfyUIProfile(createVideoProfileWithFrameAndAudioMappings())
    if (!validated.ok) throw new Error(validated.message)

    const patched = patchComfyUIWorkflow(validated.profile, {
      prompt: 'a quiet scene',
      image: 'input/first.png',
      lastFrameImage: 'input/last.png',
    })

    expect(patched['6']?.inputs.ref_audios).toBeUndefined()
  })

  it('rejects reference audio beyond the validated profile capacity', () => {
    const validated = validateComfyUIProfile(createVideoProfileWithFrameAndAudioMappings())
    if (!validated.ok) throw new Error(validated.message)

    expect(() => patchComfyUIWorkflow(validated.profile, {
      prompt: 'a scene',
      image: 'input/first.png',
      lastFrameImage: 'input/last.png',
      referenceAudios: ['1.mp3', '2.mp3', '3.mp3', '4.mp3'],
    })).toThrow('COMFYUI_PROFILE_COLLECTION_INPUT_EXCEEDS_CAPACITY')
  })

  it('derives reference-audio capacity without exposing a native-audio switch', () => {
    const validated = validateComfyUIProfile(createVideoProfileWithFrameAndAudioMappings())
    if (!validated.ok) throw new Error(validated.message)

    const capabilities = deriveComfyUIProfileCapabilities(validated.profile)

    expect(capabilities?.video).toMatchObject({
      firstlastframe: true,
      generationModeOptions: ['firstlastframe'],
      referenceAudioMaxCount: 3,
    })
    expect(capabilities?.video?.generateAudioOptions).toBeUndefined()
    expect(capabilities?.video?.supportGenerateAudio).toBeUndefined()
  })

  it('validates a video Profile Set and keeps all variants independently executable', () => {
    const result = validateComfyUIProfileDefinition({
      version: 1,
      mediaType: 'video',
      variants: {
        t2v: createTextToVideoProfile(),
        firstLastFrame: createFirstLastFrameProfile(),
        referenceAudio: createReferenceAudioProfile(),
      },
    }, { expectedMediaType: 'video' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(deriveComfyUIProfileCapabilities(result.profile)?.video).toMatchObject({
      firstlastframe: true,
      generationModeOptions: ['normal', 'firstlastframe'],
      referenceAudioMaxCount: 3,
    })
    expect(deriveComfyUIProfileCapabilities(result.profile)?.video?.firstLastReferenceAudioMaxCount).toBeUndefined()
  })

  it('rejects an invalid Profile Set first-last-frame variant with reference audio mapping', () => {
    expect(validateComfyUIProfileDefinition({
      version: 1,
      mediaType: 'video',
      variants: {
        firstLastFrame: createVideoProfileWithFrameAndAudioMappings(),
      },
    })).toMatchObject({
      ok: false,
      code: 'COMFYUI_PROFILE_SET_FIRSTLAST_AUDIO_INVALID',
    })
  })

  it('routes a first-last-frame request with reference audio to firstLastFrame and records degradation', () => {
    const validated = validateComfyUIProfileDefinition({
      version: 1,
      mediaType: 'video',
      variants: {
        t2v: createTextToVideoProfile(),
        firstLastFrame: createFirstLastFrameProfile(),
        referenceAudio: createReferenceAudioProfile(),
      },
    })
    if (!validated.ok) throw new Error(validated.message)

    const route = routeComfyUIVideoProfile({
      profile: validated.profile,
      generationMode: 'firstlastframe',
      requestedReferenceAudioCount: 1,
    })

    expect(route.plan).toEqual({
      requestedGenerationMode: 'firstlastframe',
      requestedReferenceAudioCount: 1,
      effectiveVariant: 'firstLastFrame',
      degradedCapabilities: ['referenceAudios'],
      degradationReason: 'COMFYUI_REFERENCE_AUDIO_UNSUPPORTED_WITH_FIRSTLAST',
    })
    expect(route.profile.inputMappings.referenceAudios).toBeUndefined()
  })

  it('uses a real combined Profile Set variant instead of degrading reference audio', () => {
    const validated = validateComfyUIProfileDefinition({
      version: 1,
      mediaType: 'video',
      variants: {
        firstLastFrame: createFirstLastFrameProfile(),
        firstLastReferenceAudio: createVideoProfileWithFrameAndAudioMappings(),
      },
    })
    if (!validated.ok) throw new Error(validated.message)

    const route = routeComfyUIVideoProfile({
      profile: validated.profile,
      generationMode: 'firstlastframe',
      requestedReferenceAudioCount: 2,
    })

    expect(route.plan).toMatchObject({
      effectiveVariant: 'firstLastReferenceAudio',
    })
    expect(route.plan.degradedCapabilities).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import {
  type CapabilitySelections,
  type ModelCapabilities,
  type UnifiedModelType,
} from '@/lib/model-config-contract'
import { resolveGenerationOptionsForModel } from '@/lib/model-capabilities/lookup'

describe('model-capabilities/lookup - image resolution defaulting', () => {
  const modelType: UnifiedModelType = 'image'
  const modelKey = 'google::test-image-model'

  const capabilities: ModelCapabilities = {
    image: {
      resolutionOptions: ['0.5K', '1K', '2K'],
    },
  }

  it('auto-fills resolution with first option when missing and required', () => {
    const capabilityDefaults: CapabilitySelections = {}

    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      capabilityDefaults,
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      resolution: '0.5K',
    })
  })

  it('does not override user-provided resolution', () => {
    const capabilityDefaults: CapabilitySelections = {
      [modelKey]: {
        resolution: '2K',
      },
    }

    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      capabilityDefaults,
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      resolution: '2K',
    })
  })
})


describe('model-capabilities/lookup - video duration defaulting', () => {
  const modelType: UnifiedModelType = 'video'
  const modelKey = 'ark::doubao-seedance-2-0-260128'

  const capabilities: ModelCapabilities = {
    video: {
      generationModeOptions: ['normal'],
      generateAudioOptions: [true, false],
      durationOptions: [4, 5, 6, 7, 8],
    },
  }

  it('auto-fills duration with the shortest option when missing and required', () => {
    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      runtimeSelections: { generationMode: 'normal', generateAudio: true },
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options.duration).toBe(4)
    expect(result.options.generateAudio).toBe(true)
  })

  it('does not override a provided duration', () => {
    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      runtimeSelections: { generationMode: 'normal', generateAudio: true, duration: 8 },
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options.duration).toBe(8)
  })

  it('keeps reporting invalid duration values instead of masking them', () => {
    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      runtimeSelections: { generationMode: 'normal', generateAudio: true, duration: 99 },
      requireAllFields: true,
    })

    expect(result.issues.some((issue) => issue.code === 'CAPABILITY_VALUE_NOT_ALLOWED')).toBe(true)
  })
})

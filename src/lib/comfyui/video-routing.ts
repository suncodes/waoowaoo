import {
  getComfyUIProfileSetVariant,
  getComfyUIScalarInputMapping,
  isComfyUICollectionInputMapping,
  isComfyUIProfileSet,
  type ComfyUIProfile,
  type ComfyUIProfileDefinition,
  type ComfyUIVideoProfileVariant,
} from './profile'

export type ComfyUIVideoGenerationMode = 'normal' | 'firstlastframe'
export type ComfyUIVideoEffectiveVariant = 'legacy' | ComfyUIVideoProfileVariant
export type ComfyUIVideoDegradedCapability = 'referenceAudios'
export type ComfyUIVideoDegradationReason =
  | 'COMFYUI_REFERENCE_AUDIO_UNSUPPORTED_WITH_FIRSTLAST'

/**
 * 固定到提示词快照的 ComfyUI 工作流决策。
 *
 * Profile Set 不会把节点图在运行时拼接；这里仅记录选中了哪个完整 Profile，
 * 以及是否按产品规则丢弃了不兼容的参考音频。
 */
export interface ComfyUIVideoRoutingPlan {
  requestedGenerationMode: ComfyUIVideoGenerationMode
  requestedReferenceAudioCount: number
  effectiveVariant: ComfyUIVideoEffectiveVariant
  degradedCapabilities?: ComfyUIVideoDegradedCapability[]
  degradationReason?: ComfyUIVideoDegradationReason
}

export interface ComfyUIVideoProfileRoute {
  profile: ComfyUIProfile
  plan: ComfyUIVideoRoutingPlan
}

export class ComfyUIVideoRoutingError extends Error {
  constructor(
    readonly code:
      | 'COMFYUI_VIDEO_VARIANT_REQUIRED'
      | 'COMFYUI_VIDEO_FIRSTLAST_UNSUPPORTED'
      | 'COMFYUI_VIDEO_REFERENCE_AUDIO_UNSUPPORTED'
      | 'COMFYUI_VIDEO_REFERENCE_AUDIO_CAPACITY_UNSUPPORTED',
    message: string,
  ) {
    super(`${code}: ${message}`)
    this.name = 'ComfyUIVideoRoutingError'
  }
}

function normalizeRequestedReferenceAudioCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
}

function getReferenceAudioCapacity(profile: ComfyUIProfile): number {
  const mapping = profile.inputMappings.referenceAudios
  return isComfyUICollectionInputMapping(mapping) ? mapping.itemMappings.length : 0
}

function supportsFirstLastFrame(profile: ComfyUIProfile): boolean {
  return !!getComfyUIScalarInputMapping(profile, 'image')
    && !!getComfyUIScalarInputMapping(profile, 'lastFrameImage')
}

function createPlan(input: {
  generationMode: ComfyUIVideoGenerationMode
  requestedReferenceAudioCount: number
  effectiveVariant: ComfyUIVideoEffectiveVariant
  degradeReferenceAudios?: boolean
}): ComfyUIVideoRoutingPlan {
  if (!input.degradeReferenceAudios) {
    return {
      requestedGenerationMode: input.generationMode,
      requestedReferenceAudioCount: input.requestedReferenceAudioCount,
      effectiveVariant: input.effectiveVariant,
    }
  }
  return {
    requestedGenerationMode: input.generationMode,
    requestedReferenceAudioCount: input.requestedReferenceAudioCount,
    effectiveVariant: input.effectiveVariant,
    degradedCapabilities: ['referenceAudios'],
    degradationReason: 'COMFYUI_REFERENCE_AUDIO_UNSUPPORTED_WITH_FIRSTLAST',
  }
}

function requireVariant(
  profileSet: Extract<ComfyUIProfileDefinition, { variants: unknown }>,
  variant: ComfyUIVideoProfileVariant,
): ComfyUIProfile {
  const profile = getComfyUIProfileSetVariant(profileSet, variant)
  if (profile) return profile
  throw new ComfyUIVideoRoutingError(
    'COMFYUI_VIDEO_VARIANT_REQUIRED',
    `ComfyUI Profile Set 缺少 ${variant} 工作流。`,
  )
}

/**
 * 根据本次视频请求选择一个完整的 ComfyUI 工作流。
 *
 * 唯一允许的自动降级是「首尾帧 + 参考音频」缺少可执行组合工作流时，优先
 * 首尾帧并丢弃参考音频。普通参考音频请求不会被静默丢弃。
 */
export function routeComfyUIVideoProfile(input: {
  profile: ComfyUIProfileDefinition
  generationMode: ComfyUIVideoGenerationMode
  requestedReferenceAudioCount?: number
}): ComfyUIVideoProfileRoute {
  const requestedReferenceAudioCount = normalizeRequestedReferenceAudioCount(
    input.requestedReferenceAudioCount,
  )

  if (!isComfyUIProfileSet(input.profile)) {
    const profile = input.profile
    const firstLastSupported = supportsFirstLastFrame(profile)
    const referenceAudioCapacity = getReferenceAudioCapacity(profile)

    if (input.generationMode === 'firstlastframe' && !firstLastSupported) {
      throw new ComfyUIVideoRoutingError(
        'COMFYUI_VIDEO_FIRSTLAST_UNSUPPORTED',
        '当前 ComfyUI Profile 不支持首尾帧视频。',
      )
    }
    if (requestedReferenceAudioCount > 0 && referenceAudioCapacity < requestedReferenceAudioCount) {
      if (input.generationMode === 'firstlastframe') {
        return {
          profile,
          plan: createPlan({
            generationMode: input.generationMode,
            requestedReferenceAudioCount,
            effectiveVariant: 'legacy',
            degradeReferenceAudios: true,
          }),
        }
      }
      throw new ComfyUIVideoRoutingError(
        referenceAudioCapacity === 0
          ? 'COMFYUI_VIDEO_REFERENCE_AUDIO_UNSUPPORTED'
          : 'COMFYUI_VIDEO_REFERENCE_AUDIO_CAPACITY_UNSUPPORTED',
        referenceAudioCapacity === 0
          ? '当前 ComfyUI Profile 不支持参考音频。'
          : `当前 ComfyUI Profile 最多支持 ${referenceAudioCapacity} 条参考音频。`,
      )
    }
    return {
      profile,
      plan: createPlan({
        generationMode: input.generationMode,
        requestedReferenceAudioCount,
        effectiveVariant: 'legacy',
      }),
    }
  }

  if (input.generationMode === 'normal') {
    if (requestedReferenceAudioCount === 0) {
      const profile = requireVariant(input.profile, 't2v')
      return {
        profile,
        plan: createPlan({
          generationMode: input.generationMode,
          requestedReferenceAudioCount,
          effectiveVariant: 't2v',
        }),
      }
    }

    const profile = requireVariant(input.profile, 'referenceAudio')
    const capacity = getReferenceAudioCapacity(profile)
    if (capacity < requestedReferenceAudioCount) {
      throw new ComfyUIVideoRoutingError(
        'COMFYUI_VIDEO_REFERENCE_AUDIO_CAPACITY_UNSUPPORTED',
        `当前 ComfyUI 参考音频工作流最多支持 ${capacity} 条参考音频。`,
      )
    }
    return {
      profile,
      plan: createPlan({
        generationMode: input.generationMode,
        requestedReferenceAudioCount,
        effectiveVariant: 'referenceAudio',
      }),
    }
  }

  const firstLastFrameProfile = requireVariant(input.profile, 'firstLastFrame')
  if (requestedReferenceAudioCount === 0) {
    return {
      profile: firstLastFrameProfile,
      plan: createPlan({
        generationMode: input.generationMode,
        requestedReferenceAudioCount,
        effectiveVariant: 'firstLastFrame',
      }),
    }
  }

  const combinedProfile = getComfyUIProfileSetVariant(input.profile, 'firstLastReferenceAudio')
  if (combinedProfile && getReferenceAudioCapacity(combinedProfile) >= requestedReferenceAudioCount) {
    return {
      profile: combinedProfile,
      plan: createPlan({
        generationMode: input.generationMode,
        requestedReferenceAudioCount,
        effectiveVariant: 'firstLastReferenceAudio',
      }),
    }
  }

  return {
    profile: firstLastFrameProfile,
    plan: createPlan({
      generationMode: input.generationMode,
      requestedReferenceAudioCount,
      effectiveVariant: 'firstLastFrame',
      degradeReferenceAudios: true,
    }),
  }
}

export function isComfyUIReferenceAudioDegraded(
  plan: ComfyUIVideoRoutingPlan | null | undefined,
): boolean {
  return plan?.degradedCapabilities?.includes('referenceAudios') === true
}

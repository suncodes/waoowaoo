import type { ModelCapabilities } from '@/lib/model-config-contract'
import {
  getComfyUIProfileSetVariant,
  getComfyUIScalarInputMapping,
  isComfyUICollectionInputMapping,
  isComfyUIProfileSet,
  type ComfyUIProfile,
  type ComfyUIProfileDefinition,
} from './profile'

/**
 * 根据已校验的 ComfyUI Profile 推导可安全暴露给业务层的能力。
 *
 * 用户配置的 capabilities 不是可信来源；这里仅依据实际可写入的工作流映射
 * 生成首尾帧和参考音频能力，避免界面展示运行时无法执行的选项。
 */
function supportsFirstLastFrame(profile: ComfyUIProfile): boolean {
  const imageMapping = getComfyUIScalarInputMapping(profile, 'image')
  const lastFrameImageMapping = getComfyUIScalarInputMapping(profile, 'lastFrameImage')
  return !!imageMapping && !!lastFrameImageMapping
}

function getReferenceAudioCapacity(profile: ComfyUIProfile | undefined): number {
  const mapping = profile?.inputMappings.referenceAudios
  return isComfyUICollectionInputMapping(mapping) ? mapping.itemMappings.length : 0
}

/**
 * 根据已校验的 ComfyUI Profile / Profile Set 推导可安全暴露给业务层的能力。
 *
 * 对 Profile Set，独立参考音频和首尾帧组合能力分别来自不同完整工作流；
 * 不把它们误认为可以在运行时拼接。
 */
export function deriveComfyUIProfileCapabilities(profile: ComfyUIProfileDefinition): ModelCapabilities | undefined {
  if (isComfyUIProfileSet(profile)) {
    const textToVideoProfile = getComfyUIProfileSetVariant(profile, 't2v')
    const firstLastFrameProfile = getComfyUIProfileSetVariant(profile, 'firstLastFrame')
    const referenceAudioProfile = getComfyUIProfileSetVariant(profile, 'referenceAudio')
    const firstLastReferenceAudioProfile = getComfyUIProfileSetVariant(profile, 'firstLastReferenceAudio')
    const referenceAudioMaxCount = getReferenceAudioCapacity(referenceAudioProfile)
    const firstLastReferenceAudioMaxCount = getReferenceAudioCapacity(firstLastReferenceAudioProfile)

    const video = {
      ...(firstLastFrameProfile && supportsFirstLastFrame(firstLastFrameProfile)
        ? {
          firstlastframe: true,
          generationModeOptions: [
            ...((textToVideoProfile || referenceAudioProfile) ? ['normal'] : []),
            'firstlastframe',
          ],
        }
        : {}),
      ...(referenceAudioMaxCount > 0 ? { referenceAudioMaxCount } : {}),
      ...(firstLastReferenceAudioMaxCount > 0 ? { firstLastReferenceAudioMaxCount } : {}),
    }
    return Object.keys(video).length > 0 ? { video } : undefined
  }

  if (profile.mediaType !== 'video') return undefined

  const referenceAudioMaxCount = getReferenceAudioCapacity(profile)

  const video = {
    ...(supportsFirstLastFrame(profile)
      ? {
        firstlastframe: true,
        generationModeOptions: ['firstlastframe'],
      }
      : {}),
    ...(referenceAudioMaxCount > 0 ? { referenceAudioMaxCount } : {}),
    ...(supportsFirstLastFrame(profile) && referenceAudioMaxCount > 0
      ? { firstLastReferenceAudioMaxCount: referenceAudioMaxCount }
      : {}),
  }

  return Object.keys(video).length > 0 ? { video } : undefined
}

export function getComfyUIReferenceAudioMaxCount(profile: ComfyUIProfileDefinition): number {
  if (isComfyUIProfileSet(profile)) {
    return getReferenceAudioCapacity(getComfyUIProfileSetVariant(profile, 'referenceAudio'))
  }
  return getReferenceAudioCapacity(profile)
}

export function getComfyUIFirstLastReferenceAudioMaxCount(profile: ComfyUIProfileDefinition): number {
  if (isComfyUIProfileSet(profile)) {
    return getReferenceAudioCapacity(getComfyUIProfileSetVariant(profile, 'firstLastReferenceAudio'))
  }
  return supportsFirstLastFrame(profile) ? getReferenceAudioCapacity(profile) : 0
}

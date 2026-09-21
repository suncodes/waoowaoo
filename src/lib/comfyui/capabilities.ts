import type { ModelCapabilities } from '@/lib/model-config-contract'
import {
  getComfyUIScalarInputMapping,
  isComfyUICollectionInputMapping,
  type ComfyUIProfile,
} from './profile'

/**
 * 根据已校验的 ComfyUI Profile 推导可安全暴露给业务层的能力。
 *
 * 用户配置的 capabilities 不是可信来源；这里仅依据实际可写入的工作流映射
 * 生成首尾帧和参考音频能力，避免界面展示运行时无法执行的选项。
 */
export function deriveComfyUIProfileCapabilities(profile: ComfyUIProfile): ModelCapabilities | undefined {
  if (profile.mediaType !== 'video') return undefined

  const imageMapping = getComfyUIScalarInputMapping(profile, 'image')
  const lastFrameImageMapping = getComfyUIScalarInputMapping(profile, 'lastFrameImage')
  const referenceAudioMapping = profile.inputMappings.referenceAudios
  const supportsReferenceAudio = isComfyUICollectionInputMapping(referenceAudioMapping)

  const video = {
    ...(imageMapping && lastFrameImageMapping
      ? {
        firstlastframe: true,
        generationModeOptions: ['firstlastframe'],
      }
      : {}),
    ...(supportsReferenceAudio
      ? {
        referenceAudioMaxCount: referenceAudioMapping.itemMappings.length,
      }
      : {}),
  }

  return Object.keys(video).length > 0 ? { video } : undefined
}

export function getComfyUIReferenceAudioMaxCount(profile: ComfyUIProfile): number {
  const mapping = profile.inputMappings.referenceAudios
  return isComfyUICollectionInputMapping(mapping) ? mapping.itemMappings.length : 0
}

'use client'

import { useMemo } from 'react'
import type { NovelPromotionWorkspaceProps } from '../types'
import type { CapabilitySelections } from '@/lib/model-config-contract'
import { resolveVideoProfile } from '@/lib/video-profile'
import { isCreationWorkspaceV2Enabled } from '@/lib/creation-workspace/feature'
import { resolveCreationStageRoute } from '@/lib/creation-workspace/stages'

function parseCapabilitySelections(raw: unknown): CapabilitySelections {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as CapabilitySelections
  }
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as CapabilitySelections
  } catch {
    return {}
  }
}

export function useWorkspaceProjectSnapshot({
  project,
  episode,
  urlStage,
  urlStageView,
}: Pick<NovelPromotionWorkspaceProps, 'project' | 'episode' | 'urlStage' | 'urlStageView'>) {
  return useMemo(() => {
    const projectData = project.novelPromotionData
    const capabilityOverrides = parseCapabilitySelections(projectData?.capabilityOverrides)
    const workspaceV2Enabled = isCreationWorkspaceV2Enabled()
    const legacyStage = (() => {
      if (urlStage === 'editor' || urlStage === 'voice') return 'videos'
      if (urlStage === 'assets') return 'script'
      if (urlStage === 'text-storyboard') return 'storyboard'
      return urlStage || 'config'
    })()
    const creationRoute = resolveCreationStageRoute(urlStage, urlStageView)
    return {
      projectData,
      projectCharacters: projectData?.characters || [],
      projectLocations: projectData?.locations || [],
      episodeStoryboards: episode?.storyboards || [],
      currentStage: workspaceV2Enabled ? creationRoute.stageId : legacyStage,
      stageView: workspaceV2Enabled ? creationRoute.view : undefined,
      workspaceV2Enabled,
      globalAssetText: projectData?.globalAssetText || '',
      novelText: episode?.novelText || '',
      contentPlan: episode?.contentPlan,
      analysisModel: projectData?.analysisModel,
      characterModel: projectData?.characterModel,
      locationModel: projectData?.locationModel,
      storyboardModel: projectData?.storyboardModel,
      editModel: projectData?.editModel,
      videoModel: projectData?.videoModel,
      audioModel: projectData?.audioModel,
      videoRatio: projectData?.videoRatio,
      capabilityOverrides,
      ttsRate: projectData?.ttsRate,
      artStyle: projectData?.artStyle,
      artStyleMode: projectData?.artStyleMode === 'custom' ? 'custom' : 'preset',
      artStylePrompt: projectData?.artStylePrompt || '',
      artStyleReferenceEnabled: projectData?.artStyleReferenceEnabled === true,
      customArtStyleReferenceImage: projectData?.customArtStyleReferenceImage || '',
      customArtStyleReferenceImageUrl: projectData?.customArtStyleReferenceImageUrl || projectData?.customArtStyleReferenceImage || '',
      videoProfile: resolveVideoProfile(projectData?.videoProfile),
    }
  }, [episode?.contentPlan, episode?.novelText, episode?.storyboards, project.novelPromotionData, urlStage, urlStageView])
}

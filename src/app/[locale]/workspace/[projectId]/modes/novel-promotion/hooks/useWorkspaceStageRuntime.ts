'use client'

import { useCallback, useMemo, useState } from 'react'
import type { StoryboardGenerationOptions, WorkspaceStageRuntimeValue } from '../WorkspaceStageRuntimeContext'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/model-config-contract'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'
import type { BatchVideoGenerationParams, VideoGenerationOptions } from '../components/video'
import { resolveVideoProfile, type VideoProfile } from '@/lib/video-profile'
import type { ContentPlan } from '@/lib/content-planning'
import type { VisualPlanResult, VisualUnit } from '@/lib/visual-planning'
import type { WorkspaceArtifactCommandResult } from '@/lib/creation-workspace/commands'

interface UseWorkspaceStageRuntimeParams {
  assetsLoading: boolean
  isAssetAnalysisRunning: boolean
  isSubmittingTTS: boolean
  isTransitioning: boolean
  isConfirmingAssets: boolean
  isStartingStoryToScript: boolean
  isStartingScriptToStoryboard: boolean
  videoRatio: string | undefined
  videoProfile: VideoProfile
  artStyle: string | undefined
  artStyleReferenceEnabled: boolean
  videoModel: string | undefined
  capabilityOverrides: CapabilitySelections
  userVideoModels: Array<{
    value: string
    label: string
    provider?: string
    providerName?: string
    capabilities?: ModelCapabilities
    videoPricingTiers?: VideoPricingTier[]
  }> | undefined
  handleUpdateEpisode: (key: string, value: unknown) => Promise<void>
  handleUpdateConfig: (key: string, value: unknown) => Promise<void>
  runWithRebuildConfirm: (action: 'storyToScript' | 'scriptToStoryboard', operation: () => Promise<void>) => Promise<void>
  runStoryToScriptFlow: () => Promise<void>
  runContentUnitRewrite: (unitId: string, instruction?: string) => Promise<void>
  runVisualPlanFlow: (instruction?: string, options?: { forceRegenerate?: boolean }) => Promise<void>
  runScriptToStoryboardFlow: (options?: StoryboardGenerationOptions) => Promise<void>
  handleAnalyzeAssets: () => Promise<void>
  handleUpdateClip: (clipId: string, updates: Record<string, unknown>) => Promise<void>
  openAssetLibrary: (characterId?: string | null, refreshAssets?: boolean) => void
  handleStageChange: (stage: string) => void
  handleGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    videoModel?: string,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      flModel: string
      customPrompt?: string
    },
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
    requestOptions?: {
      allowSpeechPlanMissing?: boolean
      allowSpeechlessVideo?: boolean
      preparedPromptArtifactId?: string
    },
  ) => Promise<void>
  handleGenerateAllVideos: (options?: BatchVideoGenerationParams) => Promise<void>
  handleUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: 'videoPrompt' | 'firstLastFramePrompt',
  ) => Promise<void>
  handleUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
  saveGuidePlan: (value: ContentPlan, changedUnitIds: string[]) => Promise<WorkspaceArtifactCommandResult>
  saveVisualPlan: (shotPlan: VisualPlanResult['shotPlan'], visualUnits: VisualUnit[]) => Promise<WorkspaceArtifactCommandResult>
  toggleContentLock: (unitId: string, locked: boolean) => Promise<WorkspaceArtifactCommandResult>
  acceptContentCandidate: (unitId: string) => Promise<WorkspaceArtifactCommandResult>
  discardContentCandidate: (unitId: string) => Promise<WorkspaceArtifactCommandResult>
  restoreContentUnit: (unitId: string) => Promise<WorkspaceArtifactCommandResult>
  approveStage: (stageId: 'content' | 'visual-design') => Promise<WorkspaceArtifactCommandResult>
  approveAssetRequirements: () => Promise<WorkspaceArtifactCommandResult>
  materializeGuideStoryboard: () => Promise<WorkspaceArtifactCommandResult>
}

export function useWorkspaceStageRuntime({
  assetsLoading,
  isAssetAnalysisRunning,
  isSubmittingTTS,
  isTransitioning,
  isConfirmingAssets,
  isStartingStoryToScript,
  isStartingScriptToStoryboard,
  videoRatio,
  videoProfile,
  artStyle,
  artStyleReferenceEnabled,
  videoModel,
  capabilityOverrides,
  userVideoModels,
  handleUpdateEpisode,
  handleUpdateConfig,
  runWithRebuildConfirm,
  runStoryToScriptFlow,
  runContentUnitRewrite,
  runVisualPlanFlow,
  runScriptToStoryboardFlow,
  handleAnalyzeAssets,
  handleUpdateClip,
  openAssetLibrary,
  handleStageChange,
  handleGenerateVideo,
  handleGenerateAllVideos,
  handleUpdateVideoPrompt,
  handleUpdatePanelVideoModel,
  saveGuidePlan,
  saveVisualPlan,
  toggleContentLock,
  acceptContentCandidate,
  discardContentCandidate,
  restoreContentUnit,
  approveStage,
  approveAssetRequirements,
  materializeGuideStoryboard,
}: UseWorkspaceStageRuntimeParams) {
  const [contentEditingState, setContentEditingState] = useState({ dirty: false, saving: false })
  const onContentEditingStateChange = useCallback((next: { dirty: boolean; saving: boolean }) => {
    setContentEditingState((previous) => (
      previous.dirty === next.dirty && previous.saving === next.saving ? previous : next
    ))
  }, [])
  const resolvedUserVideoModels = useMemo(
    () => userVideoModels || [],
    [userVideoModels],
  )

  return useMemo<WorkspaceStageRuntimeValue>(() => ({
    assetsLoading,
    isAssetAnalysisRunning,
    isSubmittingTTS,
    isTransitioning,
    isConfirmingAssets,
    isStartingStoryToScript,
    isStartingScriptToStoryboard,
    videoRatio,
    videoProfile,
    artStyle,
    artStyleReferenceEnabled,
    videoModel,
    capabilityOverrides,
    userVideoModels: resolvedUserVideoModels,
    contentEditingState,
    onContentEditingStateChange,
    onNovelTextChange: (value) => handleUpdateEpisode('novelText', value),
    onContentPlanChange: (value) => handleUpdateEpisode('contentPlan', value),
    onSaveGuidePlan: saveGuidePlan,
    onSaveVisualPlan: saveVisualPlan,
    onToggleContentLock: toggleContentLock,
    onRegenerateContentUnit: runContentUnitRewrite,
    onAcceptContentCandidate: acceptContentCandidate,
    onDiscardContentCandidate: discardContentCandidate,
    onRestoreContentUnit: restoreContentUnit,
    onApproveStage: approveStage,
    onApproveAssetRequirements: approveAssetRequirements,
    onMaterializeGuideStoryboard: materializeGuideStoryboard,
    onVideoRatioChange: (value) => handleUpdateConfig('videoRatio', value),
    onVideoProfileChange: (preset) => handleUpdateConfig('videoProfile', resolveVideoProfile({ preset })),
    onArtStyleChange: async (value) => {
      await handleUpdateConfig('artStyleMode', 'preset')
      await handleUpdateConfig('artStyle', value)
    },
    onArtStyleReferenceEnabledChange: (value) => handleUpdateConfig('artStyleReferenceEnabled', value),
    onRunStoryToScript: () => runWithRebuildConfirm('storyToScript', runStoryToScriptFlow),
    onRunVisualPlan: (instruction, options) => runWithRebuildConfirm('scriptToStoryboard', () => runVisualPlanFlow(instruction, options)),
    onAnalyzeAssets: handleAnalyzeAssets,
    onClipUpdate: (clipId, data) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('onClipUpdate requires a plain object payload')
      }
      return handleUpdateClip(clipId, data as Record<string, unknown>)
    },
    onOpenAssetLibrary: () => openAssetLibrary(),
    onRunScriptToStoryboard: (options) => runWithRebuildConfirm('scriptToStoryboard', () => runScriptToStoryboardFlow(options)),
    onStageChange: handleStageChange,
    onGenerateVideo: handleGenerateVideo,
    onGenerateAllVideos: handleGenerateAllVideos,
    onUpdateVideoPrompt: handleUpdateVideoPrompt,
    onUpdatePanelVideoModel: handleUpdatePanelVideoModel,
    onOpenAssetLibraryForCharacter: (characterId, refreshAssets) => openAssetLibrary(characterId, refreshAssets),
  }), [
    artStyle,
    artStyleReferenceEnabled,
    assetsLoading,
    isAssetAnalysisRunning,
    handleGenerateAllVideos,
    handleGenerateVideo,
    handleStageChange,
    handleAnalyzeAssets,
    handleUpdateClip,
    handleUpdateConfig,
    handleUpdateEpisode,
    handleUpdatePanelVideoModel,
    handleUpdateVideoPrompt,
    isConfirmingAssets,
    isStartingScriptToStoryboard,
    isStartingStoryToScript,
    isSubmittingTTS,
    isTransitioning,
    openAssetLibrary,
    runScriptToStoryboardFlow,
    runContentUnitRewrite,
    runStoryToScriptFlow,
    runVisualPlanFlow,
    runWithRebuildConfirm,
    saveGuidePlan,
    saveVisualPlan,
    toggleContentLock,
    acceptContentCandidate,
    discardContentCandidate,
    restoreContentUnit,
    approveStage,
    approveAssetRequirements,
    materializeGuideStoryboard,
    resolvedUserVideoModels,
    capabilityOverrides,
    contentEditingState,
    videoModel,
    videoProfile,
    videoRatio,
    onContentEditingStateChange,
  ])
}

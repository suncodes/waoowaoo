'use client'

import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import { useRebuildConfirm } from './useRebuildConfirm'
import { useWorkspaceUserModels } from './useWorkspaceUserModels'
import { useWorkspaceExecution } from './useWorkspaceExecution'
import { useWorkspaceVideoActions } from './useWorkspaceVideoActions'
import { useWorkspaceAssetLibraryShell } from './useWorkspaceAssetLibraryShell'
import { useWorkspaceStageNavigation } from './useWorkspaceStageNavigation'
import { useWorkspaceProjectSnapshot } from './useWorkspaceProjectSnapshot'
import { useWorkspaceModalEscape } from './useWorkspaceModalEscape'
import { useWorkspaceStageRuntime } from './useWorkspaceStageRuntime'
import { useWorkspaceConfigActions } from './useWorkspaceConfigActions'
import { useWorkspaceAutoRun } from './useWorkspaceAutoRun'
import { buildWorkspaceControllerViewModel } from './workspace-controller-view-model'
import type { NovelPromotionWorkspaceProps } from '../types'
import { useRouter } from '@/i18n/navigation'
import { resolveEpisodeStageArtifacts } from '@/lib/novel-promotion/stage-readiness'

export function useNovelPromotionWorkspaceController({
  project,
  projectId,
  episodeId,
  episode,
  urlStage,
  onStageChange,
}: NovelPromotionWorkspaceProps) {
  const t = useTranslations('novelPromotion')
  const te = useTranslations('errors')
  const tc = useTranslations('common')

  const searchParams = useSearchParams()
  const router = useRouter()
  const { onRefresh } = useWorkspaceProvider()

  const projectSnapshot = useWorkspaceProjectSnapshot({ project, episode, urlStage })
  const { currentStage, ...projectSection } = projectSnapshot

  const assetsLoading = false
  const assetsLoadingState = assetsLoading
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'process',
      resource: 'image',
      hasOutput: false,
    })
    : null

  useEffect(() => {
    _ulogInfo(
      '[NovelPromotionWorkspace] project prop 更新, characters:',
      project?.novelPromotionData?.characters?.length,
    )
  }, [project])

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isWorldContextModalOpen, setIsWorldContextModalOpen] = useState(false)

  const assetLibrary = useWorkspaceAssetLibraryShell({
    currentStage,
    searchParams,
    router,
    onRefresh,
  })

  useWorkspaceModalEscape({
    isAssetLibraryOpen: assetLibrary.isAssetLibraryOpen,
    closeAssetLibrary: assetLibrary.closeAssetLibrary,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    isWorldContextModalOpen,
    setIsWorldContextModalOpen,
  })

  const configActions = useWorkspaceConfigActions({
    projectId,
    episodeId,
    onStageChange,
  })

  const rebuildState = useRebuildConfirm({
    episodeId,
    episodeStoryboards: episode?.storyboards,
    getProjectStoryboardStats: configActions.getProjectStoryboardStats,
    t,
  })

  const userModels = useWorkspaceUserModels()

  const execution = useWorkspaceExecution({
    projectId,
    episodeId,
    currentStage,
    analysisModel: projectSnapshot.analysisModel,
    videoProfile: projectSnapshot.videoProfile,
    contentPlan: projectSnapshot.contentPlan,
    novelText: projectSnapshot.novelText,
    t,
    onRefresh,
    onUpdateConfig: configActions.handleUpdateConfig,
    onStageChange: configActions.handleStageChange,
    onOpenAssetLibrary: assetLibrary.openAssetLibrary,
  })

  const videoActions = useWorkspaceVideoActions({
    projectId,
    episodeId,
    t,
  })

  const isStartingStoryToScript = rebuildState.pendingActionType === 'storyToScript'
  const isStartingScriptToStoryboard = rebuildState.pendingActionType === 'scriptToStoryboard'
  const isStoryToScriptRunning =
    execution.storyToScriptStream.isRunning ||
    execution.storyToScriptStream.isRecoveredRunning ||
    execution.storyToScriptStream.status === 'running'
  const stageArtifacts = resolveEpisodeStageArtifacts(episode)

  useWorkspaceAutoRun({
    searchParams,
    router,
    episodeId,
    novelText: projectSnapshot.novelText,
    isTransitioning: execution.isTransitioning,
    isStoryToScriptRunning,
    runWithRebuildConfirm: rebuildState.runWithRebuildConfirm,
    runStoryToScriptFlow: execution.runStoryToScriptFlow,
  })

  const workflowItems = useWorkspaceStageNavigation({
    stageArtifacts,
    videoProfile: projectSnapshot.videoProfile,
    contentPlanStream: execution.contentPlanStream,
    storyToScriptStream: execution.storyToScriptStream,
    visualPlanStream: execution.visualPlanStream,
    scriptToStoryboardStream: execution.scriptToStoryboardStream,
    t,
  })

  const stageRuntime = useWorkspaceStageRuntime({
    assetsLoading,
    isSubmittingTTS: execution.isSubmittingTTS,
    isTransitioning: execution.isTransitioning,
    isConfirmingAssets: execution.isConfirmingAssets,
    isStartingStoryToScript,
    isStartingScriptToStoryboard,
    videoRatio: projectSnapshot.videoRatio,
    videoProfile: projectSnapshot.videoProfile,
    artStyle: projectSnapshot.artStyle,
    artStyleReferenceEnabled: projectSnapshot.artStyleReferenceEnabled,
    videoModel: projectSnapshot.videoModel,
    capabilityOverrides: projectSnapshot.capabilityOverrides,
    userVideoModels: userModels.userVideoModels || [],
    handleUpdateEpisode: configActions.handleUpdateEpisode,
    handleUpdateConfig: configActions.handleUpdateConfig,
    runWithRebuildConfirm: rebuildState.runWithRebuildConfirm,
    runStoryToScriptFlow: execution.runStoryToScriptFlow,
    runScriptToStoryboardFlow: execution.runScriptToStoryboardFlow,
    handleUpdateClip: videoActions.handleUpdateClip,
    openAssetLibrary: assetLibrary.openAssetLibrary,
    handleStageChange: configActions.handleStageChange,
    handleGenerateVideo: videoActions.handleGenerateVideo,
    handleGenerateAllVideos: videoActions.handleGenerateAllVideos,
    handleUpdateVideoPrompt: videoActions.handleUpdateVideoPrompt,
    handleUpdatePanelVideoModel: videoActions.handleUpdatePanelVideoModel,
  })

  const uiState = {
    onRefresh,
    assetsLoading,
    assetsLoadingState,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    isWorldContextModalOpen,
    setIsWorldContextModalOpen,
    isAssetLibraryOpen: assetLibrary.isAssetLibraryOpen,
    assetLibraryFocusCharacterId: assetLibrary.assetLibraryFocusCharacterId,
    assetLibraryFocusRequestId: assetLibrary.assetLibraryFocusRequestId,
    triggerGlobalAnalyzeOnOpen: assetLibrary.triggerGlobalAnalyzeOnOpen,
    setTriggerGlobalAnalyzeOnOpen: assetLibrary.setTriggerGlobalAnalyzeOnOpen,
    openAssetLibrary: assetLibrary.openAssetLibrary,
    closeAssetLibrary: assetLibrary.closeAssetLibrary,
    userModelsForSettings: userModels.userModelsForSettings,
    userVideoModels: userModels.userVideoModels || [],
    userModelsLoaded: userModels.userModelsLoaded,
  }

  const stageNavState = {
    currentStage,
    workflowItems,
    handleStageChange: configActions.handleStageChange,
  }

  const executionState = {
    isSubmittingTTS: execution.isSubmittingTTS,
    isAssetAnalysisRunning: execution.isAssetAnalysisRunning,
    isConfirmingAssets: execution.isConfirmingAssets,
    isTransitioning: execution.isTransitioning,
    isStartingStoryToScript,
    isStartingScriptToStoryboard,
    transitionProgress: execution.transitionProgress,
    storyToScriptStream: execution.storyToScriptStream,
    scriptToStoryboardStream: execution.scriptToStoryboardStream,
    contentPlanStream: execution.contentPlanStream,
    visualPlanStream: execution.visualPlanStream,
    handleGenerateTTS: execution.handleGenerateTTS,
    handleAnalyzeAssets: execution.handleAnalyzeAssets,
    runStoryToScriptFlow: execution.runStoryToScriptFlow,
    runScriptToStoryboardFlow: execution.runScriptToStoryboardFlow,
    showCreatingToast: execution.showCreatingToast,
  }

  const videoState = {
    handleGenerateVideo: videoActions.handleGenerateVideo,
    handleGenerateAllVideos: videoActions.handleGenerateAllVideos,
    handleUpdateVideoPrompt: videoActions.handleUpdateVideoPrompt,
    handleUpdatePanelVideoModel: videoActions.handleUpdatePanelVideoModel,
    handleUpdateClip: videoActions.handleUpdateClip,
  }

  const actionsState = {
    handleUpdateConfig: configActions.handleUpdateConfig,
    handleUpdateEpisode: configActions.handleUpdateEpisode,
  }

  return buildWorkspaceControllerViewModel({
    t,
    tc,
    te,
    projectSnapshot: projectSection,
    uiState,
    stageNavState,
    rebuildState,
    executionState,
    videoState,
    stageRuntime,
    actionsState,
  })
}

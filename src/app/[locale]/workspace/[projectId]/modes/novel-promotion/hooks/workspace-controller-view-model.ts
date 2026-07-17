'use client'

import type { UserModelsPayload } from './useWorkspaceUserModels'
import type { WorkspaceStageRuntimeValue } from '../WorkspaceStageRuntimeContext'
import type { TaskPresentationState } from '@/lib/task/presentation'
import type { BatchVideoGenerationParams, VideoGenerationOptions } from '../components/video'
import type { CapabilitySelections } from '@/lib/model-config-contract'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'
import type { VideoProfile } from '@/lib/video-profile'
import type {
  useContentPlanRunStream,
  useScriptToStoryboardRunStream,
  useStoryToScriptRunStream,
  useVisualPlanRunStream,
} from '@/lib/query/hooks'
import type { WorkspaceStageNavItem } from './useWorkspaceStageNavigation'

type StoryToScriptStreamState = ReturnType<typeof useStoryToScriptRunStream>
type ScriptToStoryboardStreamState = ReturnType<typeof useScriptToStoryboardRunStream>
type ContentPlanStreamState = ReturnType<typeof useContentPlanRunStream>
type VisualPlanStreamState = ReturnType<typeof useVisualPlanRunStream>

interface ProjectSnapshotInput {
  projectData: unknown
  projectCharacters: unknown[]
  projectLocations: unknown[]
  globalAssetText: string
  novelText: string
  analysisModel: string | undefined
  characterModel: string | undefined
  locationModel: string | undefined
  storyboardModel: string | undefined
  editModel: string | undefined
  videoModel: string | undefined
  audioModel: string | undefined
  videoRatio: string | undefined
  videoProfile: VideoProfile
  capabilityOverrides: CapabilitySelections
  ttsRate: string | number | undefined
  artStyle: string | undefined
  artStyleMode: string | undefined
  artStylePrompt: string | undefined
  artStyleReferenceEnabled: boolean
  customArtStyleReferenceImage: string | undefined
  customArtStyleReferenceImageUrl: string | undefined
}

interface BuildWorkspaceControllerViewModelParams {
  t: (key: string, values?: Record<string, string | number | Date>) => string
  tc: (key: string, values?: Record<string, string | number | Date>) => string
  te: (key: string, values?: Record<string, string | number | Date>) => string
  projectSnapshot: ProjectSnapshotInput
  uiState: {
    onRefresh: (options?: { mode?: 'full' | 'light' | 'assets' }) => Promise<void>
    assetsLoading: boolean
    assetsLoadingState: TaskPresentationState | null
    isSettingsModalOpen: boolean
    setIsSettingsModalOpen: (open: boolean) => void
    isWorldContextModalOpen: boolean
    setIsWorldContextModalOpen: (open: boolean) => void
    isAssetLibraryOpen: boolean
    assetLibraryFocusCharacterId: string | null
    assetLibraryFocusRequestId: number
    triggerGlobalAnalyzeOnOpen: boolean
    setTriggerGlobalAnalyzeOnOpen: (value: boolean) => void
    openAssetLibrary: (characterId?: string | null, refreshAssets?: boolean) => void
    closeAssetLibrary: () => void
    userModelsForSettings: UserModelsPayload | null
    userVideoModels: Array<{
      value: string
      label: string
      capabilities?: UserModelsPayload['video'][number]['capabilities']
      videoPricingTiers?: VideoPricingTier[]
    }>
    userModelsLoaded: boolean
  }
  stageNavState: {
    currentStage: string
    workflowItems: WorkspaceStageNavItem[]
    handleStageChange: (stage: string) => void
  }
  rebuildState: {
    showRebuildConfirm: boolean
    rebuildConfirmTitle: string
    rebuildConfirmMessage: string
    pendingActionType: 'storyToScript' | 'scriptToStoryboard' | null
    runWithRebuildConfirm: (action: 'storyToScript' | 'scriptToStoryboard', operation: () => Promise<void>) => Promise<void>
    handleCancelRebuildConfirm: () => void
    handleAcceptRebuildConfirm: () => void
  }
  executionState: {
    isSubmittingTTS: boolean
    isAssetAnalysisRunning: boolean
    isConfirmingAssets: boolean
    isTransitioning: boolean
    isStartingStoryToScript: boolean
    isStartingScriptToStoryboard: boolean
    transitionProgress: { step?: string; total?: number; current?: number }
    storyToScriptStream: StoryToScriptStreamState
    scriptToStoryboardStream: ScriptToStoryboardStreamState
    contentPlanStream: ContentPlanStreamState
    visualPlanStream: VisualPlanStreamState
    handleGenerateTTS: () => Promise<void>
    handleAnalyzeAssets: () => Promise<void>
    runStoryToScriptFlow: () => Promise<void>
    runScriptToStoryboardFlow: () => Promise<void>
    showCreatingToast: boolean
  }
  videoState: {
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
    ) => Promise<void>
    handleGenerateAllVideos: (options?: BatchVideoGenerationParams) => Promise<void>
    handleUpdateVideoPrompt: (
      storyboardId: string,
      panelIndex: number,
      value: string,
      field?: 'videoPrompt' | 'firstLastFramePrompt',
    ) => Promise<void>
    handleUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
    handleUpdateClip: (clipId: string, updates: Record<string, unknown>) => Promise<void>
  }
  stageRuntime: WorkspaceStageRuntimeValue
  actionsState: {
    handleUpdateConfig: (key: string, value: unknown) => Promise<void>
    handleUpdateEpisode: (key: string, value: unknown) => Promise<void>
  }
}

export function buildWorkspaceControllerViewModel({
  t,
  tc,
  te,
  projectSnapshot,
  uiState,
  stageNavState,
  rebuildState,
  executionState,
  videoState,
  stageRuntime,
  actionsState,
}: BuildWorkspaceControllerViewModelParams) {
  return {
    i18n: { t, tc, te },
    project: projectSnapshot,
    ui: uiState,
    stageNav: stageNavState,
    rebuild: rebuildState,
    execution: executionState,
    video: videoState,
    runtime: { stageRuntime },
    actions: actionsState,
  }
}

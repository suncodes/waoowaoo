'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/model-config-contract'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'
import type { BatchVideoGenerationParams, VideoGenerationOptions } from './components/video'
import type { VideoProfile, VideoProfilePreset, VisualQualityMode } from '@/lib/video-profile'
import type { ContentPlan } from '@/lib/content-planning'
import type { VisualPlanResult, VisualUnit } from '@/lib/visual-planning'
import type { WorkspaceArtifactCommandResult } from '@/lib/creation-workspace/commands'

export interface WorkspaceStageVideoModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

export interface WorkspaceStageRuntimeValue {
  assetsLoading: boolean
  isAssetAnalysisRunning: boolean
  isSubmittingTTS: boolean
  isTransitioning: boolean
  isConfirmingAssets: boolean
  isStartingStoryToScript: boolean
  isStartingScriptToStoryboard: boolean
  videoRatio: string | null | undefined
  videoProfile: VideoProfile
  artStyle: string | null | undefined
  artStyleReferenceEnabled: boolean
  videoModel: string | null | undefined
  capabilityOverrides: CapabilitySelections
  userVideoModels: WorkspaceStageVideoModelOption[]
  contentEditingState: {
    dirty: boolean
    saving: boolean
  }
  onContentEditingStateChange: (state: { dirty: boolean; saving: boolean }) => void
  onNovelTextChange: (value: string) => Promise<void>
  onContentPlanChange: (value: unknown) => Promise<void>
  onSaveGuidePlan: (value: ContentPlan, changedUnitIds: string[]) => Promise<WorkspaceArtifactCommandResult>
  onSaveVisualPlan: (shotPlan: VisualPlanResult['shotPlan'], visualUnits: VisualUnit[]) => Promise<WorkspaceArtifactCommandResult>
  onToggleContentLock: (unitId: string, locked: boolean) => Promise<WorkspaceArtifactCommandResult>
  onRegenerateContentUnit: (unitId: string, instruction?: string) => Promise<void>
  onAcceptContentCandidate: (unitId: string) => Promise<WorkspaceArtifactCommandResult>
  onDiscardContentCandidate: (unitId: string) => Promise<WorkspaceArtifactCommandResult>
  onRestoreContentUnit: (unitId: string) => Promise<WorkspaceArtifactCommandResult>
  onApproveStage: (stageId: 'content' | 'visual-design') => Promise<WorkspaceArtifactCommandResult>
  onApproveAssetRequirements: () => Promise<WorkspaceArtifactCommandResult>
  onMaterializeGuideStoryboard: () => Promise<WorkspaceArtifactCommandResult>
  onVideoRatioChange: (value: string) => Promise<void>
  onVideoProfileChange: (value: VideoProfilePreset) => Promise<void>
  onVisualQualityModeChange: (value: VisualQualityMode) => Promise<void>
  onArtStyleChange: (value: string) => Promise<void>
  onArtStyleReferenceEnabledChange: (value: boolean) => Promise<void>
  onRunStoryToScript: () => Promise<void>
  onRunVisualPlan: (instruction?: string, options?: { forceRegenerate?: boolean }) => Promise<void>
  onAnalyzeAssets: () => Promise<void>
  onClipUpdate: (clipId: string, data: unknown) => Promise<void>
  onOpenAssetLibrary: () => void
  onRunScriptToStoryboard: (options?: { visualApprovalConfirmed?: boolean }) => Promise<void>
  onStageChange: (stage: string) => void
  onGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    model?: string,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      flModel: string
      customPrompt?: string
    },
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
    requestOptions?: { allowSpeechPlanMissing?: boolean; allowSpeechlessVideo?: boolean },
  ) => Promise<void>
  onGenerateAllVideos: (options?: BatchVideoGenerationParams) => Promise<void>
  onUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: 'videoPrompt' | 'firstLastFramePrompt',
  ) => Promise<void>
  onUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
  onOpenAssetLibraryForCharacter: (characterId?: string | null, refreshAssets?: boolean) => void
}

const WorkspaceStageRuntimeContext = createContext<WorkspaceStageRuntimeValue | null>(null)

interface WorkspaceStageRuntimeProviderProps {
  value: WorkspaceStageRuntimeValue
  children: ReactNode
}

export function WorkspaceStageRuntimeProvider({ value, children }: WorkspaceStageRuntimeProviderProps) {
  return (
    <WorkspaceStageRuntimeContext.Provider value={value}>
      {children}
    </WorkspaceStageRuntimeContext.Provider>
  )
}

export function useWorkspaceStageRuntime() {
  const context = useContext(WorkspaceStageRuntimeContext)
  if (!context) {
    throw new Error('useWorkspaceStageRuntime must be used within WorkspaceStageRuntimeProvider')
  }
  return context
}

'use client'

import type { AppIconName } from '@/components/ui/icons'
import type { CreationStageStatus } from '@/lib/creation-workspace/stages'

export type StudioModeId =
  | 'start'
  | 'draft'
  | 'visual-kit'
  | 'board'
  | 'produce'
  | 'edit'
  | 'export'

export type StudioProductStatus =
  | 'empty'
  | 'drafting'
  | 'generating'
  | 'needs_review'
  | 'locked'
  | 'stale'
  | 'failed'

export interface StudioNavItem {
  id: StudioModeId
  route: string
  label: string
  subtitle: string
  icon: AppIconName
  status: StudioProductStatus
  disabled?: boolean
}

export interface StudioDraftSegment {
  id: string
  title: string
  text: string
  visualHints: string[]
  durationSec: number
  status: StudioProductStatus
  locked: boolean
}

export interface StudioVisualAsset {
  id: string
  name: string
  kind: 'character' | 'location' | 'prop' | 'vehicle' | 'book_cover' | 'diagram'
  importance: 'core' | 'supporting'
  description: string
  status: StudioProductStatus
  imageUrl: string | null
  sourceCount: number
}

export interface StudioShot {
  id: string
  storyboardId: string
  panelIndex: number
  number: number
  description: string
  narration: string
  durationSec: number
  characters: string[]
  location: string
  imageUrl: string | null
  videoUrl: string | null
  status: StudioProductStatus
  errorMessage: string
}

export interface StudioProductionItem {
  id: string
  shot: StudioShot
  imageStatus: StudioProductStatus
  videoStatus: StudioProductStatus
  voiceStatus: StudioProductStatus
}

export interface StudioGenerationJob {
  id: string
  label: string
  status: StudioProductStatus
  progress: number
  message: string
}

export interface StudioWorkspaceModel {
  activeMode: StudioModeId
  novelText: string
  draftTitle: string
  draftSegments: StudioDraftSegment[]
  visualAssets: StudioVisualAsset[]
  coreVisualAssets: StudioVisualAsset[]
  supportingVisualAssets: StudioVisualAsset[]
  shots: StudioShot[]
  productionItems: StudioProductionItem[]
  generationJobs: StudioGenerationJob[]
  summary: {
    totalDurationSec: number
    confirmedVisualAssets: number
    missingCoreVisualAssets: number
    completedVideos: number
    failedShots: number
  }
  workflow: {
    isBookGuide: boolean
    hasScriptOutput: boolean
    contentApproved: boolean
    assetRequirementStatus: string
    visualApproved: boolean
    hasVisualPlan: boolean
    hasStoryboard: boolean
    hasVideo: boolean
    stageStatuses: Record<string, CreationStageStatus>
  }
}

export function statusFromCreationStage(status: CreationStageStatus): StudioProductStatus {
  if (status === 'running') return 'generating'
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'locked'
  if (status === 'attention') return 'needs_review'
  if (status === 'stale') return 'stale'
  if (status === 'ready') return 'drafting'
  return 'empty'
}

export function resolveStudioMode(currentStage: string, stageView?: string | null): StudioModeId {
  if (currentStage === 'setup') return 'start'
  if (currentStage === 'content') return 'draft'
  if (currentStage === 'visual-design') return 'visual-kit'
  if (currentStage === 'storyboard-preview') return 'board'
  if (currentStage === 'production') return 'produce'
  if (currentStage === 'edit' && stageView === 'export') return 'export'
  if (currentStage === 'edit') return 'edit'
  return 'start'
}

export function statusLabel(status: StudioProductStatus) {
  if (status === 'generating') return '生成中'
  if (status === 'failed') return '失败'
  if (status === 'locked') return '已确认'
  if (status === 'needs_review') return '待确认'
  if (status === 'stale') return '需更新'
  if (status === 'drafting') return '可编辑'
  return '未开始'
}

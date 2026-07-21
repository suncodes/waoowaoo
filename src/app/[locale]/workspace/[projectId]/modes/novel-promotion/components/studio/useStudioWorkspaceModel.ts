'use client'

import { useMemo } from 'react'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import { readContentArtifactMeta, readVisualArtifactMeta } from '@/lib/creation-workspace/artifact-state'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { resolveVisualAnchorReadiness, resolveVisualAssetStatus, selectedVisualAssetImage } from '@/lib/creation-workspace/visual-readiness'
import { useAssets } from '@/lib/query/hooks'
import type { NovelPromotionPanel } from '@/types/project'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import type { WorkspaceRunStreamState } from '../workspace-run-types'
import {
  asPlanningRecord,
  readPlanningNumber,
  readPlanningRecords,
  readPlanningString,
  readPlanningStrings,
} from '../planning/planning-data'
import {
  resolveStudioMode,
  type StudioDraftSegment,
  type StudioGenerationJob,
  type StudioProductStatus,
  type StudioProductionItem,
  type StudioShot,
  type StudioVisualAsset,
  type StudioWorkspaceModel,
} from './studio-types'

interface UseStudioWorkspaceModelInput {
  currentStage: string
  stageView?: string | null
  workflowState: CreationWorkflowState
  contentPlanStream: WorkspaceRunStreamState
  storyToScriptStream: WorkspaceRunStreamState
  visualPlanStream: WorkspaceRunStreamState
  scriptToStoryboardStream: WorkspaceRunStreamState
  isAssetAnalysisRunning: boolean
}

function isRunActive(stream: WorkspaceRunStreamState) {
  return stream.isRunning || stream.isRecoveredRunning || stream.status === 'running'
}

function runStatus(stream: WorkspaceRunStreamState): StudioProductStatus {
  if (isRunActive(stream)) return 'generating'
  if (stream.status === 'failed') return 'failed'
  if (stream.status === 'completed') return 'locked'
  return 'empty'
}

function splitNames(value: string | null | undefined) {
  if (!value) return []
  const normalized = value.replace(/[，、;；|]/g, ',')
  return normalized.split(',').map((item) => item.trim()).filter(Boolean)
}

function panelStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panel.videoTaskRunning || panel.imageTaskRunning) return 'generating'
  if (panel.imageErrorMessage) return 'failed'
  if (panel.videoUrl || panel.lipSyncVideoUrl) return 'locked'
  if (panel.imageUrl) return 'needs_review'
  if (panel.description || panel.imagePrompt) return 'drafting'
  return 'empty'
}

function visualAssetStatus(status: ReturnType<typeof resolveVisualAssetStatus>): StudioProductStatus {
  if (status === 'running') return 'generating'
  if (status === 'failed') return 'failed'
  if (status === 'confirmed') return 'locked'
  if (status === 'candidate') return 'needs_review'
  return 'empty'
}

function assetDescription(asset: VisualAssetSummary) {
  if (asset.kind === 'character') return asset.introduction || asset.profileData || ''
  return asset.summary || ''
}

function fallbackVisualAsset(asset: VisualAssetSummary): StudioVisualAsset {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    importance: 'supporting',
    description: assetDescription(asset),
    status: visualAssetStatus(resolveVisualAssetStatus(asset)),
    imageUrl: selectedVisualAssetImage(asset),
    sourceCount: 0,
  }
}

function buildDraftSegments(contentPlan: unknown, contentMeta: ReturnType<typeof readContentArtifactMeta>): StudioDraftSegment[] {
  const plan = asPlanningRecord(contentPlan)
  if (!plan) return []
  const planType = readPlanningString(plan.planType)
  const records = planType === 'guide'
    ? readPlanningRecords(plan.segments)
    : readPlanningRecords(plan.beats)

  return records.map((record, index) => {
    const id = readPlanningString(record.id, `segment-${index + 1}`)
    const state = contentMeta?.units[id]
    const locked = state?.locked === true
    return {
      id,
      title: readPlanningString(record.title, `段落 ${index + 1}`),
      text: planType === 'guide'
        ? readPlanningString(record.narration)
        : readPlanningString(record.summary),
      visualHints: planType === 'guide'
        ? readPlanningStrings(record.visualHints)
        : [readPlanningString(record.purpose)].filter(Boolean),
      durationSec: readPlanningNumber(record.estimatedDurationSec),
      status: locked
        ? 'locked'
        : state?.candidate
          ? 'needs_review'
          : contentMeta?.status === 'stale'
            ? 'stale'
            : 'drafting',
      locked,
    }
  })
}

function buildShots(storyboards: ReturnType<typeof useWorkspaceEpisodeStageData>['storyboards']): StudioShot[] {
  return storyboards.flatMap((storyboard, storyboardIndex) => {
    const panels = [...(storyboard.panels || [])].sort((a, b) => a.panelIndex - b.panelIndex)
    return panels.map((panel, panelOffset) => {
      const number = panel.panelNumber || storyboardIndex * 100 + panelOffset + 1
      return {
        id: panel.id || `${storyboard.id}:${panel.panelIndex}`,
        storyboardId: storyboard.id,
        panelIndex: panel.panelIndex,
        number,
        description: panel.description || panel.imagePrompt || '',
        narration: panel.srtSegment || panel.onScreenText || '',
        durationSec: panel.duration || 0,
        characters: splitNames(panel.characters),
        location: panel.location || '',
        imageUrl: panel.imageUrl || null,
        videoUrl: panel.lipSyncVideoUrl || panel.videoUrl || null,
        status: panelStatus(panel),
        errorMessage: panel.imageErrorMessage || '',
      }
    })
  })
}

function buildJobs(streams: Array<{ id: string; label: string; stream: WorkspaceRunStreamState }>): StudioGenerationJob[] {
  return streams.flatMap(({ id, label, stream }) => {
    const status = runStatus(stream)
    if (status === 'empty' && !stream.activeMessage) return []
    return [{
      id,
      label,
      status,
      progress: Math.max(0, Math.min(100, Math.round(stream.overallProgress || (status === 'locked' ? 100 : 0)))),
      message: stream.activeMessage || stream.status || '',
      detailsId: id,
    }]
  })
}

function buildAssetAnalysisJob(
  assetRequirementStatus: CreationWorkflowState['facts']['assetRequirementStatus'],
  isRunning: boolean,
): StudioGenerationJob[] {
  if (isRunning) {
    return [{
      id: 'asset-analysis',
      label: '视觉资产提取',
      status: 'generating',
      progress: 8,
      message: '正在从已确认文稿中提取角色、场景和关键道具',
    }]
  }
  if (assetRequirementStatus === 'needs_review') {
    return [{
      id: 'asset-analysis',
      label: '视觉资产提取',
      status: 'needs_review',
      progress: 100,
      message: '提取完成，等待确认资产清单',
    }]
  }
  if (assetRequirementStatus === 'approved') {
    return [{
      id: 'asset-analysis',
      label: '视觉资产提取',
      status: 'locked',
      progress: 100,
      message: '资产清单已确认',
    }]
  }
  if (assetRequirementStatus === 'stale') {
    return [{
      id: 'asset-analysis',
      label: '视觉资产提取',
      status: 'stale',
      progress: 100,
      message: '文稿已变化，需要重新提取',
    }]
  }
  return []
}

export function useStudioWorkspaceModel({
  currentStage,
  stageView,
  workflowState,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
  isAssetAnalysisRunning,
}: UseStudioWorkspaceModelInput): StudioWorkspaceModel {
  const { projectId } = useWorkspaceProvider()
  const episodeData = useWorkspaceEpisodeStageData()
  const assetsQuery = useAssets({ scope: 'project', projectId })

  return useMemo(() => {
    const contentMeta = readContentArtifactMeta(episodeData.contentPlan)
    const visualMeta = readVisualArtifactMeta(episodeData.productionBible)
    const visualAssets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
    const readiness = resolveVisualAnchorReadiness(visualMeta?.anchors || [], visualAssets)
    const visualKitAssets = readiness.items.length > 0
      ? readiness.items.map((item): StudioVisualAsset => ({
          id: item.anchor.id,
          name: item.anchor.name,
          kind: item.anchor.semanticKind,
          importance: item.anchor.importance,
          description: item.anchor.description,
          status: visualAssetStatus(item.status),
          imageUrl: item.imageUrl,
          sourceCount: item.anchor.sourceUnitIds.length,
        }))
      : visualAssets.map(fallbackVisualAsset)
    const draftSegments = buildDraftSegments(episodeData.contentPlan, contentMeta)
    const shots = buildShots(episodeData.storyboards)
    const productionItems: StudioProductionItem[] = shots.map((shot) => ({
      id: shot.id,
      shot,
      imageStatus: shot.imageUrl ? 'locked' : shot.status === 'failed' ? 'failed' : shot.status === 'generating' ? 'generating' : 'empty',
      videoStatus: shot.videoUrl ? 'locked' : shot.status === 'generating' ? 'generating' : 'empty',
      voiceStatus: 'empty',
    }))
    const totalDurationSec = draftSegments.reduce((sum, item) => sum + item.durationSec, 0)

    return {
      activeMode: resolveStudioMode(currentStage, stageView),
      activeView: stageView,
      novelText: episodeData.novelText,
      draftTitle: readPlanningString(asPlanningRecord(episodeData.contentPlan)?.title, episodeData.episodeName || '未命名视频'),
      draftSegments,
      visualAssets: visualKitAssets,
      coreVisualAssets: visualKitAssets.filter((asset) => asset.importance === 'core'),
      supportingVisualAssets: visualKitAssets.filter((asset) => asset.importance === 'supporting'),
      shots,
      productionItems,
      generationJobs: [
        ...buildAssetAnalysisJob(workflowState.facts.assetRequirementStatus, isAssetAnalysisRunning),
        ...buildJobs([
          { id: 'content-plan', label: '文稿规划', stream: contentPlanStream },
          { id: 'story-script', label: '剧本生成', stream: storyToScriptStream },
          { id: 'visual-plan', label: '视觉方案', stream: visualPlanStream },
          { id: 'storyboard', label: '分镜生成', stream: scriptToStoryboardStream },
        ]),
      ],
      summary: {
        totalDurationSec,
        confirmedVisualAssets: visualKitAssets.filter((asset) => asset.status === 'locked').length,
        missingCoreVisualAssets: visualKitAssets.filter((asset) => asset.importance === 'core' && asset.status !== 'locked').length,
        completedVideos: shots.filter((shot) => !!shot.videoUrl).length,
        failedShots: shots.filter((shot) => shot.status === 'failed').length,
      },
      workflow: {
        isBookGuide: workflowState.facts.isBookGuide,
        hasScriptOutput: workflowState.facts.hasScriptOutput,
        contentApproved: workflowState.facts.contentDocumentApproved,
        assetRequirementStatus: workflowState.facts.assetRequirementStatus,
        visualApproved: visualMeta?.status === 'approved',
        hasVisualPlan: !!visualMeta?.plan || workflowState.stages['visual-design'].hasArtifact,
        hasStoryboard: workflowState.stages['storyboard-preview'].hasArtifact,
        hasVideo: workflowState.stages.production.hasArtifact,
        stageStatuses: Object.fromEntries(Object.entries(workflowState.stages).map(([key, value]) => [key, value.status])),
      },
    }
  }, [
    assetsQuery.data,
    contentPlanStream,
    currentStage,
    episodeData.contentPlan,
    episodeData.episodeName,
    episodeData.novelText,
    episodeData.productionBible,
    episodeData.storyboards,
    isAssetAnalysisRunning,
    scriptToStoryboardStream,
    stageView,
    storyToScriptStream,
    visualPlanStream,
    workflowState,
  ])
}

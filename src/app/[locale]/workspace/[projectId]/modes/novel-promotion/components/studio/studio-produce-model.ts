import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import type { VideoPanel } from '../video'
import { getStoryboardPanels } from '../storyboard/hooks/storyboard-state-utils'
import type { StudioProductStatus } from './studio-types'
import { resolvePanelImageWorkflowPresentation } from './studio-board-image-workflow'

export interface ProduceItem {
  id: string
  storyboard: NovelPromotionStoryboard
  panel: NovelPromotionPanel
  number: number
}

export type BatchVideoMode = 'normal' | 'firstlastframe'

export type BatchVideoSkipReason =
  | 'video_exists'
  | 'video_running'
  | 'image_missing'
  | 'quality_not_ready'
  | 'speech_lines_missing'
  | 'speech_plan_missing'
  | 'speech_not_ready'
  | 'not_linked'
  | 'last_panel'
  | 'last_image_missing'
  | 'last_quality_not_ready'

export interface BatchVideoPreflight {
  mode: BatchVideoMode
  eligibleCount: number
  skippedCount: number
  reasonCounts: Partial<Record<BatchVideoSkipReason, number>>
}

export interface PanelSpeechVideoOptions {
  hasVoiceLines?: boolean
  allowSpeechPlanMissing?: boolean
  allowSpeechlessVideo?: boolean
}

export interface BatchVideoPreflightOptions {
  hasVoiceLinesForItem?: (item: ProduceItem) => boolean
  allowSpeechPlanMissing?: boolean
  allowSpeechlessVideo?: boolean
}

function addReason(
  reasonCounts: BatchVideoPreflight['reasonCounts'],
  reason: BatchVideoSkipReason,
) {
  reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
}

export function buildBatchVideoPreflight(
  items: ProduceItem[],
  linkedPanels: ReadonlyMap<string, boolean>,
  mode: BatchVideoMode,
  options: BatchVideoPreflightOptions = {},
): BatchVideoPreflight {
  const reasonCounts: BatchVideoPreflight['reasonCounts'] = {}
  let eligibleCount = 0

  items.forEach((item, index) => {
    if (panelVideoUrl(item.panel)) {
      addReason(reasonCounts, 'video_exists')
      return
    }
    if (item.panel.videoTaskRunning) {
      addReason(reasonCounts, 'video_running')
      return
    }
    if (!item.panel.imageUrl) {
      addReason(reasonCounts, 'image_missing')
      return
    }
    if (!isPanelVisualReadyForVideo(item.panel)) {
      addReason(reasonCounts, 'quality_not_ready')
      return
    }
    const speechIssue = resolvePanelSpeechIssueForVideo(item.panel, {
      hasVoiceLines: options.hasVoiceLinesForItem?.(item),
      allowSpeechPlanMissing: options.allowSpeechPlanMissing,
      allowSpeechlessVideo: options.allowSpeechlessVideo,
    })
    if (speechIssue) {
      addReason(reasonCounts, speechIssue)
      return
    }
    if (mode === 'normal') {
      eligibleCount += 1
      return
    }

    const nextItem = items[index + 1]
    if (!nextItem) {
      addReason(reasonCounts, 'last_panel')
      return
    }
    const key = `${item.storyboard.id}-${item.panel.panelIndex}`
    if (!linkedPanels.get(key)) {
      addReason(reasonCounts, 'not_linked')
      return
    }
    if (!nextItem.panel.imageUrl) {
      addReason(reasonCounts, 'last_image_missing')
      return
    }
    if (!isPanelVisualReadyForVideo(nextItem.panel)) {
      addReason(reasonCounts, 'last_quality_not_ready')
      return
    }
    const nextSpeechIssue = resolvePanelSpeechIssueForVideo(nextItem.panel, {
      hasVoiceLines: options.hasVoiceLinesForItem?.(nextItem),
      allowSpeechPlanMissing: options.allowSpeechPlanMissing,
      allowSpeechlessVideo: options.allowSpeechlessVideo,
    })
    if (nextSpeechIssue) {
      addReason(reasonCounts, nextSpeechIssue)
      return
    }
    eligibleCount += 1
  })

  return {
    mode,
    eligibleCount,
    skippedCount: items.length - eligibleCount,
    reasonCounts,
  }
}

export function panelVideoUrl(panel: NovelPromotionPanel) {
  return panel.lipSyncVideoUrl || panel.audioMixedVideoUrl || panel.videoUrl || null
}

export function panelVideoError(panel: NovelPromotionPanel) {
  const record = panel as NovelPromotionPanel & { videoErrorMessage?: string | null; lipSyncErrorMessage?: string | null }
  return record.videoErrorMessage || record.lipSyncErrorMessage || null
}

export function panelLipSyncTaskRunning(panel: NovelPromotionPanel) {
  const record = panel as NovelPromotionPanel & { lipSyncTaskRunning?: boolean | null }
  return !!record.lipSyncTaskRunning
}

export function panelVideoModel(panel: NovelPromotionPanel) {
  const record = panel as NovelPromotionPanel & { videoModel?: string | null }
  return record.videoModel || null
}

export function hasMissingSpeechPlanForVoiceLines(panel: NovelPromotionPanel, hasVoiceLines: boolean) {
  const plan = panel.speechPlan
  return hasVoiceLines && (!plan || plan.mode === 'none')
}

export function resolvePanelSpeechIssueForVideo(
  panel: NovelPromotionPanel,
  options: PanelSpeechVideoOptions = {},
): BatchVideoSkipReason | null {
  if (options.hasVoiceLines === false && !options.allowSpeechlessVideo) {
    return 'speech_lines_missing'
  }
  const hasVoiceLines = options.hasVoiceLines === true
  if (hasMissingSpeechPlanForVoiceLines(panel, hasVoiceLines)) {
    return options.allowSpeechPlanMissing ? null : 'speech_plan_missing'
  }
  const plan = panel.speechPlan
  if (!plan || plan.mode === 'none') return null
  return plan.status === 'ready' ? null : 'speech_not_ready'
}

export function isPanelSpeechReadyForVideo(
  panel: NovelPromotionPanel,
  options: PanelSpeechVideoOptions = {},
) {
  return resolvePanelSpeechIssueForVideo(panel, options) === null
}

export function panelLinkedToNext(panel: NovelPromotionPanel) {
  const record = panel as NovelPromotionPanel & { linkedToNextPanel?: boolean | null }
  return !!record.linkedToNextPanel
}

export function isPanelVisualReadyForVideo(panel: NovelPromotionPanel) {
  return !!panel.imageUrl
    && resolvePanelImageWorkflowPresentation({
      panel,
      hasCandidates: false,
    }).status === 'locked'
}

export function resolveImageStatus(panel: NovelPromotionPanel): StudioProductStatus {
  return resolvePanelImageWorkflowPresentation({
    panel,
    hasCandidates: false,
  }).status
}

export function resolveVideoStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panel.videoTaskRunning || panelLipSyncTaskRunning(panel)) return 'generating'
  if (panelVideoError(panel)) return 'failed'
  if (panelVideoUrl(panel)) return 'locked'
  if (panel.imageUrl) return 'needs_review'
  return 'empty'
}

export function resolveVoiceStatus(panel: NovelPromotionPanel, options: PanelSpeechVideoOptions = {}): StudioProductStatus {
  if (options.hasVoiceLines === false) return 'needs_review'
  if (hasMissingSpeechPlanForVoiceLines(panel, options.hasVoiceLines === true)) return 'needs_review'
  if (panel.speechPlan?.mode === 'none') return 'empty'
  if (panel.speechPlan?.status === 'invalid') return 'failed'
  if (panel.speechPlan?.status === 'ready') return 'locked'
  if (panelLipSyncTaskRunning(panel)) return 'generating'
  if (panel.lipSyncVideoUrl) return 'locked'
  if (panel.audioMixedVideoUrl) return 'locked'
  return 'empty'
}

export function buildProduceItems(storyboards: NovelPromotionStoryboard[]): ProduceItem[] {
  return storyboards.flatMap((storyboard, storyboardIndex) => (
    getStoryboardPanels(storyboard).map((panel, panelOffset) => ({
      id: panel.id,
      storyboard,
      panel,
      number: panel.panelNumber || storyboardIndex * 100 + panelOffset + 1,
    }))
  ))
}

export function toVideoPanels(items: ProduceItem[]): VideoPanel[] {
  return items.map((item) => ({
    panelId: item.panel.id,
    storyboardId: item.storyboard.id,
    panelIndex: item.panel.panelIndex,
    targetDurationMs: item.panel.targetDurationMs || undefined,
    imageUrl: item.panel.imageUrl || undefined,
    videoUrl: item.panel.videoUrl || undefined,
    audioMixedVideoUrl: item.panel.audioMixedVideoUrl || undefined,
    videoGenerationMode: item.panel.videoGenerationMode || undefined,
    videoTaskRunning: !!item.panel.videoTaskRunning,
    videoModel: panelVideoModel(item.panel) || undefined,
    linkedToNextPanel: panelLinkedToNext(item.panel),
    firstLastFramePrompt: item.panel.firstLastFramePrompt || undefined,
    visualQualityState: item.panel.visualQualityState,
    speechPlan: item.panel.speechPlan || null,
    textPanel: {
      panel_number: item.number,
      shot_type: item.panel.shotType || '',
      camera_move: item.panel.cameraMove || undefined,
      description: item.panel.description || '',
      duration: item.panel.duration || undefined,
      video_prompt: item.panel.videoPrompt || undefined,
    },
  }))
}

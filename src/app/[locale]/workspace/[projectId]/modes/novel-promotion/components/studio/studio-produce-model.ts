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
}

function addReason(
  reasonCounts: BatchVideoPreflight['reasonCounts'],
  reason: BatchVideoSkipReason,
) {
  reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
}

function batchVideoSkipReason(
  items: ProduceItem[],
  linkedPanels: ReadonlyMap<string, boolean>,
  mode: BatchVideoMode,
  index: number,
): BatchVideoSkipReason | null {
  const item = items[index]
  if (!item) return 'last_panel'
  if (panelVideoUrl(item.panel)) return 'video_exists'
  if (item.panel.videoTaskRunning) return 'video_running'
  if (!item.panel.imageUrl) return 'image_missing'
  if (!isPanelVisualReadyForVideo(item.panel)) return 'quality_not_ready'
  if (mode === 'normal') return null

  const nextItem = items[index + 1]
  if (!nextItem) return 'last_panel'
  const key = `${item.storyboard.id}-${item.panel.panelIndex}`
  if (!linkedPanels.get(key)) return 'not_linked'
  if (!nextItem.panel.imageUrl) return 'last_image_missing'
  if (!isPanelVisualReadyForVideo(nextItem.panel)) return 'last_quality_not_ready'
  return null
}

export function listEligibleBatchVideoItems(
  items: ProduceItem[],
  linkedPanels: ReadonlyMap<string, boolean>,
  mode: BatchVideoMode,
): ProduceItem[] {
  return items.filter((_item, index) => !batchVideoSkipReason(items, linkedPanels, mode, index))
}

export function buildBatchVideoPreflight(
  items: ProduceItem[],
  linkedPanels: ReadonlyMap<string, boolean>,
  mode: BatchVideoMode,
): BatchVideoPreflight {
  const reasonCounts: BatchVideoPreflight['reasonCounts'] = {}
  let eligibleCount = 0

  items.forEach((_item, index) => {
    const reason = batchVideoSkipReason(items, linkedPanels, mode, index)
    if (reason) {
      addReason(reasonCounts, reason)
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
  if (panelLipSyncTaskRunning(panel)) return 'generating'
  if (panel.lipSyncVideoUrl) return 'locked'
  if (panel.audioMixedVideoUrl) return 'locked'
  if (options.hasVoiceLines === true) return 'locked'
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

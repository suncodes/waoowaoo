import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import { evaluateVisualReadiness } from '@/lib/visual-readiness'
import { hasUnconfirmedVisualCandidates } from '@/lib/quality-workflow'
import type { VideoPanel } from '../video'
import { getStoryboardPanels } from '../storyboard/hooks/storyboard-state-utils'
import type { StudioProductStatus } from './studio-types'

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
  return panel.lipSyncVideoUrl || panel.videoUrl || null
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
  return !hasUnconfirmedVisualCandidates(panel.candidateImages, panel.visualQualityState)
    && evaluateVisualReadiness(panel.visualQualityState).ready
}

export function resolveImageStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panel.imageTaskRunning) return 'generating'
  if (panel.imageErrorMessage) return 'failed'
  if (hasUnconfirmedVisualCandidates(panel.candidateImages, panel.visualQualityState)) return 'needs_review'
  const readiness = evaluateVisualReadiness(panel.visualQualityState)
  if (readiness.status === 'pending') return 'generating'
  if (readiness.status === 'blocked') return 'needs_review'
  if (panel.imageUrl) return 'locked'
  return 'empty'
}

export function resolveVideoStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panel.videoTaskRunning || panelLipSyncTaskRunning(panel)) return 'generating'
  if (panelVideoError(panel)) return 'failed'
  if (panelVideoUrl(panel)) return 'locked'
  if (panel.imageUrl) return 'needs_review'
  return 'empty'
}

export function resolveVoiceStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panelLipSyncTaskRunning(panel)) return 'generating'
  if (panel.lipSyncVideoUrl) return 'locked'
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
    imageUrl: item.panel.imageUrl || undefined,
    videoUrl: item.panel.videoUrl || undefined,
    videoGenerationMode: item.panel.videoGenerationMode || undefined,
    videoTaskRunning: !!item.panel.videoTaskRunning,
    videoModel: panelVideoModel(item.panel) || undefined,
    linkedToNextPanel: panelLinkedToNext(item.panel),
    firstLastFramePrompt: item.panel.firstLastFramePrompt || undefined,
    visualQualityState: item.panel.visualQualityState,
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

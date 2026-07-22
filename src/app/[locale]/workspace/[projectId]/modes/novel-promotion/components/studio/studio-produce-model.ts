import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import type { VideoPanel } from '../video'
import { getStoryboardPanels } from '../storyboard/hooks/storyboard-state-utils'
import type { StudioProductStatus } from './studio-types'

export interface ProduceItem {
  id: string
  storyboard: NovelPromotionStoryboard
  panel: NovelPromotionPanel
  number: number
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

export function resolveImageStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panel.imageTaskRunning) return 'generating'
  if (panel.imageErrorMessage) return 'failed'
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

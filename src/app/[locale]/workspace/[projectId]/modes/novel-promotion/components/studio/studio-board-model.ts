import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import { parseVisualQualityState } from '@/lib/quality-workflow'
import { evaluateVisualReadiness } from '@/lib/visual-readiness'
import type { StoryboardPanel } from '../storyboard/hooks/useStoryboardState'
import { getStoryboardPanels } from '../storyboard/hooks/storyboard-state-utils'
import type { StudioProductStatus } from './studio-types'
import { resolvePanelImageWorkflowPresentation } from './studio-board-image-workflow'

export interface BoardItem {
  storyboard: NovelPromotionStoryboard
  panel: StoryboardPanel
  panelOffset: number
  sourcePanel: NovelPromotionPanel
  globalNumber: number
}

function candidatesNeedConfirmation(sourcePanel: NovelPromotionPanel, hasCandidates: boolean): boolean {
  if (!hasCandidates) return false
  return !parseVisualQualityState(sourcePanel.visualQualityState)?.humanConfirmedAt
}

export function flattenBoardItems(
  storyboards: NovelPromotionStoryboard[],
  getTextPanels: (storyboard: NovelPromotionStoryboard) => StoryboardPanel[],
): BoardItem[] {
  return storyboards.flatMap((storyboard, storyboardIndex) => {
    const sourcePanels = getStoryboardPanels(storyboard)
    return getTextPanels(storyboard).flatMap((panel, panelOffset) => {
      const sourcePanel = sourcePanels.find((item) => item.id === panel.id)
      if (!sourcePanel) return []
      return [{
        storyboard,
        panel,
        panelOffset,
        sourcePanel,
        globalNumber: panel.panel_number || storyboardIndex * 100 + panelOffset + 1,
      }]
    })
  })
}

export function resolvePanelStatus({
  sourcePanel,
  hasCandidates,
  submitting,
  modifying,
}: {
  panel: BoardItem['panel']
  sourcePanel: NovelPromotionPanel
  hasCandidates: boolean
  submitting: boolean
  modifying: boolean
}): StudioProductStatus {
  return resolvePanelImageWorkflowPresentation({
    panel: sourcePanel,
    hasCandidates,
    isSubmitting: submitting,
    isModifying: modifying,
  }).status
}

export function isPanelReadyForProduction({
  panel,
  sourcePanel,
  hasCandidates,
  submitting,
  modifying,
}: {
  panel: BoardItem['panel']
  sourcePanel: NovelPromotionPanel
  hasCandidates: boolean
  submitting: boolean
  modifying: boolean
}): boolean {
  return !!panel.imageUrl
    && !candidatesNeedConfirmation(sourcePanel, hasCandidates)
    && !submitting
    && !modifying
    && !sourcePanel.imageTaskRunning
    && evaluateVisualReadiness(sourcePanel.visualQualityState).ready
}

export function currentImageUrl(item: BoardItem, candidates: { candidates: string[]; selectedIndex: number } | null) {
  const candidate = candidates?.candidates[candidates.selectedIndex]
  if (candidate && !candidate.startsWith('PENDING:')) return candidate
  return item.panel.imageUrl || null
}

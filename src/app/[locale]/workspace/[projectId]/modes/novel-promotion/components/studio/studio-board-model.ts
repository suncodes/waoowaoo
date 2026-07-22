import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import { evaluateVisualReadiness } from '@/lib/visual-readiness'
import type { StoryboardPanel } from '../storyboard/hooks/useStoryboardState'
import { getStoryboardPanels } from '../storyboard/hooks/storyboard-state-utils'
import type { StudioProductStatus } from './studio-types'

export interface BoardItem {
  storyboard: NovelPromotionStoryboard
  panel: StoryboardPanel
  panelOffset: number
  sourcePanel: NovelPromotionPanel
  globalNumber: number
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
}): StudioProductStatus {
  if (submitting || modifying || sourcePanel.imageTaskRunning) return 'generating'
  if (sourcePanel.imageErrorMessage) return 'failed'
  const readiness = evaluateVisualReadiness(sourcePanel.visualQualityState)
  if (readiness.status === 'pending') return 'generating'
  if (readiness.status === 'blocked') return 'needs_review'
  if (hasCandidates) return 'needs_review'
  if (panel.imageUrl) return 'locked'
  if (panel.description) return 'drafting'
  return 'empty'
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
    && !hasCandidates
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

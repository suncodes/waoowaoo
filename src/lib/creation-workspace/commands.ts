import type { ContentPlan } from '@/lib/content-planning'
import type { VisualPlanResult, VisualUnit } from '@/lib/visual-planning'
import type { CreationStageId } from './stages'
import type { WorkspaceImpactSummary } from './artifact-state'

export type WorkspaceArtifactCommand =
  | {
      type: 'save_guide_plan'
      plan: ContentPlan
      changedUnitIds: string[]
    }
  | {
      type: 'toggle_content_lock'
      unitId: string
      locked: boolean
    }
  | {
      type: 'approve_stage'
      stageId: Extract<CreationStageId, 'content' | 'visual-design'>
    }
  | {
      type: 'approve_asset_requirements'
    }
  | {
      type: 'accept_content_candidate'
      unitId: string
    }
  | {
      type: 'discard_content_candidate'
      unitId: string
    }
  | {
      type: 'restore_content_unit'
      unitId: string
    }
  | {
      type: 'materialize_guide_storyboard'
    }
  | {
      type: 'save_visual_plan'
      shotPlan: VisualPlanResult['shotPlan']
      visualUnits: VisualUnit[]
    }

export interface WorkspaceArtifactCommandResult {
  success: true
  impact?: WorkspaceImpactSummary | null
  missingCoreAssets?: string[]
  storyboardCount?: number
}

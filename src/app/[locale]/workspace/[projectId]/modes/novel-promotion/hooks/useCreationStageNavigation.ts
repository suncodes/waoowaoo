'use client'

import type { AppIconName } from '@/components/ui/icons'
import type { StageArtifactReadiness } from '@/lib/novel-promotion/stage-readiness'
import type { VideoProfile } from '@/lib/video-profile'
import {
  buildCreationWorkflowState,
  type CreationWorkflowRunState,
  type CreationWorkflowState,
} from '@/lib/creation-workspace/workflow-state'
import {
  CREATION_STAGE_REGISTRY,
  type CreationStageId,
  type CreationStageStatus,
} from '@/lib/creation-workspace/stages'

interface UseCreationStageNavigationParams {
  stageArtifacts: StageArtifactReadiness
  videoProfile: VideoProfile
  contentPlanStream: CreationWorkflowRunState
  storyToScriptStream: CreationWorkflowRunState
  visualPlanStream: CreationWorkflowRunState
  scriptToStoryboardStream: CreationWorkflowRunState
  contentPlan?: unknown
  productionBible?: unknown
  isAssetAnalysisRunning?: boolean
  workflowState?: CreationWorkflowState
  t: (key: string) => string
}

export interface CreationStageNavItem {
  id: CreationStageId
  icon: AppIconName
  label: string
  description: string
  status: CreationStageStatus
  issueCount: number
  locked?: boolean
  blockedByStageId?: CreationStageId
  blockedByLabel?: string
}

export function buildCreationStageNavigation({
  workflowState,
  t,
  ...input
}: UseCreationStageNavigationParams): CreationStageNavItem[] {
  const resolvedState = workflowState || buildCreationWorkflowState(input)
  const labels = new Map(CREATION_STAGE_REGISTRY.map((definition) => [
    definition.id,
    t(definition.labelKey),
  ]))

  return CREATION_STAGE_REGISTRY.map((definition) => {
    const stage = resolvedState.stages[definition.id]
    const blockedByStageId = stage.blockedById as CreationStageId | undefined
    return {
      id: definition.id,
      icon: definition.icon,
      label: labels.get(definition.id) || definition.id,
      description: t(definition.descriptionKey),
      status: stage.status,
      issueCount: stage.status === 'failed' || stage.status === 'attention' || stage.status === 'stale' ? 1 : 0,
      locked: stage.locked,
      ...(blockedByStageId
        ? {
            blockedByStageId,
            blockedByLabel: labels.get(blockedByStageId) || blockedByStageId,
          }
        : {}),
    }
  })
}

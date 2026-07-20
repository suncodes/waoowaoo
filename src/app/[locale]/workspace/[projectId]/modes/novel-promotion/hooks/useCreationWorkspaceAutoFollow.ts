'use client'

import { useEffect, useRef } from 'react'
import {
  CREATION_STAGE_REGISTRY,
  type CreationStageId,
} from '@/lib/creation-workspace/stages'
import type {
  CreationWorkflowActiveTarget,
  CreationWorkflowState,
} from '@/lib/creation-workspace/workflow-state'

interface CreationWorkspaceAutoFollowInput {
  currentStage: CreationStageId
  stageView?: string
  workflowState: CreationWorkflowState
}

export function resolveCreationWorkspaceAutoFollowTarget(
  workflowState: Pick<CreationWorkflowState, 'activeTarget'>,
): CreationWorkflowActiveTarget | null {
  return workflowState.activeTarget
}

function stageOrder(stageId: CreationStageId) {
  return CREATION_STAGE_REGISTRY.find((stage) => stage.id === stageId)?.order ?? 0
}

export function useCreationWorkspaceAutoFollow({
  currentStage,
  stageView,
  workflowState,
  onStageChange,
}: CreationWorkspaceAutoFollowInput & { onStageChange: (stage: string) => void }) {
  const handledTargetRef = useRef('')
  const target = resolveCreationWorkspaceAutoFollowTarget(workflowState)

  useEffect(() => {
    if (!target) {
      handledTargetRef.current = ''
      return
    }
    if (handledTargetRef.current === target.key) return

    handledTargetRef.current = target.key
    if (stageOrder(currentStage) > stageOrder(target.stageId)) return
    if (target.route === 'content-plan' && currentStage === 'content' && stageView === 'script') return
    if (currentStage === target.stageId && (!target.view || stageView === target.view)) return

    onStageChange(target.route)
  }, [currentStage, onStageChange, stageView, target])
}

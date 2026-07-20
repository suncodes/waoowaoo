'use client'

import type { CreationStageId } from '@/lib/creation-workspace/stages'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import ConfigStage from '../ConfigStage'
import StoryboardStage from '../StoryboardStage'
import ContentStage from './stages/ContentStage'
import EditStage from './stages/EditStage'
import ProductionStage from './stages/ProductionStage'
import VisualDesignStage from './stages/VisualDesignStage'

interface CreationStageContentProps {
  currentStage: CreationStageId
  stageView?: string
  workflowState: CreationWorkflowState
}

export default function CreationStageContent({
  currentStage,
  stageView,
  workflowState,
}: CreationStageContentProps) {
  return (
    <div key={`${currentStage}:${stageView || ''}`} className="animate-page-enter">
      {currentStage === 'setup' ? <ConfigStage workspaceLayout /> : null}
      {currentStage === 'content' ? <ContentStage stageView={stageView} workflowState={workflowState} /> : null}
      {currentStage === 'visual-design' ? <VisualDesignStage stageView={stageView} workflowState={workflowState} /> : null}
      {currentStage === 'storyboard-preview' ? <StoryboardStage workspaceLayout workflowState={workflowState} /> : null}
      {currentStage === 'production' ? <ProductionStage stageView={stageView} /> : null}
      {currentStage === 'edit' ? <EditStage /> : null}
    </div>
  )
}

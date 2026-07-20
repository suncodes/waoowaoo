'use client'

import type { CreationStageId } from '@/lib/creation-workspace/stages'
import ConfigStage from '../ConfigStage'
import StoryboardStage from '../StoryboardStage'
import ContentStage from './stages/ContentStage'
import EditStage from './stages/EditStage'
import ProductionStage from './stages/ProductionStage'
import VisualDesignStage from './stages/VisualDesignStage'

interface CreationStageContentProps {
  currentStage: CreationStageId
  stageView?: string
}

export default function CreationStageContent({
  currentStage,
  stageView,
}: CreationStageContentProps) {
  return (
    <div key={`${currentStage}:${stageView || ''}`} className="animate-page-enter">
      {currentStage === 'setup' ? <ConfigStage workspaceLayout /> : null}
      {currentStage === 'content' ? <ContentStage stageView={stageView} /> : null}
      {currentStage === 'visual-design' ? <VisualDesignStage stageView={stageView} /> : null}
      {currentStage === 'storyboard-preview' ? <StoryboardStage /> : null}
      {currentStage === 'production' ? <ProductionStage stageView={stageView} /> : null}
      {currentStage === 'edit' ? <EditStage /> : null}
    </div>
  )
}

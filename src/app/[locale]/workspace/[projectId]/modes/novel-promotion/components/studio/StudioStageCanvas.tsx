'use client'

import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import StudioBoardCanvas from './StudioBoardCanvas'
import StudioDraftCanvas from './StudioDraftCanvas'
import StudioEditCanvas from './StudioEditCanvas'
import StudioExportCanvas from './StudioExportCanvas'
import StudioProduceCanvas from './StudioProduceCanvas'
import StudioStartCanvas from './StudioStartCanvas'
import StudioVisualKitCanvas from './StudioVisualKitCanvas'
import { type StudioWorkspaceModel } from './studio-types'

interface StudioStageCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
  workflowState: CreationWorkflowState
}

export default function StudioStageCanvas({ model, onNavigate, workflowState }: StudioStageCanvasProps) {
  if (model.activeMode === 'start') return <StudioStartCanvas model={model} />
  if (model.activeMode === 'draft') return <StudioDraftCanvas model={model} onNavigate={onNavigate} />
  if (model.activeMode === 'visual-kit') return <StudioVisualKitCanvas model={model} />
  if (model.activeMode === 'board') return <StudioBoardCanvas model={model} onNavigate={onNavigate} workflowState={workflowState} />
  if (model.activeMode === 'produce') return <StudioProduceCanvas model={model} onNavigate={onNavigate} />
  if (model.activeMode === 'edit') return <StudioEditCanvas model={model} onNavigate={onNavigate} />
  return <StudioExportCanvas model={model} />
}

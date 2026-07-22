'use client'

import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { StudioButton, StudioEmptyState } from './StudioPrimitives'
import type { StudioWorkspaceModel } from './studio-types'

export default function StudioBoardEmpty({ model }: { model: StudioWorkspaceModel }) {
  const runtime = useWorkspaceStageRuntime()
  return (
    <StudioEmptyState
      icon="image"
      title="分镜还没有生成"
      description="视觉库确认后再生成分镜，保证核心角色和场景在镜头间保持一致。"
      action={<StudioButton icon="sparkles" loading={runtime.isTransitioning} onClick={() => { void runtime.onRunScriptToStoryboard() }} disabled={!model.workflow.visualApproved}>生成分镜</StudioButton>}
    />
  )
}


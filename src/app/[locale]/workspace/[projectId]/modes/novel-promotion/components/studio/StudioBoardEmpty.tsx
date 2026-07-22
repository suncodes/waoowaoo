'use client'

import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { StudioButton, StudioEmptyState } from './StudioPrimitives'
import type { StudioWorkspaceModel } from './studio-types'

export default function StudioBoardEmpty({ model }: { model: StudioWorkspaceModel }) {
  const runtime = useWorkspaceStageRuntime()
  const generating = model.workflow.storyboardGenerating
    || runtime.isConfirmingAssets
    || runtime.isStartingScriptToStoryboard
  return (
    <StudioEmptyState
      icon="image"
      title={generating ? '镜头规划正在生成' : '镜头规划还没有生成'}
      description={generating
        ? '任务会在后台持续执行，切换页面不会中断。完成后将自动显示镜头规划。'
        : '确认视觉资产后生成镜头规划，再逐镜头生成和确认分镜图片。'}
      action={(
        <StudioButton
          icon="sparkles"
          loading={generating}
          onClick={() => { void runtime.onRunScriptToStoryboard() }}
          disabled={!model.workflow.visualApproved || generating}
        >
          {generating ? '镜头规划生成中' : '生成镜头规划'}
        </StudioButton>
      )}
    />
  )
}

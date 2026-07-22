'use client'

import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { StudioButton, StudioEmptyState } from './StudioPrimitives'

export default function StudioBoardEmpty() {
  const runtime = useWorkspaceStageRuntime()
  const generating = runtime.isTransitioning
  return (
    <StudioEmptyState
      icon="image"
      title={generating ? '镜头规划初稿正在生成' : '还没有镜头规划初稿'}
      description={generating
        ? '任务会在后台持续执行，切换页面不会中断。完成后可以查看、编辑或让 AI 重写。'
        : '先生成可编辑的镜头规划初稿，确认规划后再生成正式分镜和图片。'}
      action={(
        <StudioButton
          icon="sparkles"
          loading={generating}
          onClick={() => { void runtime.onRunVisualPlan() }}
          disabled={generating}
        >
          {generating ? '生成中' : '生成镜头规划初稿'}
        </StudioButton>
      )}
    />
  )
}

'use client'

import { useState } from 'react'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import ContentScriptEditor from '../workspace-v2/artifacts/ContentScriptEditor'
import GuideNarrationEditor from '../workspace-v2/artifacts/GuideNarrationEditor'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioProcessSteps,
  StudioSectionHeader,
  StudioStageHeader,
} from './StudioPrimitives'
import type { StudioProductStatus, StudioWorkspaceModel } from './studio-types'

interface StudioDraftCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

export default function StudioDraftCanvas({ model, onNavigate }: StudioDraftCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const [pending, setPending] = useState(false)
  const isBookGuide = model.workflow.isBookGuide
  const draftName = isBookGuide ? '导读稿' : '剧本'
  const editableReady = isBookGuide || model.workflow.hasScriptOutput
  const confirmationStatus: StudioProductStatus = model.workflow.contentApproved ? 'locked' : 'needs_review'
  const processSteps = [
    {
      label: `${draftName}编辑`,
      helper: editableReady ? '支持人工编辑和 AI 重写' : `等待生成可编辑${draftName}`,
      status: editableReady ? 'drafting' as const : 'empty' as const,
    },
    {
      label: `${draftName}确认`,
      helper: model.workflow.contentApproved ? '已锁定正式成稿' : '待人工确认',
      status: confirmationStatus,
    },
  ]

  const confirmDraft = async () => {
    if (!editableReady) {
      await runtime.onRunStoryToScript()
      return
    }
    setPending(true)
    try {
      if (!model.workflow.contentApproved) {
        await runtime.onApproveStage('content')
      }
      if (model.workflow.assetRequirementStatus !== 'approved') {
        await runtime.onAnalyzeAssets()
      }
      onNavigate('assets')
    } finally {
      setPending(false)
    }
  }

  if (model.draftSegments.length === 0) {
    return (
      <StudioEmptyState
        icon="fileText"
        title={`还没有可制作的${draftName}`}
        description="先在内容策划中生成并确认内容方案，再进入正式成稿制作。"
        action={<StudioButton onClick={() => onNavigate('config')}>返回内容策划</StudioButton>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="成稿制作"
          title={isBookGuide ? '导读稿制作' : '剧本制作'}
          description={`把内容方案制作成可以直接拆解镜头的正式${draftName}，完成编辑和人工确认后再进入视觉资产。`}
          actions={(
            <StudioButton
              icon="clipboardCheck"
              loading={pending || runtime.isAssetAnalysisRunning}
              onClick={() => { void confirmDraft() }}
              disabled={runtime.contentEditingState.dirty || runtime.contentEditingState.saving}
            >
              {model.workflow.contentApproved ? `进入视觉资产` : `确认${draftName}并进入视觉资产`}
            </StudioButton>
          )}
        />
        <div className="border-t border-white/10 px-6 py-4">
          <StudioProcessSteps steps={processSteps} />
        </div>
      </StudioPanel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <StudioPanel padding="none" className="min-w-0 overflow-hidden">
          <div className="border-b border-white/10 px-5 py-4">
            <StudioSectionHeader
              title={`${draftName}编辑台`}
              description={editableReady
                ? `逐段编辑${draftName}、执行 AI 重写，并处理候选版本。`
                : `先把内容方案生成可编辑${draftName}。`}
            />
          </div>
          <div className="p-4 text-stone-100">
            {editableReady ? (
              isBookGuide ? <GuideNarrationEditor /> : <ContentScriptEditor />
            ) : (
              <StudioEmptyState
                icon="edit"
                title={`内容方案尚未转换为${draftName}`}
                description={`生成后可逐段编辑、AI 重写和处理候选${draftName}。`}
                action={<StudioButton icon="sparkles" onClick={() => { void runtime.onRunStoryToScript() }}>生成可编辑{draftName}</StudioButton>}
              />
            )}
          </div>
        </StudioPanel>

        <aside className="space-y-4">
          <StudioPanel>
            <StudioSectionHeader title={`${draftName}概览`} description="只展示正式成稿阶段的质量与确认状态。" />
            <div className="mt-4 grid gap-3">
              <StudioMetric label="内容段落" value={model.draftSegments.length} />
              <StudioMetric label="预计时长" value={model.summary.totalDurationSec ? `${model.summary.totalDurationSec} 秒` : '-'} />
              <StudioMetric label={`${draftName}状态`} value={model.workflow.contentApproved ? '已确认' : '可编辑'} />
            </div>
          </StudioPanel>

          <StudioPanel>
            <StudioSectionHeader title="确认后的处理" description="系统会从正式成稿提取角色、场景和道具需求。" />
            <div className="mt-4 space-y-2 text-sm leading-6 text-stone-400">
              <p>确认前请处理未保存修改和 AI 候选版本。</p>
              <p>{runtime.contentEditingState.dirty ? '还有未保存内容，暂时不能确认。' : `${draftName}已具备确认条件。`}</p>
            </div>
          </StudioPanel>
        </aside>
      </div>
    </div>
  )
}

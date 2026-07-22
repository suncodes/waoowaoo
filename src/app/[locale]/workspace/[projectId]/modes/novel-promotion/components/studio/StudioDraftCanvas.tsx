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
import { statusLabel, type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioDraftCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

function PlanPreview({
  model,
  editableReady,
  onGenerateScript,
  onOpenScript,
}: {
  model: StudioWorkspaceModel
  editableReady: boolean
  onGenerateScript: () => void
  onOpenScript: () => void
}) {
  return (
    <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-[#10110f]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-stone-50">内容方案已生成</h2>
          <p className="mt-1 text-sm text-stone-500">下一步生成可编辑剧本，之后可以逐段编辑、AI 重写、接受或丢弃候选。</p>
        </div>
        <StudioButton icon={editableReady ? 'edit' : 'sparkles'} onClick={editableReady ? onOpenScript : onGenerateScript}>
          {editableReady ? '进入剧本编辑' : '生成可编辑剧本'}
        </StudioButton>
      </div>
      {model.draftSegments.map((segment, index) => (
        <article key={segment.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[48px_minmax(0,1fr)_120px]">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/[0.06] text-sm font-semibold text-stone-200">{index + 1}</div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-50">{segment.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-300">{segment.text}</p>
            {segment.visualHints.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {segment.visualHints.map((hint) => (
                  <span key={hint} className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-stone-400">{hint}</span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="text-right text-xs text-stone-500">{segment.durationSec || '-'} 秒</div>
        </article>
      ))}
    </div>
  )
}

export default function StudioDraftCanvas({ model, onNavigate }: StudioDraftCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const [pending, setPending] = useState(false)
  const editableReady = model.workflow.isBookGuide || model.workflow.hasScriptOutput
  const contentView = model.activeView === 'plan' ? 'plan' : 'script'
  const visualStatus: StudioProductStatus = model.workflow.assetRequirementStatus === 'approved'
    ? 'locked'
    : model.workflow.assetRequirementStatus === 'needs_review'
      ? 'needs_review'
      : 'empty'
  const processSteps: Array<{ label: string; helper: string; status: StudioProductStatus }> = [
    {
      label: '内容方案',
      helper: `${model.draftSegments.length} 段`,
      status: model.draftSegments.length > 0 ? 'locked' : 'empty',
    },
    {
      label: '剧本编辑',
      helper: editableReady ? '支持编辑和 AI 重写' : '等待生成可编辑稿',
      status: editableReady ? 'drafting' : 'empty',
    },
    {
      label: '文稿确认',
      helper: model.workflow.contentApproved ? '已锁定口径' : '待人工确认',
      status: model.workflow.contentApproved ? 'locked' : 'needs_review',
    },
    {
      label: '视觉提取',
      helper: statusLabel(visualStatus),
      status: visualStatus,
    },
  ]

  const confirmDraft = async () => {
    if (model.draftSegments.length === 0) {
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
        title="还没有视频文稿"
        description="先从项目简报生成文稿初稿，或补充原始材料后重新生成。"
        action={<StudioButton onClick={() => onNavigate('config')}>返回项目简报</StudioButton>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="文稿"
          title={model.draftTitle}
          description="把内容节奏、叙述口径和镜头意图先稳定下来，再进入角色与场景资产设计。"
          actions={(
            <StudioButton
              icon="clipboardCheck"
              loading={pending || runtime.isAssetAnalysisRunning}
              onClick={() => { void confirmDraft() }}
              disabled={runtime.contentEditingState.dirty || runtime.contentEditingState.saving}
            >
              确认文稿并提取视觉资产
            </StudioButton>
          )}
        />

        <div className="border-b border-white/10 px-6 py-4">
          <StudioProcessSteps steps={processSteps} />
        </div>
        <div className="flex items-center gap-1 border-b border-white/10 px-6 py-3">
          <button
            type="button"
            onClick={() => onNavigate('content-plan')}
            className={`h-9 rounded-md px-3 text-sm font-semibold transition-colors ${contentView === 'plan' ? 'bg-[#f3e9cf] text-[#161512]' : 'text-stone-400 hover:bg-white/[0.05] hover:text-stone-100'}`}
          >
            内容方案
          </button>
          <button
            type="button"
            onClick={() => onNavigate('script')}
            className={`h-9 rounded-md px-3 text-sm font-semibold transition-colors ${contentView === 'script' ? 'bg-[#f3e9cf] text-[#161512]' : 'text-stone-400 hover:bg-white/[0.05] hover:text-stone-100'}`}
          >
            剧本编辑
          </button>
        </div>
      </StudioPanel>

      {contentView === 'plan' ? (
        <StudioPanel padding="none" className="overflow-hidden">
          <div className="border-b border-white/10 px-5 py-4">
            <StudioSectionHeader
              title={model.workflow.isBookGuide ? '导读内容方案' : '剧情内容方案'}
              description="这里展示 AI 生成的内容结构、段落目的、视觉提示和预计时长。确认结构后再进入逐段编辑。"
            />
          </div>
          <div className="p-4">
            <PlanPreview
              model={model}
              editableReady={editableReady}
              onOpenScript={() => onNavigate('script')}
              onGenerateScript={() => { void runtime.onRunStoryToScript() }}
            />
          </div>
        </StudioPanel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <StudioPanel padding="none" className="min-w-0 overflow-hidden">
          <div className="border-b border-white/10 px-5 py-4">
            <StudioSectionHeader
              title="文稿编辑台"
              description={editableReady ? '在文稿编辑台完成逐段编辑、AI 重写、候选接受或丢弃。' : '先把内容方案转为可编辑剧本，再进入逐段打磨。'}
            />
          </div>
          <div className="p-4 text-stone-100">
            {editableReady ? (
              model.workflow.isBookGuide ? <GuideNarrationEditor /> : <ContentScriptEditor />
            ) : (
              <PlanPreview
                model={model}
                editableReady={false}
                onOpenScript={() => onNavigate('script')}
                onGenerateScript={() => { void runtime.onRunStoryToScript() }}
              />
            )}
          </div>
        </StudioPanel>

        <aside className="space-y-4">
          <StudioPanel>
            <StudioSectionHeader title="文稿概览" description="用于进入视觉资产前的质量检查。" />
            <div className="mt-4 grid gap-3">
              <StudioMetric label="段落" value={model.draftSegments.length} />
              <StudioMetric label="预计时长" value={model.summary.totalDurationSec ? `${model.summary.totalDurationSec} 秒` : '-'} />
              <StudioMetric label="文稿状态" value={model.workflow.contentApproved ? '已确认' : '可编辑'} />
              <StudioMetric label="视觉提取" value={statusLabel(visualStatus)} />
            </div>
          </StudioPanel>

          <StudioPanel>
            <StudioSectionHeader title="进入视觉库前" description="确认后系统会从文稿提取角色、场景、道具等一致性资产。" />
            <div className="mt-4 space-y-2 text-sm leading-6 text-stone-400">
              <p>当前编辑器保留 AI 重写、人工编辑和候选稿处理能力。</p>
              <p>{runtime.contentEditingState.dirty ? '还有未保存内容，保存后才能确认。' : '文稿内容已可进入确认流程。'}</p>
            </div>
          </StudioPanel>
        </aside>
        </div>
      )}
    </div>
  )
}

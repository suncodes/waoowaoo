'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import ContentScriptEditor from '../workspace-v2/artifacts/ContentScriptEditor'
import GuideNarrationEditor from '../workspace-v2/artifacts/GuideNarrationEditor'
import { statusLabel, type StudioWorkspaceModel } from './studio-types'

interface StudioDraftCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variant === 'primary'
        ? 'bg-[#f3e9cf] text-[#161512] hover:bg-[#fff5d9]'
        : 'border border-white/12 bg-white/[0.04] text-stone-100 hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  )
}

function PlanPreview({ model, onGenerateScript }: { model: StudioWorkspaceModel; onGenerateScript: () => void }) {
  return (
    <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-[#10110f]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-stone-50">内容方案已生成</h2>
          <p className="mt-1 text-sm text-stone-500">下一步生成可编辑剧本，之后可以逐段编辑、AI 重写、接受或丢弃候选。</p>
        </div>
        <Button onClick={onGenerateScript}>
          <AppIcon name="sparkles" className="h-4 w-4" />
          生成可编辑剧本
        </Button>
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
      <div className="flex min-h-[440px] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#151613] px-6 py-12 text-center">
        <AppIcon name="fileText" className="h-8 w-8 text-[#e8d18a]" />
        <h2 className="mt-4 text-lg font-semibold text-stone-50">还没有视频文稿</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">先从 Start 生成文稿初稿，或补充原始材料后重新生成。</p>
        <div className="mt-5">
          <Button onClick={() => onNavigate('config')}>返回 Start</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#151613]">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Draft</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-50">{model.draftTitle}</h1>
          <p className="mt-2 text-sm text-stone-400">文稿是视频入口。这里保留编辑、AI 重写、锁定、恢复、候选接受/丢弃。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onNavigate('content-plan')}>查看方案</Button>
          <Button onClick={() => { void confirmDraft() }} disabled={pending || runtime.isAssetAnalysisRunning || runtime.contentEditingState.dirty || runtime.contentEditingState.saving}>
            <AppIcon name={pending || runtime.isAssetAnalysisRunning ? 'loader' : 'clipboardCheck'} className={`h-4 w-4 ${pending || runtime.isAssetAnalysisRunning ? 'animate-spin' : ''}`} />
            确认文稿并提取视觉资产
          </Button>
        </div>
      </header>

      <div className="grid gap-4 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
        <Metric label="段落" value={model.draftSegments.length} />
        <Metric label="预计时长" value={model.summary.totalDurationSec ? `${model.summary.totalDurationSec} 秒` : '-'} />
        <Metric label="文稿状态" value={model.workflow.contentApproved ? '已确认' : '可编辑'} />
        <Metric label="视觉提取" value={statusLabel(model.workflow.assetRequirementStatus === 'approved' ? 'locked' : model.workflow.assetRequirementStatus === 'needs_review' ? 'needs_review' : 'empty')} />
      </div>

      <div className="studio-draft-editor p-4 text-[var(--glass-text-primary)]">
        {editableReady ? (
          model.workflow.isBookGuide ? <GuideNarrationEditor /> : <ContentScriptEditor />
        ) : (
          <PlanPreview model={model} onGenerateScript={() => { void runtime.onRunStoryToScript() }} />
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-stone-100">{value}</div>
    </div>
  )
}

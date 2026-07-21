'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { VIDEO_PROFILE_PRESET } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import StudioBoardCanvas from './StudioBoardCanvas'
import StudioDraftCanvas from './StudioDraftCanvas'
import StudioExportCanvas from './StudioExportCanvas'
import StudioProduceCanvas from './StudioProduceCanvas'
import StudioVisualKitCanvas from './StudioVisualKitCanvas'
import { type StudioWorkspaceModel } from './studio-types'

interface StudioStageCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
  workflowState: CreationWorkflowState
}

function StudioButton({
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

function EmptyCanvas({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[440px] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#151613] px-6 py-12 text-center">
      <AppIcon name="sparkles" className="h-8 w-8 text-[#e8d18a]" />
      <h2 className="mt-4 text-lg font-semibold text-stone-50">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function StartCanvas({ model }: { model: StudioWorkspaceModel }) {
  const runtime = useWorkspaceStageRuntime()
  const [text, setText] = useState(model.novelText)
  const [saving, setSaving] = useState(false)

  useEffect(() => setText(model.novelText), [model.novelText])

  const saveText = async () => {
    if (text === model.novelText) return
    setSaving(true)
    try {
      await runtime.onNovelTextChange(text)
    } finally {
      setSaving(false)
    }
  }

  const start = async () => {
    await saveText()
    await runtime.onRunStoryToScript()
  }

  return (
    <div className="grid min-h-[620px] grid-rows-[auto_1fr_auto] rounded-lg border border-white/10 bg-[#151613]">
      <header className="border-b border-white/10 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Start</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-50">创建一条可发布视频</h1>
        <p className="mt-2 text-sm leading-6 text-stone-400">粘贴故事、书稿、产品资料或链接，先生成视频方案和文稿初稿。</p>
      </header>
      <div className="grid min-h-0 gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => { void saveText() }}
          placeholder="输入原文、梗概或资料。"
          className="min-h-[420px] resize-none rounded-md border border-white/10 bg-[#0f100e] p-5 text-base leading-7 text-stone-100 outline-none transition-colors placeholder:text-stone-600 focus:border-[#e8d18a]"
        />
        <aside className="space-y-4">
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-stone-100">输出规格</div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-stone-500">画幅</dt><dd className="text-stone-200">{runtime.videoRatio || '默认'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-stone-500">类型</dt><dd className="text-stone-200">{runtime.videoProfile.preset === VIDEO_PROFILE_PRESET.BOOK_GUIDE ? '书籍导读' : 'AI 漫剧'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-stone-500">风格</dt><dd className="text-stone-200">{runtime.artStyle || '默认'}</dd></div>
            </dl>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-stone-400">
            第一版只要求足够启动，模型、并发、质量阈值继续放在设置里。
          </div>
        </aside>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
        <span className="text-xs text-stone-500">{saving ? '正在保存输入...' : `${text.trim().length} 字`}</span>
        <StudioButton onClick={() => { void start() }} disabled={!text.trim() || runtime.isTransitioning}>
          <AppIcon name={runtime.isTransitioning ? 'loader' : 'sparkles'} className={`h-4 w-4 ${runtime.isTransitioning ? 'animate-spin' : ''}`} />
          生成第一版视频方案
        </StudioButton>
      </footer>
    </div>
  )
}

function EditCanvas({
  model,
  onNavigate,
}: {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}) {
  const firstVideo = model.shots.find((shot) => shot.videoUrl)
  return (
    <div className="grid min-h-[620px] grid-rows-[1fr_auto] rounded-lg border border-white/10 bg-[#151613]">
      <div className="grid min-h-0 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-h-[420px] items-center justify-center rounded-md bg-black">
          {firstVideo?.videoUrl ? (
            <video src={firstVideo.videoUrl} controls className="h-full max-h-[560px] w-full object-contain" />
          ) : (
            <EmptyCanvas title="还没有可预览视频" description="完成至少一个镜头视频后，成片预览会出现在这里。" action={<StudioButton onClick={() => onNavigate('videos')}>进入 Produce</StudioButton>} />
          )}
        </div>
        <aside className="rounded-md border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-semibold text-stone-50">成片检查</h2>
          <ul className="mt-4 space-y-3 text-sm text-stone-400">
            <li>镜头视频：{model.summary.completedVideos}/{model.shots.length}</li>
            <li>失败镜头：{model.summary.failedShots}</li>
            <li>预计时长：{model.summary.totalDurationSec || '-'} 秒</li>
          </ul>
        </aside>
      </div>
      <div className="border-t border-white/10 px-5 py-4">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {model.shots.map((shot) => <div key={shot.id} className={`h-12 min-w-24 rounded border px-2 py-1 text-xs ${shot.videoUrl ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-white/10 bg-white/[0.04] text-stone-500'}`}>Shot {shot.number}</div>)}
        </div>
      </div>
    </div>
  )
}

export default function StudioStageCanvas({ model, onNavigate, workflowState }: StudioStageCanvasProps) {
  if (model.activeMode === 'start') return <StartCanvas model={model} />
  if (model.activeMode === 'draft') return <StudioDraftCanvas model={model} onNavigate={onNavigate} />
  if (model.activeMode === 'visual-kit') return <StudioVisualKitCanvas model={model} />
  if (model.activeMode === 'board') return <StudioBoardCanvas model={model} onNavigate={onNavigate} workflowState={workflowState} />
  if (model.activeMode === 'produce') return <StudioProduceCanvas model={model} onNavigate={onNavigate} />
  if (model.activeMode === 'edit') return <EditCanvas model={model} onNavigate={onNavigate} />
  return <StudioExportCanvas model={model} />
}

'use client'

import { useEffect, useState } from 'react'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { VIDEO_PROFILE_PRESET } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import StudioBoardCanvas from './StudioBoardCanvas'
import StudioDraftCanvas from './StudioDraftCanvas'
import StudioExportCanvas from './StudioExportCanvas'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioProcessSteps,
  StudioSectionHeader,
  StudioStageHeader,
} from './StudioPrimitives'
import StudioProduceCanvas from './StudioProduceCanvas'
import StudioVisualKitCanvas from './StudioVisualKitCanvas'
import { type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioStageCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
  workflowState: CreationWorkflowState
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

  const textLength = text.trim().length
  const hasUnsavedInput = text !== model.novelText
  const processSteps: Array<{ label: string; helper: string; status: StudioProductStatus }> = [
    {
      label: '简报输入',
      helper: hasUnsavedInput ? '有未保存修改' : textLength > 0 ? `${textLength} 字` : '等待输入',
      status: textLength === 0 ? 'empty' : hasUnsavedInput ? 'drafting' : 'locked',
    },
    {
      label: '文稿初稿',
      helper: model.draftSegments.length > 0 ? `${model.draftSegments.length} 段` : '生成后进入编辑',
      status: runtime.isTransitioning ? 'generating' : model.draftSegments.length > 0 ? 'locked' : 'empty',
    },
    {
      label: '视觉资产',
      helper: model.workflow.hasVisualPlan ? `缺失核心 ${model.summary.missingCoreVisualAssets}` : '从文稿提取',
      status: model.workflow.visualApproved ? 'locked' : model.workflow.hasVisualPlan ? 'needs_review' : 'empty',
    },
    {
      label: '镜头生产',
      helper: model.shots.length > 0 ? `${model.shots.length} 个镜头` : '分镜确认后开始',
      status: model.workflow.hasVideo ? 'locked' : model.shots.length > 0 ? 'drafting' : 'empty',
    },
  ]
  const specRows = [
    { label: '画幅', value: runtime.videoRatio || '默认' },
    { label: '类型', value: runtime.videoProfile.preset === VIDEO_PROFILE_PRESET.BOOK_GUIDE ? '书籍导读' : 'AI 漫剧' },
    { label: '风格', value: runtime.artStyle || '默认' },
  ]

  return (
    <div className="space-y-4">
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="项目简报"
          title="制作输入台"
          description="把原始材料、视频规格和生成入口放在同一屏，后续文稿、视觉资产和分镜都从此处承接。"
          actions={(
            <StudioButton icon="sparkles" loading={runtime.isTransitioning || saving} onClick={() => { void start() }} disabled={!text.trim()}>
              生成文稿初稿
            </StudioButton>
          )}
        />
        <div className="border-b border-white/10 px-6 py-4">
          <StudioProcessSteps steps={processSteps} />
        </div>
      </StudioPanel>

      <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <StudioPanel padding="none" className="grid min-h-[560px] grid-rows-[auto_1fr_auto]">
          <div className="border-b border-white/10 px-5 py-4">
            <StudioSectionHeader
              title="原始材料"
              description="支持完整原文、剧情梗概或制作资料。离开输入框时会自动保存。"
              actions={(
                <StudioButton size="sm" variant="secondary" icon="check" loading={saving} onClick={() => { void saveText() }} disabled={!hasUnsavedInput}>
                  保存输入
                </StudioButton>
              )}
            />
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => { void saveText() }}
            placeholder="输入原文、梗概或资料。"
            className="min-h-0 resize-none bg-[#0f100e] p-5 text-base leading-7 text-stone-100 outline-none placeholder:text-stone-600"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
            <span className="text-xs text-stone-500">{saving ? '正在保存输入...' : `${textLength} 字`}</span>
            <span className="text-xs text-stone-500">{hasUnsavedInput ? '修改后会先保存再生成' : '输入已同步'}</span>
          </div>
        </StudioPanel>

        <aside className="space-y-4">
          <StudioPanel>
            <StudioSectionHeader title="制作规格" description="用于约束文稿结构、镜头画幅和后续视频生成。" />
            <dl className="mt-4 space-y-3 text-sm">
              {specRows.map((row) => (
                <div key={row.label} className="flex justify-between gap-3">
                  <dt className="text-stone-500">{row.label}</dt>
                  <dd className="min-w-0 truncate text-right text-stone-200">{row.value}</dd>
                </div>
              ))}
            </dl>
          </StudioPanel>

          <StudioPanel>
            <StudioSectionHeader title="生成范围" description="第一步只生成文稿初稿，不直接跳过资产和分镜确认。" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StudioMetric label="文稿段落" value={model.draftSegments.length || '-'} />
              <StudioMetric label="镜头数量" value={model.shots.length || '-'} />
              <StudioMetric label="核心资产缺口" value={model.summary.missingCoreVisualAssets} />
              <StudioMetric label="完成视频" value={model.summary.completedVideos} />
            </div>
          </StudioPanel>
        </aside>
      </div>
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
            <StudioEmptyState
              icon="film"
              title="还没有可预览视频"
              description="完成至少一个镜头视频后，成片预览会显示在主画面。"
              action={<StudioButton onClick={() => onNavigate('videos')}>进入生产台</StudioButton>}
            />
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
          {model.shots.map((shot) => <div key={shot.id} className={`h-12 min-w-24 rounded border px-2 py-1 text-xs ${shot.videoUrl ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-white/10 bg-white/[0.04] text-stone-500'}`}>镜头 {shot.number}</div>)}
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

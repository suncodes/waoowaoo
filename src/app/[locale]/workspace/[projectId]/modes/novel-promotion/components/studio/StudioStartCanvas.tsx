'use client'

import { useEffect, useState } from 'react'
import { VIDEO_PROFILE_PRESET } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import {
  StudioButton,
  StudioMetric,
  StudioPanel,
  StudioProcessSteps,
  StudioSectionHeader,
  StudioStageHeader,
} from './StudioPrimitives'
import { type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioStartCanvasProps {
  model: StudioWorkspaceModel
}

export default function StudioStartCanvas({ model }: StudioStartCanvasProps) {
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

'use client'

import {
  StudioButton,
  StudioPanel,
  StudioSectionHeader,
} from './StudioPrimitives'
import type { StudioWorkspaceModel } from './studio-types'

interface StudioPlanPreviewProps {
  model: StudioWorkspaceModel
  editableReady: boolean
  onGenerateDraft: () => void
  onOpenDraft: () => void
}

export default function StudioPlanPreview({
  model,
  editableReady,
  onGenerateDraft,
  onOpenDraft,
}: StudioPlanPreviewProps) {
  const draftName = model.workflow.isBookGuide ? '导读稿' : '剧本'

  return (
    <StudioPanel padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <StudioSectionHeader
          title={model.workflow.isBookGuide ? '导读方案' : '剧情方案'}
          description="检查内容结构、段落目标、叙事顺序和预计时长，确认后进入正式成稿制作。"
        />
        <StudioButton
          icon={editableReady ? 'arrowRight' : 'sparkles'}
          onClick={editableReady ? onOpenDraft : onGenerateDraft}
        >
          {editableReady ? `确认方案并进入${draftName}制作` : `生成可编辑${draftName}`}
        </StudioButton>
      </div>
      <div className="divide-y divide-white/10">
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
    </StudioPanel>
  )
}

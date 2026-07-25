'use client'

import VoiceStageRoute from '../VoiceStageRoute'
import { StudioButton, StudioStageHeader, StudioStatusBadge } from './StudioPrimitives'
import type { StudioWorkspaceModel } from './studio-types'

interface StudioNarrationCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

export default function StudioNarrationCanvas({ model, onNavigate }: StudioNarrationCanvasProps) {
  const allAudioReady = model.summary.voiceLines > 0
    && model.summary.voiceAudioLines >= model.summary.voiceLines

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151613]">
        <StudioStageHeader
          eyebrow="旁白配音"
          title="音色与台词"
          description="分镜规划确认后，分析旁白和角色台词，设置音色并生成正式配音。"
          actions={(
            <div className="flex flex-wrap gap-2">
              <StudioStatusBadge
                status={allAudioReady ? 'locked' : model.summary.voiceLines > 0 ? 'needs_review' : 'drafting'}
                label={allAudioReady ? '音频已生成' : model.summary.voiceLines > 0 ? '待生成音频' : '待分析台词'}
              />
              <StudioButton variant="secondary" icon="image" onClick={() => onNavigate('storyboard')}>
                返回分镜制作
              </StudioButton>
              <StudioButton variant="secondary" icon="video" onClick={() => onNavigate('videos')}>
                进入视频制作
              </StudioButton>
            </div>
          )}
        />

        <div className="grid gap-3 border-b border-white/10 px-6 py-4 sm:grid-cols-3">
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="text-xs text-stone-500">台词</div>
            <div className="mt-1 text-sm font-semibold text-stone-100">{model.summary.voiceLines}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="text-xs text-stone-500">已生成音频</div>
            <div className="mt-1 text-sm font-semibold text-stone-100">{model.summary.voiceAudioLines}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="text-xs text-stone-500">后续步骤</div>
            <div className="mt-1 truncate text-sm font-semibold text-stone-100">确认配音后进入视频制作</div>
          </div>
        </div>

        <div className="p-4">
          <VoiceStageRoute embedded />
        </div>
      </section>
    </div>
  )
}

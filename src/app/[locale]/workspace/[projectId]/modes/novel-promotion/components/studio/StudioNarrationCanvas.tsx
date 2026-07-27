'use client'

import VoiceStageRoute from '../VoiceStageRoute'
import { StudioButton, StudioStageHeader, StudioStatusBadge } from './StudioPrimitives'
import type { StudioWorkspaceModel } from './studio-types'

interface StudioNarrationCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

export default function StudioNarrationCanvas({ model, onNavigate }: StudioNarrationCanvasProps) {
  const speechReady = model.summary.voiceLines > 0 && model.summary.speechPlanInvalid === 0

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151613]">
        <StudioStageHeader
          eyebrow="台词与声音"
          title="台词计划与音色"
          description="分镜规划确认后，分析旁白和角色台词，绑定镜头并设置音色；视频生成会在支持的模型中使用原生音频。"
          actions={(
            <div className="flex flex-wrap gap-2">
              <StudioStatusBadge
                status={speechReady ? 'locked' : model.summary.voiceLines > 0 ? 'needs_review' : 'drafting'}
                label={speechReady ? '台词计划就绪' : model.summary.voiceLines > 0 ? '待处理音色' : '待分析台词'}
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
            <div className="text-xs text-stone-500">有台词镜头</div>
            <div className="mt-1 text-sm font-semibold text-stone-100">{model.summary.speechPlanWithSpeech}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="text-xs text-stone-500">异常计划</div>
            <div className="mt-1 truncate text-sm font-semibold text-stone-100">{model.summary.speechPlanInvalid}</div>
          </div>
        </div>

        <div className="p-4">
          <VoiceStageRoute embedded nativeAudioMode />
        </div>
      </section>
    </div>
  )
}

'use client'

import VoiceStageRoute from '../VoiceStageRoute'
import { useStoryboardAutoFix, useStoryboardReadiness } from '@/lib/query/hooks/useStoryboardReadiness'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { StudioButton, StudioStageHeader, StudioStatusBadge } from './StudioPrimitives'
import type { StudioWorkspaceModel } from './studio-types'

interface StudioNarrationCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

export default function StudioNarrationCanvas({ model, onNavigate }: StudioNarrationCanvasProps) {
  const { projectId, episodeId } = useWorkspaceProvider()
  const readinessQuery = useStoryboardReadiness(projectId, episodeId || null, model.workflow.hasStoryboard)
  const autoFixMutation = useStoryboardAutoFix(projectId, episodeId || null)
  const speechReady = model.summary.voiceLines > 0
    && model.summary.speechPlanTotal > 0
    && model.summary.speechPlanInvalid === 0
    && model.summary.speechPlanWarnings === 0
  const speechBlocking = model.summary.voiceLines > 0
    && (model.summary.speechPlanTotal === 0 || model.summary.speechPlanInvalid > 0)
  const readiness = readinessQuery.data
  const needsSpeechFix = speechBlocking || model.summary.speechPlanWarnings > 0
  const nextFixAction = readiness?.status === 'fix_pending_confirm' ? 'apply' : 'prepare'

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
                label={speechReady
                  ? '台词计划就绪'
                  : speechBlocking
                    ? '计划异常待处理'
                    : model.summary.voiceLines > 0
                      ? '有节奏警告'
                      : '待分析台词'}
              />
              <StudioButton variant="secondary" icon="clapperboard" onClick={() => onNavigate('storyboard-script')}>
                返回分镜文稿
              </StudioButton>
              {needsSpeechFix ? (
                <StudioButton
                  variant="secondary"
                  icon="sparkles"
                  loading={autoFixMutation.isPending}
                  onClick={() => { autoFixMutation.mutate(nextFixAction) }}
                >
                  {nextFixAction === 'apply' ? '应用口播版' : '生成口播版'}
                </StudioButton>
              ) : null}
              <StudioButton variant="secondary" icon="image" onClick={() => onNavigate('storyboard-images')} disabled={speechBlocking}>
                进入分镜图片
              </StudioButton>
            </div>
          )}
        />

        <div className="grid gap-3 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
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
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="text-xs text-stone-500">节奏警告</div>
            <div className="mt-1 truncate text-sm font-semibold text-stone-100">{model.summary.speechPlanWarnings}</div>
          </div>
        </div>

        <div className="p-4">
          {needsSpeechFix ? (
            <div className="mb-4 rounded-md border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-sm leading-6 text-amber-100">
              {readiness?.status === 'fix_pending_confirm'
                ? `AI 口播修复方案已生成，包含 ${readiness.fixPlan?.actions.length || 0} 个动作。`
                : '检测到台词节奏或计划问题，可先生成镜头口播版。'}
              {autoFixMutation.error instanceof Error ? (
                <div className="mt-2 text-xs text-rose-100">{autoFixMutation.error.message}</div>
              ) : null}
            </div>
          ) : null}
          <VoiceStageRoute embedded nativeAudioMode />
        </div>
      </section>
    </div>
  )
}

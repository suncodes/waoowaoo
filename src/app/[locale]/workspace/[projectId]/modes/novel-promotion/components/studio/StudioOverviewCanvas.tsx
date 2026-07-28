'use client'

import {
  StudioButton,
  StudioMetric,
  StudioPanel,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
} from './StudioPrimitives'
import { statusLabel, type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioOverviewCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

function nextRoute(model: StudioWorkspaceModel) {
  if (!model.novelText.trim() || model.draftSegments.length === 0) return 'config'
  if (!model.workflow.contentApproved) return 'script'
  if (!model.workflow.visualApproved || model.summary.missingCoreVisualAssets > 0) return 'assets'
  if (!model.workflow.hasStoryboard) return 'storyboard-script'
  if (model.summary.voiceLines === 0 || (model.summary.voiceLines > 0 && model.summary.speechPlanTotal === 0)) return 'voice'
  if (model.shots.some((shot) => !shot.imageUrl || shot.status !== 'locked')) return 'storyboard-images'
  if (!model.workflow.hasVideo) return 'videos'
  return 'editor'
}

function nextLabel(model: StudioWorkspaceModel) {
  if (!model.novelText.trim() || model.draftSegments.length === 0) return '继续内容策划'
  if (!model.workflow.contentApproved) return model.workflow.isBookGuide ? '继续导读稿制作' : '继续剧本制作'
  if (!model.workflow.visualApproved || model.summary.missingCoreVisualAssets > 0) return '继续视觉资产'
  if (!model.workflow.hasStoryboard) return '继续分镜文稿'
  if (model.summary.voiceLines === 0 || (model.summary.voiceLines > 0 && model.summary.speechPlanTotal === 0)) return '继续台词与声音'
  if (model.shots.some((shot) => !shot.imageUrl || shot.status !== 'locked')) return '继续分镜图片'
  if (!model.workflow.hasVideo) return '继续视频制作'
  return '进入成片检查'
}

function stageStatus(model: StudioWorkspaceModel, stage: string): StudioProductStatus {
  const status = model.workflow.stageStatuses[stage]
  if (status === 'running') return 'generating'
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'locked'
  if (status === 'attention') return 'needs_review'
  if (status === 'stale') return 'stale'
  if (status === 'ready') return 'drafting'
  return 'empty'
}

export default function StudioOverviewCanvas({ model, onNavigate }: StudioOverviewCanvasProps) {
  const activeJobs = model.generationJobs.filter((job) => job.status === 'generating' || job.status === 'failed')
  const narrationStatus: StudioProductStatus = model.summary.voiceLines > 0
    && model.summary.speechPlanTotal > 0
    ? 'locked'
    : model.workflow.hasStoryboard
      ? model.summary.voiceLines > 0 ? 'needs_review' : 'drafting'
      : 'empty'
  const storyboardImageStatus: StudioProductStatus = model.shots.length > 0
    && model.shots.every((shot) => shot.imageUrl && shot.status === 'locked')
    ? 'locked'
    : model.workflow.hasStoryboard
      ? model.shots.some((shot) => shot.status === 'failed')
        ? 'failed'
        : model.shots.some((shot) => shot.status === 'generating')
          ? 'generating'
          : 'drafting'
      : 'empty'
  const stages = [
    { label: '内容策划', status: model.draftSegments.length > 0 ? 'locked' as const : model.novelText.trim() ? 'drafting' as const : 'empty' as const, route: 'config' },
    { label: '成稿制作', status: stageStatus(model, 'content'), route: 'script' },
    { label: '视觉资产', status: stageStatus(model, 'visual-design'), route: 'assets' },
    { label: '分镜文稿', status: model.workflow.storyboardGenerating ? 'generating' as const : stageStatus(model, 'storyboard-preview'), route: 'storyboard-script' },
    { label: '台词与声音', status: narrationStatus, route: 'voice' },
    { label: '分镜图片', status: storyboardImageStatus, route: 'storyboard-images' },
    { label: '视频制作', status: stageStatus(model, 'production'), route: 'videos' },
  ]

  return (
    <div className="space-y-4">
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="项目概览"
          title={model.draftTitle}
          description="集中查看当前制作阶段、完成度、阻塞项和后台任务。这里不承载内容输入或生成操作。"
          actions={<StudioButton icon="arrowRight" onClick={() => onNavigate(nextRoute(model))}>{nextLabel(model)}</StudioButton>}
        />
        <div className="grid gap-4 border-t border-white/10 px-6 py-4 sm:grid-cols-2 xl:grid-cols-5">
          <StudioMetric label="内容段落" value={model.draftSegments.length} />
          <StudioMetric label="视觉资产" value={`${model.summary.confirmedVisualAssets}/${model.visualAssets.length}`} />
          <StudioMetric label="分镜镜头" value={model.shots.length} />
          <StudioMetric label="完成视频" value={`${model.summary.completedVideos}/${model.shots.length}`} />
          <StudioMetric label="失败镜头" value={model.summary.failedShots} />
        </div>
      </StudioPanel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <StudioPanel>
          <StudioSectionHeader title="制作流程" description="按业务顺序显示各阶段状态，点击可直接进入对应工作区。" />
          <div className="mt-4 divide-y divide-white/10 rounded-lg border border-white/10">
            {stages.map((stage, index) => (
              <button
                key={stage.label}
                type="button"
                onClick={() => onNavigate(stage.route)}
                className="grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04]"
              >
                <span className="text-xs font-semibold text-stone-600">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-sm font-semibold text-stone-100">{stage.label}</span>
                <StudioStatusBadge status={stage.status} />
              </button>
            ))}
          </div>
        </StudioPanel>

        <StudioPanel>
          <StudioSectionHeader title="任务与阻塞" description="只显示需要关注的运行中或失败任务。" />
          <div className="mt-4 space-y-2">
            {activeJobs.length > 0 ? activeJobs.map((job) => (
              <div key={job.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-stone-100">{job.label}</span>
                  <StudioStatusBadge status={job.status} />
                </div>
                <p className="mt-2 text-xs leading-5 text-stone-500">{job.message || statusLabel(job.status)}</p>
              </div>
            )) : (
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-stone-500">当前没有运行中或失败任务。</div>
            )}
          </div>
        </StudioPanel>
      </div>
    </div>
  )
}

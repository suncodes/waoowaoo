'use client'

import { useEffect, useMemo, useState } from 'react'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioProcessSteps,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
  studioStatusDotClass,
} from './StudioPrimitives'
import { type StudioProductStatus, type StudioShot, type StudioWorkspaceModel } from './studio-types'

interface StudioEditCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

function formatDuration(seconds: number) {
  if (!seconds) return '-'
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  if (minutes === 0) return `${remain} 秒`
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

function shotReviewStatus(shot: StudioShot): StudioProductStatus {
  if (shot.errorMessage) return 'failed'
  if (shot.videoUrl) return 'locked'
  if (shot.imageUrl) return 'needs_review'
  return shot.status
}

function ReviewCheckRow({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status: StudioProductStatus
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-stone-200">{label}</div>
        <div className="mt-1 truncate text-xs text-stone-500">{value}</div>
      </div>
      <StudioStatusBadge status={status} />
    </div>
  )
}

function ReviewTimeline({
  shots,
  selectedId,
  onSelect,
}: {
  shots: StudioShot[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {shots.map((shot) => {
        const selected = shot.id === selectedId
        const status = shotReviewStatus(shot)
        return (
          <button
            key={shot.id}
            type="button"
            onClick={() => onSelect(shot.id)}
            className={`min-w-[132px] rounded-md border px-3 py-2 text-left transition-colors ${selected
              ? 'border-[#e8d18a]/70 bg-[#1b1a14]'
              : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-stone-100">第 {shot.number} 镜</span>
              <span className={`h-2 w-2 rounded-full ${studioStatusDotClass(status)}`} />
            </div>
            <p className="mt-1 truncate text-xs text-stone-500">{shot.videoUrl ? '视频已完成' : shot.imageUrl ? '待生成视频' : '缺少画面'}</p>
          </button>
        )
      })}
    </div>
  )
}

export default function StudioEditCanvas({ model, onNavigate }: StudioEditCanvasProps) {
  const initialShot = useMemo(
    () => model.shots.find((shot) => shot.videoUrl) || model.shots[0] || null,
    [model.shots],
  )
  const [selectedId, setSelectedId] = useState(initialShot?.id || '')
  const selectedShot = model.shots.find((shot) => shot.id === selectedId) || initialShot
  const completedVideos = model.summary.completedVideos
  const totalShots = model.shots.length
  const allVideosReady = totalShots > 0 && completedVideos === totalShots
  const reviewReady = allVideosReady && model.summary.failedShots === 0
  const processSteps: Array<{ label: string; helper: string; status: StudioProductStatus }> = [
    {
      label: '视频素材',
      helper: `${completedVideos}/${totalShots}`,
      status: completedVideos > 0 ? 'locked' : 'empty',
    },
    {
      label: '异常检查',
      helper: model.summary.failedShots > 0 ? `${model.summary.failedShots} 个失败镜头` : '未发现失败镜头',
      status: model.summary.failedShots > 0 ? 'failed' : completedVideos > 0 ? 'locked' : 'empty',
    },
    {
      label: '成片预览',
      helper: selectedShot?.videoUrl ? `第 ${selectedShot.number} 镜` : '等待视频',
      status: selectedShot?.videoUrl ? 'locked' : 'empty',
    },
    {
      label: '交付准备',
      helper: reviewReady ? '可进入交付' : '仍需补齐',
      status: reviewReady ? 'locked' : 'needs_review',
    },
  ]

  useEffect(() => {
    if (initialShot && initialShot.id !== selectedId && !model.shots.some((shot) => shot.id === selectedId)) {
      setSelectedId(initialShot.id)
    }
  }, [initialShot, model.shots, selectedId])

  if (totalShots === 0) {
    return (
      <StudioEmptyState
        icon="film"
        title="还没有可检查的镜头"
        description="先完成分镜和视频生产，再进入成片检查。"
        action={<StudioButton onClick={() => onNavigate('storyboard')}>返回分镜板</StudioButton>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="成片检查"
          title="成片检查台"
          description="按镜头核对视频完成度、失败项和预览结果，确认后进入交付导出。"
          actions={(
            <>
              <StudioButton variant="secondary" onClick={() => onNavigate('videos')}>返回生产台</StudioButton>
              <StudioButton icon="download" onClick={() => onNavigate('export')} disabled={completedVideos === 0}>
                进入交付
              </StudioButton>
            </>
          )}
        />
        <div className="border-b border-white/10 px-6 py-4">
          <StudioProcessSteps steps={processSteps} />
        </div>
      </StudioPanel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <StudioPanel padding="none" className="overflow-hidden">
          <div className="border-b border-white/10 px-5 py-4">
            <StudioSectionHeader
              title="镜头预览"
              description={selectedShot ? `当前检查第 ${selectedShot.number} 镜。` : '选择一个镜头开始检查。'}
            />
          </div>
          <div className="flex min-h-[460px] items-center justify-center bg-black">
            {selectedShot?.videoUrl ? (
              <video src={selectedShot.videoUrl} controls className="h-full max-h-[620px] w-full object-contain" />
            ) : selectedShot?.imageUrl ? (
              <MediaImageWithLoading
                src={selectedShot.imageUrl}
                alt={`第 ${selectedShot.number} 镜`}
                containerClassName="h-full min-h-[460px] w-full"
                className="h-full w-full object-contain"
                sizes="900px"
              />
            ) : (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <AppIcon name="film" className="h-8 w-8 text-stone-600" />
                <h2 className="mt-4 text-base font-semibold text-stone-50">当前镜头没有可预览素材</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-stone-400">返回生产台补齐镜头图片或视频后再检查。</p>
              </div>
            )}
          </div>
          <div className="border-t border-white/10 px-5 py-4">
            <ReviewTimeline shots={model.shots} selectedId={selectedShot?.id || ''} onSelect={setSelectedId} />
          </div>
        </StudioPanel>

        <aside className="space-y-4">
          <StudioPanel>
            <StudioSectionHeader title="检查概览" description="用于判断是否可以进入交付导出。" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StudioMetric label="镜头" value={totalShots} />
              <StudioMetric label="视频完成" value={`${completedVideos}/${totalShots}`} />
              <StudioMetric label="失败镜头" value={model.summary.failedShots} />
              <StudioMetric label="预计时长" value={formatDuration(model.summary.totalDurationSec)} />
            </div>
          </StudioPanel>

          <StudioPanel>
            <StudioSectionHeader title="当前镜头" description="检查画面、视频和旁白信息是否完整。" />
            {selectedShot ? (
              <div className="mt-4 space-y-2">
                <ReviewCheckRow label="视频文件" value={selectedShot.videoUrl ? '已生成' : '未生成'} status={selectedShot.videoUrl ? 'locked' : 'empty'} />
                <ReviewCheckRow label="画面素材" value={selectedShot.imageUrl ? '已生成' : '未生成'} status={selectedShot.imageUrl ? 'locked' : 'empty'} />
                <ReviewCheckRow label="异常状态" value={selectedShot.errorMessage || '无异常'} status={selectedShot.errorMessage ? 'failed' : 'locked'} />
                <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs font-semibold text-stone-500">镜头描述</div>
                  <p className="mt-2 line-clamp-6 text-sm leading-6 text-stone-300">{selectedShot.description || '暂无描述'}</p>
                </div>
              </div>
            ) : null}
          </StudioPanel>
        </aside>
      </div>
    </div>
  )
}

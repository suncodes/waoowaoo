'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function SequentialVideoPlayer({
  shots,
  selectedId,
  autoAdvance,
  onSelect,
}: {
  shots: StudioShot[]
  selectedId: string
  autoAdvance: boolean
  onSelect: (id: string) => void
}) {
  const playableShots = useMemo(() => shots.filter((shot) => !!shot.videoUrl), [shots])
  const initialIndex = Math.max(0, playableShots.findIndex((shot) => shot.id === selectedId))
  const videoRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null])
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0)
  const [slotIndexes, setSlotIndexes] = useState<[number | null, number | null]>([
    initialIndex,
    initialIndex + 1 < playableShots.length ? initialIndex + 1 : null,
  ])
  const [slotReady, setSlotReady] = useState<[boolean, boolean]>([false, false])
  const [pending, setPending] = useState<{ slot: 0 | 1; index: number; play: boolean } | null>(null)
  const [buffering, setBuffering] = useState(false)

  const setReady = useCallback((slot: 0 | 1, ready: boolean) => {
    setSlotReady((previous) => {
      if (previous[slot] === ready) return previous
      const next: [boolean, boolean] = [...previous]
      next[slot] = ready
      return next
    })
  }, [])

  const transitionTo = useCallback((slot: 0 | 1, index: number, shouldPlay: boolean) => {
    const previousSlot = activeSlot
    videoRefs.current[previousSlot]?.pause()
    const target = videoRefs.current[slot]
    if (target) target.currentTime = 0
    setActiveSlot(slot)
    setCurrentIndex(index)
    setPending(null)
    setBuffering(false)
    setReady(slot, true)
    setReady(previousSlot, false)
    setSlotIndexes((previous) => {
      const next: [number | null, number | null] = [...previous]
      next[slot] = index
      next[previousSlot] = index + 1 < playableShots.length ? index + 1 : null
      return next
    })
    const shot = playableShots[index]
    if (shot) onSelect(shot.id)
    if (shouldPlay) {
      window.requestAnimationFrame(() => {
        void videoRefs.current[slot]?.play().catch(() => undefined)
      })
    }
  }, [activeSlot, onSelect, playableShots, setReady])

  const requestTransition = useCallback((targetIndex: number, shouldPlay: boolean) => {
    if (!playableShots[targetIndex] || targetIndex === currentIndex) return
    const existingSlot = slotIndexes.findIndex((index) => index === targetIndex)
    if (existingSlot >= 0) {
      const slot = existingSlot as 0 | 1
      const element = videoRefs.current[slot]
      if (slotReady[slot] || (element?.readyState ?? 0) >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        transitionTo(slot, targetIndex, shouldPlay)
        return
      }
    }
    const preloadSlot: 0 | 1 = activeSlot === 0 ? 1 : 0
    setPending({ slot: preloadSlot, index: targetIndex, play: shouldPlay })
    setBuffering(true)
    setReady(preloadSlot, false)
    setSlotIndexes((previous) => {
      const next: [number | null, number | null] = [...previous]
      next[preloadSlot] = targetIndex
      return next
    })
  }, [activeSlot, currentIndex, playableShots, setReady, slotIndexes, slotReady, transitionTo])

  useEffect(() => {
    if (playableShots.length === 0) return
    const targetIndex = playableShots.findIndex((shot) => shot.id === selectedId)
    if (targetIndex < 0 || targetIndex === currentIndex) return
    const currentVideo = videoRefs.current[activeSlot]
    requestTransition(targetIndex, !!currentVideo && !currentVideo.paused)
  }, [activeSlot, currentIndex, playableShots, requestTransition, selectedId])

  useEffect(() => {
    if (currentIndex < playableShots.length) return
    const nextIndex = Math.max(0, playableShots.length - 1)
    setCurrentIndex(nextIndex)
    setActiveSlot(0)
    setSlotIndexes([nextIndex, nextIndex + 1 < playableShots.length ? nextIndex + 1 : null])
  }, [currentIndex, playableShots.length])

  if (playableShots.length === 0) return null

  return (
    <div className="relative h-full min-h-[460px] w-full bg-black">
      {[0, 1].map((rawSlot) => {
        const slot = rawSlot as 0 | 1
        const index = slotIndexes[slot]
        const shot = index === null ? null : playableShots[index]
        return (
          <video
            key={slot}
            ref={(element) => { videoRefs.current[slot] = element }}
            src={shot?.videoUrl || undefined}
            controls={slot === activeSlot}
            preload="auto"
            onCanPlay={() => {
              setReady(slot, true)
              if (pending?.slot === slot && pending.index === index) transitionTo(slot, pending.index, pending.play)
            }}
            onWaiting={() => { if (slot === activeSlot) setBuffering(true) }}
            onPlaying={() => { if (slot === activeSlot) setBuffering(false) }}
            onEnded={() => {
              if (slot !== activeSlot || index !== currentIndex || !autoAdvance) return
              if (currentIndex < playableShots.length - 1) requestTransition(currentIndex + 1, true)
            }}
            className={`absolute inset-0 h-full max-h-[620px] w-full object-contain transition-opacity duration-150 ${slot === activeSlot ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'}`}
          />
        )
      })}
      {buffering ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/45 text-sm font-semibold text-cyan-100">
          <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />正在预加载下一镜头
        </div>
      ) : null}
    </div>
  )
}

export default function StudioEditCanvas({ model, onNavigate }: StudioEditCanvasProps) {
  const initialShot = useMemo(
    () => model.shots.find((shot) => shot.videoUrl) || model.shots[0] || null,
    [model.shots],
  )
  const [selectedId, setSelectedId] = useState(initialShot?.id || '')
  const [autoAdvance, setAutoAdvance] = useState(true)
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
        action={<StudioButton onClick={() => onNavigate('storyboard')}>返回分镜制作</StudioButton>}
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
              description={selectedShot ? `当前检查第 ${selectedShot.number} 镜；视频结束后${autoAdvance ? '自动播放下一镜头' : '停留在当前镜头'}。` : '选择一个镜头开始检查。'}
              actions={(
                <StudioButton size="sm" variant="secondary" icon={autoAdvance ? 'pause' : 'play'} onClick={() => setAutoAdvance((value) => !value)}>
                  顺序播放 {autoAdvance ? '已开启' : '已关闭'}
                </StudioButton>
              )}
            />
          </div>
          <div className="flex min-h-[460px] items-center justify-center bg-black">
            {selectedShot?.videoUrl ? (
              <SequentialVideoPlayer
                shots={model.shots}
                selectedId={selectedShot.id}
                autoAdvance={autoAdvance}
                onSelect={setSelectedId}
              />
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

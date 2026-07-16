'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { MergedVideoItem } from './useVideoMergeActions'

type PlaybackSlot = 0 | 1
type SlotIndexes = [number | null, number | null]
type SlotReadyState = [boolean, boolean]

interface PendingTransition {
  slot: PlaybackSlot
  index: number
}

interface MergedVideoPlaylistModalProps {
  open: boolean
  loading: boolean
  error: string | null
  projectName: string
  videos: MergedVideoItem[]
  videoRatio?: string
  onClose: () => void
}

function toCssAspectRatio(value?: string): string {
  const match = value?.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/)
  if (!match || Number(match[2]) <= 0) return '16 / 9'
  return `${match[1]} / ${match[2]}`
}

function getSafeFileName(value: string): string {
  return value.trim().slice(0, 80).replace(/[\\/:*?"<>|]/g, '_') || 'videos'
}

export default function MergedVideoPlaylistModal({
  open,
  loading,
  error,
  projectName,
  videos,
  videoRatio,
  onClose,
}: MergedVideoPlaylistModalProps) {
  const t = useTranslations('video')
  const videoRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [activeSlot, setActiveSlot] = useState<PlaybackSlot>(0)
  const [slotIndexes, setSlotIndexes] = useState<SlotIndexes>([0, null])
  const [slotReady, setSlotReady] = useState<SlotReadyState>([false, false])
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null)
  const [isBuffering, setIsBuffering] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)

  const currentVideo = useMemo(
    () => videos[currentIndex] || null,
    [currentIndex, videos],
  )
  const playbackAspectRatio = useMemo(() => toCssAspectRatio(videoRatio), [videoRatio])

  useEffect(() => {
    if (!open) {
      setCurrentIndex(0)
      setActiveSlot(0)
      setSlotIndexes([0, null])
      setSlotReady([false, false])
      setPendingTransition(null)
      setIsBuffering(false)
      setIsPlaying(true)
      return
    }

    setCurrentIndex(0)
    setActiveSlot(0)
    setSlotIndexes([0, videos.length > 1 ? 1 : null])
    setSlotReady([false, false])
    setPendingTransition(null)
    setIsBuffering(false)
    setIsPlaying(videos.length > 0)
  }, [open, videos])

  useEffect(() => {
    slotIndexes.forEach((index, slot) => {
      const videoElement = videoRefs.current[slot as PlaybackSlot]
      if (!videoElement) return

      if (index === null || !videos[index]) {
        videoElement.pause()
        videoElement.removeAttribute('src')
        videoElement.load()
        return
      }

      const source = videos[index].videoUrl
      if (videoElement.getAttribute('src') !== source) {
        videoElement.setAttribute('src', source)
        videoElement.load()
      }
    })
  }, [slotIndexes, videos])

  const playSlot = useCallback(async (slot: PlaybackSlot): Promise<boolean> => {
    const videoElement = videoRefs.current[slot]
    if (!videoElement) return false

    try {
      await videoElement.play()
      return true
    } catch (playError) {
      if ((playError as { name?: string }).name !== 'AbortError') {
        setIsPlaying(false)
      }
      return false
    }
  }, [])

  useEffect(() => {
    if (!open || loading || !currentVideo || !isPlaying || isBuffering) return

    const frame = window.requestAnimationFrame(async () => {
      const videoElement = videoRefs.current[activeSlot]
      if (!videoElement || slotIndexes[activeSlot] !== currentIndex) return
      if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
      await playSlot(activeSlot)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSlot, currentIndex, currentVideo, isBuffering, isPlaying, loading, open, playSlot, slotIndexes, slotReady])

  const setSlotReadyState = useCallback((slot: PlaybackSlot, ready: boolean) => {
    setSlotReady((previous) => {
      if (previous[slot] === ready) return previous
      const next: SlotReadyState = [...previous]
      next[slot] = ready
      return next
    })
  }, [])

  const isSlotReady = useCallback((slot: PlaybackSlot): boolean => {
    const videoElement = videoRefs.current[slot]
    return slotReady[slot] || (videoElement?.readyState ?? 0) >= HTMLMediaElement.HAVE_FUTURE_DATA
  }, [slotReady])

  const transitionTo = useCallback((targetSlot: PlaybackSlot, targetIndex: number) => {
    const previousSlot = activeSlot
    if (targetSlot === previousSlot && targetIndex === currentIndex) {
      setIsBuffering(false)
      setIsPlaying(true)
      void playSlot(targetSlot)
      return
    }

    videoRefs.current[previousSlot]?.pause()
    const targetVideo = videoRefs.current[targetSlot]
    if (targetVideo) targetVideo.currentTime = 0

    setActiveSlot(targetSlot)
    setCurrentIndex(targetIndex)
    setPendingTransition(null)
    setIsBuffering(false)
    setIsPlaying(true)
    setSlotReadyState(targetSlot, true)
    setSlotReadyState(previousSlot, false)
    setSlotIndexes((previous) => {
      const next: SlotIndexes = [...previous]
      next[targetSlot] = targetIndex
      next[previousSlot] = targetIndex + 1 < videos.length ? targetIndex + 1 : null
      return next
    })
  }, [activeSlot, currentIndex, playSlot, setSlotReadyState, videos.length])

  const findSlotForIndex = useCallback((index: number): PlaybackSlot | null => {
    const slot = slotIndexes.findIndex((slotIndex) => slotIndex === index)
    return slot === -1 ? null : slot as PlaybackSlot
  }, [slotIndexes])

  const requestTransition = useCallback((targetIndex: number) => {
    if (!videos[targetIndex]) return

    if (targetIndex === currentIndex) {
      setIsBuffering(false)
      setIsPlaying(true)
      void playSlot(activeSlot)
      return
    }

    const existingSlot = findSlotForIndex(targetIndex)
    if (existingSlot !== null && existingSlot !== activeSlot && isSlotReady(existingSlot)) {
      transitionTo(existingSlot, targetIndex)
      return
    }

    const preloadSlot: PlaybackSlot = activeSlot === 0 ? 1 : 0
    setPendingTransition({ slot: preloadSlot, index: targetIndex })
    setIsBuffering(true)
    setIsPlaying(true)
    videoRefs.current[activeSlot]?.pause()
    setSlotReadyState(preloadSlot, false)

    if (existingSlot !== preloadSlot || slotIndexes[preloadSlot] !== targetIndex) {
      setSlotIndexes((previous) => {
        const next: SlotIndexes = [...previous]
        next[preloadSlot] = targetIndex
        return next
      })
    } else if (videoRefs.current[preloadSlot]?.error) {
      videoRefs.current[preloadSlot]?.load()
    }
  }, [activeSlot, currentIndex, findSlotForIndex, isSlotReady, playSlot, setSlotReadyState, slotIndexes, transitionTo, videos])

  const handleCanPlay = useCallback((slot: PlaybackSlot) => {
    setSlotReadyState(slot, true)
    if (pendingTransition?.slot !== slot) return
    if (slotIndexes[slot] !== pendingTransition.index) return
    transitionTo(slot, pendingTransition.index)
  }, [pendingTransition, setSlotReadyState, slotIndexes, transitionTo])

  const handleEnded = useCallback((slot: PlaybackSlot, slotIndex: number) => {
    if (slot !== activeSlot || slotIndex !== currentIndex) return
    if (currentIndex >= videos.length - 1) {
      setIsPlaying(false)
      setIsBuffering(false)
      return
    }
    requestTransition(currentIndex + 1)
  }, [activeSlot, currentIndex, requestTransition, videos.length])

  const handlePrevious = useCallback(() => {
    requestTransition(Math.max(0, currentIndex - 1))
  }, [currentIndex, requestTransition])

  const handleNext = useCallback(() => {
    requestTransition(Math.min(videos.length - 1, currentIndex + 1))
  }, [currentIndex, requestTransition, videos.length])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[140] glass-overlay flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass-surface-modal w-full max-w-6xl p-4 space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
              {t('toolbar.mergePlay')}
            </h3>
            <p className="text-sm text-[var(--glass-text-tertiary)] truncate">
              {getSafeFileName(projectName)} · {videos.length > 0 ? `${currentIndex + 1}/${videos.length}` : t('stage.noVideos')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="glass-btn-base glass-btn-secondary px-3 py-2 text-sm"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="min-h-[360px] flex flex-col items-center justify-center gap-3 text-[var(--glass-text-secondary)]">
            <AppIcon name="loader" className="w-8 h-8 animate-spin" />
            <span>{t('stage.mergePreparing')}</span>
          </div>
        ) : error ? (
          <div className="min-h-[240px] flex items-center justify-center">
            <div className="max-w-2xl w-full p-4 rounded-lg border border-[var(--glass-stroke-danger)] bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]">
              {error}
            </div>
          </div>
        ) : currentVideo ? (
          <div className="space-y-3">
            <div
              className="relative w-full min-h-[240px] max-h-[70vh] aspect-video bg-black rounded-lg overflow-hidden"
              style={{ aspectRatio: playbackAspectRatio }}
            >
              {slotIndexes.map((slotIndex, slot) => {
                const playbackSlot = slot as PlaybackSlot
                const slotVideo = slotIndex === null ? null : videos[slotIndex]
                const isActive = playbackSlot === activeSlot && slotIndex === currentIndex
                return (
                  <video
                    key={`merged-playback-slot-${playbackSlot}`}
                    ref={(element) => {
                      videoRefs.current[playbackSlot] = element
                    }}
                    src={slotVideo?.videoUrl}
                    preload="auto"
                    controls={isActive}
                    playsInline
                    aria-hidden={!isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={`absolute inset-0 h-full w-full object-contain bg-black transition-opacity duration-150 ${
                      isActive ? 'z-10 opacity-100' : 'pointer-events-none opacity-0'
                    }`}
                    onCanPlay={() => handleCanPlay(playbackSlot)}
                    onLoadStart={() => setSlotReadyState(playbackSlot, false)}
                    onWaiting={() => {
                      if (isActive) setIsBuffering(true)
                    }}
                    onPlaying={() => {
                      if (isActive) {
                        setIsBuffering(false)
                        setIsPlaying(true)
                      }
                    }}
                    onEnded={() => {
                      if (slotIndex !== null) handleEnded(playbackSlot, slotIndex)
                    }}
                    onPlay={() => {
                      if (isActive) setIsPlaying(true)
                    }}
                    onPause={() => {
                      if (isActive && !videoRefs.current[playbackSlot]?.ended) setIsPlaying(false)
                    }}
                    onError={() => {
                      if (pendingTransition?.slot === playbackSlot) {
                        setPendingTransition(null)
                        setIsBuffering(false)
                        setIsPlaying(false)
                      }
                    }}
                  />
                )
              })}
              {isBuffering && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                  <AppIcon name="loader" className="w-8 h-8 animate-spin text-white/80" />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-[var(--glass-text-primary)] truncate">
                  {currentVideo.fileName}
                </p>
                <p className="text-xs text-[var(--glass-text-tertiary)]">
                  {currentIndex + 1} / {videos.length}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevious}
                  disabled={currentIndex === 0}
                  className="glass-btn-base glass-btn-secondary px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <AppIcon name="chevronLeft" className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isPlaying) {
                      videoRefs.current[activeSlot]?.pause()
                      setIsPlaying(false)
                      return
                    }
                    setIsPlaying(true)
                    void playSlot(activeSlot)
                  }}
                  className="glass-btn-base glass-btn-primary px-4 py-2 text-sm flex items-center gap-2"
                >
                  <AppIcon name={isPlaying ? 'pause' : 'play'} className="w-4 h-4" />
                  <span>{isPlaying ? t('panelCard.pause') : t('panelCard.play')}</span>
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={currentIndex >= videos.length - 1}
                  className="glass-btn-base glass-btn-secondary px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <AppIcon name="chevronRight" className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-[240px] flex items-center justify-center text-[var(--glass-text-tertiary)]">
            {t('stage.noVideos')}
          </div>
        )}
      </div>
    </div>
  )
}

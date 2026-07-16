'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { MergedVideoItem } from './useVideoMergeActions'

interface MergedVideoPlaylistModalProps {
  open: boolean
  loading: boolean
  error: string | null
  projectName: string
  videos: MergedVideoItem[]
  onClose: () => void
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
  onClose,
}: MergedVideoPlaylistModalProps) {
  const t = useTranslations('video')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)

  const currentVideo = useMemo(
    () => videos[currentIndex] || null,
    [currentIndex, videos],
  )

  useEffect(() => {
    if (!open) {
      setCurrentIndex(0)
      setIsPlaying(true)
      return
    }

    if (videos.length > 0) {
      setCurrentIndex(0)
      setIsPlaying(true)
    }
  }, [open, videos])

  useEffect(() => {
    if (!open || loading || !currentVideo || !isPlaying) return

    const frame = window.requestAnimationFrame(async () => {
      if (!videoRef.current) return
      try {
        await videoRef.current.play()
      } catch (playError) {
        if ((playError as { name?: string }).name !== 'AbortError') {
          setIsPlaying(false)
        }
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [currentVideo, isPlaying, loading, open])

  const handlePrevious = useCallback(() => {
    setCurrentIndex((previous) => Math.max(0, previous - 1))
    setIsPlaying(true)
  }, [])

  const handleNext = useCallback(() => {
    setCurrentIndex((previous) => Math.min(videos.length - 1, previous + 1))
    setIsPlaying(true)
  }, [videos.length])

  const handleEnded = useCallback(() => {
    if (currentIndex < videos.length - 1) {
      setCurrentIndex((previous) => Math.min(videos.length - 1, previous + 1))
      setIsPlaying(true)
      return
    }
    setIsPlaying(false)
  }, [currentIndex, videos.length])

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
            <div className="bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                key={currentVideo.videoUrl}
                src={currentVideo.videoUrl}
                controls
                playsInline
                className="w-full max-h-[70vh] object-contain bg-black"
                onEnded={handleEnded}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
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
                      videoRef.current?.pause()
                      setIsPlaying(false)
                      return
                    }
                    void videoRef.current?.play()
                    setIsPlaying(true)
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


'use client'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'

interface VideoToolbarProps {
  totalPanels: number
  runningCount: number
  videosWithUrl: number
  mergedVideosCount: number
  failedCount: number
  isAnyTaskRunning: boolean
  isDownloading: boolean
  isPreparingMergedPlayback: boolean
  isDownloadingMergedVideo: boolean
  onGenerateAll: () => void
  onDownloadAll: () => void
  onPlayMerged: () => void
  onDownloadMerged: () => void
  onBack: () => void
  onEnterEditor?: () => void  // 进入剪辑器
  videosReady?: boolean  // 是否有视频可以剪辑
  mergedVideosReady?: boolean
}

export default function VideoToolbar({
  totalPanels,
  runningCount,
  videosWithUrl,
  mergedVideosCount,
  failedCount,
  isAnyTaskRunning,
  isDownloading,
  isPreparingMergedPlayback,
  isDownloadingMergedVideo,
  onGenerateAll,
  onDownloadAll,
  onPlayMerged,
  onDownloadMerged,
  onBack,
  onEnterEditor,
  videosReady = false,
  mergedVideosReady = false,
}: VideoToolbarProps) {
  const t = useTranslations('video')
  const videoTaskRunningState = isAnyTaskRunning
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'generate',
      resource: 'video',
      hasOutput: videosWithUrl > 0,
    })
    : null
  const videoDownloadState = isDownloading
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'generate',
      resource: 'video',
      hasOutput: videosWithUrl > 0,
    })
    : null
  return (
    <div className="glass-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-[var(--glass-text-secondary)]">
             {t('toolbar.title')}
          </span>
          <span className="text-sm text-[var(--glass-text-tertiary)]">
            {t('toolbar.totalShots', { count: totalPanels })}
            {runningCount > 0 && (
              <span className="text-[var(--glass-tone-info-fg)] ml-2 animate-pulse">({t('toolbar.generatingShots', { count: runningCount })})</span>
            )}
            {videosWithUrl > 0 && (
              <span className="text-[var(--glass-tone-success-fg)] ml-2">({t('toolbar.completedShots', { count: videosWithUrl })})</span>
            )}
            {mergedVideosCount > 0 && (
              <span className="text-[var(--glass-tone-info-fg)] ml-2">({t('toolbar.mergeCount', { count: mergedVideosCount })})</span>
            )}
            {failedCount > 0 && (
              <span className="text-[var(--glass-tone-danger-fg)] ml-2">({t('toolbar.failedShots', { count: failedCount })})</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onGenerateAll}
            disabled={isAnyTaskRunning}
            className="glass-btn-base glass-btn-primary flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnyTaskRunning ? (
              <TaskStatusInline state={videoTaskRunningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
            ) : (
              <>
                <AppIcon name="plus" className="w-4 h-4" />
                <span>{t('toolbar.generateAll')}</span>
              </>
            )}
          </button>
          <button
            onClick={onDownloadAll}
            disabled={videosWithUrl === 0 || isDownloading}
            className="glass-btn-base glass-btn-tone-info flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title={videosWithUrl === 0 ? t('toolbar.noVideos') : t('toolbar.downloadCount', { count: videosWithUrl })}
          >
            {isDownloading ? (
              <TaskStatusInline state={videoDownloadState} className="text-white [&>span]:text-white [&_svg]:text-white" />
            ) : (
              <>
                <AppIcon name="image" className="w-4 h-4" />
              <span>{t('toolbar.downloadAll')}</span>
              </>
            )}
          </button>
          <button
            onClick={onPlayMerged}
            disabled={!mergedVideosReady || isPreparingMergedPlayback || isDownloadingMergedVideo}
            className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--glass-stroke-base)] disabled:opacity-50 disabled:cursor-not-allowed"
            title={mergedVideosReady ? t('toolbar.mergeCount', { count: mergedVideosCount }) : t('stage.noVideos')}
          >
            {isPreparingMergedPlayback ? (
              <>
                <AppIcon name="loader" className="w-4 h-4 animate-spin" />
                <span>{t('toolbar.merging')}</span>
              </>
            ) : (
              <>
                <AppIcon name="film" className="w-4 h-4" />
                <span>{t('toolbar.mergePlay')}</span>
              </>
            )}
          </button>
          <button
            onClick={onDownloadMerged}
            disabled={!mergedVideosReady || isDownloadingMergedVideo || isPreparingMergedPlayback}
            className="glass-btn-base glass-btn-tone-success flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title={mergedVideosReady ? t('toolbar.mergeCount', { count: mergedVideosCount }) : t('stage.noVideos')}
          >
            {isDownloadingMergedVideo ? (
              <>
                <AppIcon name="loader" className="w-4 h-4 animate-spin" />
                <span>{t('toolbar.merging')}</span>
              </>
            ) : (
              <>
                <AppIcon name="download" className="w-4 h-4" />
                <span>{t('toolbar.mergeDownload')}</span>
              </>
            )}
          </button>
          {onEnterEditor && (
            <button
              onClick={onEnterEditor}
              disabled={!videosReady}
              className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--glass-stroke-base)] disabled:opacity-50 disabled:cursor-not-allowed"
              title={videosReady ? t('toolbar.enterEditor') : t('panelCard.needVideo')}
            >
              <AppIcon name="wandOff" className="w-4 h-4" />
              <span>{t('toolbar.enterEdit')}</span>
            </button>
          )}
          <button
            onClick={onBack}
            className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--glass-stroke-base)] hover:text-[var(--glass-tone-info-fg)]"
          >
            <AppIcon name="chevronLeft" className="w-4 h-4" />
            <span>{t('toolbar.back')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

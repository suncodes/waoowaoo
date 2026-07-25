'use client'

import { useCallback, useMemo, useState } from 'react'
import type { VideoPanel } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import type { EpisodeVideoUrlsResponse } from './types'
import { getErrorMessage } from './utils'

interface MutationLike<TInput = unknown, TOutput = unknown> {
  mutateAsync: (input: TInput) => Promise<TOutput>
}

export interface MergedVideoItem {
  index: number
  fileName: string
  videoUrl: string
}

interface MergedVideoExportResult {
  outputUrl: string
  downloadUrl: string
  fileName: string
  videoCount: number
  sizeBytes?: number
}

interface UseVideoMergeActionsParams {
  episodeId: string
  allPanels: VideoPanel[]
  panelVideoPreference: Map<string, boolean>
  t: (key: string) => string
  listEpisodeVideoUrlsMutation: MutationLike<{
    episodeId: string
    panelPreferences: Record<string, boolean>
  }>
  mergeEpisodeVideoMutation: MutationLike<{
    episodeId: string
    panelPreferences: Record<string, boolean>
  }, MergedVideoExportResult>
}

function sanitizeFileName(value: string): string {
  const normalized = value.trim().slice(0, 80)
  return normalized.replace(/[\\/:*?"<>|]/g, '_') || 'videos'
}

function buildPanelPreferences(allPanels: VideoPanel[], panelVideoPreference: Map<string, boolean>): Record<string, boolean> {
  const preferences: Record<string, boolean> = {}
  for (const panel of allPanels) {
    const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
    preferences[panelKey] = panelVideoPreference.get(panelKey) ?? true
  }
  return preferences
}

export function useVideoMergeActions({
  episodeId,
  allPanels,
  panelVideoPreference,
  t,
  listEpisodeVideoUrlsMutation,
  mergeEpisodeVideoMutation,
}: UseVideoMergeActionsParams) {
  const [isMergedPlayerOpen, setIsMergedPlayerOpen] = useState(false)
  const [isPreparingMergedPlayback, setIsPreparingMergedPlayback] = useState(false)
  const [isDownloadingMergedVideo, setIsDownloadingMergedVideo] = useState(false)
  const [mergedPlaybackError, setMergedPlaybackError] = useState<string | null>(null)
  const [mergedProjectName, setMergedProjectName] = useState('videos')
  const [mergedVideos, setMergedVideos] = useState<MergedVideoItem[]>([])

  const panelPreferences = useMemo(
    () => buildPanelPreferences(allPanels, panelVideoPreference),
    [allPanels, panelVideoPreference],
  )

  const mergedVideosCount = useMemo(
    () => allPanels.filter((panel) => !!panel.videoUrl || !!panel.audioMixedVideoUrl || !!panel.lipSyncVideoUrl).length,
    [allPanels],
  )

  const loadMergedVideos = useCallback(async () => {
    const data = await listEpisodeVideoUrlsMutation.mutateAsync({
      episodeId,
      panelPreferences,
    })
    const result = (data || {}) as EpisodeVideoUrlsResponse
    const videos = result.videos || []
    if (videos.length === 0) {
      throw new Error(t('stage.noVideos'))
    }
    return {
      projectName: sanitizeFileName(result.projectName || 'videos'),
      videos,
    }
  }, [episodeId, listEpisodeVideoUrlsMutation, panelPreferences, t])

  const handleOpenMergedPlayback = useCallback(async () => {
    if (isPreparingMergedPlayback || isDownloadingMergedVideo) return

    setIsMergedPlayerOpen(true)
    setIsPreparingMergedPlayback(true)
    setMergedPlaybackError(null)
    setMergedVideos([])
    setMergedProjectName('videos')

    try {
      const { projectName, videos } = await loadMergedVideos()
      setMergedProjectName(projectName)
      setMergedVideos(videos)
    } catch (error) {
      setMergedPlaybackError(getErrorMessage(error))
    } finally {
      setIsPreparingMergedPlayback(false)
    }
  }, [isDownloadingMergedVideo, isPreparingMergedPlayback, loadMergedVideos])

  const handleCloseMergedPlayback = useCallback(() => {
    setIsMergedPlayerOpen(false)
    setMergedPlaybackError(null)
  }, [])

  const handleDownloadMergedVideo = useCallback(async () => {
    if (isDownloadingMergedVideo || isPreparingMergedPlayback) return

    setIsDownloadingMergedVideo(true)
    try {
      const result = await mergeEpisodeVideoMutation.mutateAsync({
        episodeId,
        panelPreferences,
      })

      const anchor = document.createElement('a')
      anchor.href = result.downloadUrl || result.outputUrl
      anchor.download = result.fileName || 'merged.mp4'
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
    } catch (error) {
      alert(`${t('stage.mergeFailed')}: ${getErrorMessage(error)}`)
    } finally {
      setIsDownloadingMergedVideo(false)
    }
  }, [episodeId, isDownloadingMergedVideo, isPreparingMergedPlayback, mergeEpisodeVideoMutation, panelPreferences, t])

  return {
    mergedVideosCount,
    mergedProjectName,
    mergedVideos,
    mergedPlaybackError,
    isMergedPlayerOpen,
    isPreparingMergedPlayback,
    isDownloadingMergedVideo,
    handleOpenMergedPlayback,
    handleCloseMergedPlayback,
    handleDownloadMergedVideo,
  }
}

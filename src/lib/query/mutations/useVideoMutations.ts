import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { resolveTaskResponse } from '@/lib/task/client'
import { invalidateQueryTemplates, requestJsonWithError, requestTaskResponseWithError } from './mutation-shared'

/**
 * 获取剧集可下载视频列表（项目）
 */
export function useListProjectEpisodeVideoUrls(projectId: string) {
  return useMutation({
    mutationFn: async (payload: {
      episodeId: string
      panelPreferences: Record<string, boolean>
    }) =>
      await requestJsonWithError(
        `/api/novel-promotion/${projectId}/video-urls`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '获取视频列表失败',
      ),
  })
}

/**
 * 合并导出剧集视频（项目）
 */
export function useMergeProjectEpisodeVideo(projectId: string) {
  return useMutation({
    mutationFn: async (payload: {
      episodeId: string
      panelPreferences: Record<string, boolean>
      audioStrategy?: 'timeline' | 'none'
      subtitleStrategy?: 'none' | 'burned'
      subtitleStyle?: unknown
    }) => {
      const response = await requestTaskResponseWithError(
        `/api/novel-promotion/${projectId}/merge-videos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '合并视频失败',
      )
      return await resolveTaskResponse<{
        outputUrl: string
        downloadUrl: string
        fileName: string
        videoCount: number
        sizeBytes?: number
        audioTrackApplied?: boolean
        subtitleRequested?: boolean
        subtitleTrackApplied?: boolean
        subtitleCueCount?: number
        subtitleTrackId?: string | null
        subtitleSrtDownloadUrl?: string | null
        subtitleAssDownloadUrl?: string | null
      }>(response)
    },
  })
}

/**
 * 将单个镜头的已生成配音混合到镜头视频
 */
export function useMixProjectPanelAudio(projectId: string, episodeId?: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      panelId?: string
      storyboardId?: string
      panelIndex?: number
      voiceLineIds?: string[]
      force?: boolean
    }) => {
      const response = await requestTaskResponseWithError(
        `/api/novel-promotion/${projectId}/audio-mix`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '音频混合失败',
      )
      return await resolveTaskResponse(response)
    },
    onSettled: async () => {
      if (episodeId) {
        await invalidateQueryTemplates(queryClient, [
          queryKeys.episodeData(projectId, episodeId),
          queryKeys.voiceLines.matched(projectId, episodeId),
          queryKeys.tasks.targetStatesAll(projectId),
        ])
      } else {
        await invalidateQueryTemplates(queryClient, [
          queryKeys.projectData(projectId),
          queryKeys.tasks.targetStatesAll(projectId),
        ])
      }
    },
  })
}

/**
 * 批量将剧集内可用配音混合到镜头视频
 */
export function useMixProjectEpisodeAudio(projectId: string, episodeId?: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      episodeId: string
      force?: boolean
    }) => {
      const response = await requestTaskResponseWithError(
        `/api/novel-promotion/${projectId}/audio-mix`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            all: true,
          }),
        },
        '批量音频混合失败',
      )
      return await response.json()
    },
    onSettled: async (_data, _error, variables) => {
      const resolvedEpisodeId = variables?.episodeId || episodeId
      if (resolvedEpisodeId) {
        await invalidateQueryTemplates(queryClient, [
          queryKeys.episodeData(projectId, resolvedEpisodeId),
          queryKeys.voiceLines.matched(projectId, resolvedEpisodeId),
          queryKeys.tasks.targetStatesAll(projectId),
        ])
      } else {
        await invalidateQueryTemplates(queryClient, [
          queryKeys.projectData(projectId),
          queryKeys.tasks.targetStatesAll(projectId),
        ])
      }
    },
  })
}

/**
 * 更新 panel 首尾帧链接状态（项目）
 */
export function useUpdateProjectPanelLink(projectId: string) {
  return useMutation({
    mutationFn: async (payload: {
      storyboardId: string
      panelIndex: number
      linked: boolean
    }) =>
      await requestJsonWithError(
        `/api/novel-promotion/${projectId}/panel-link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '保存链接状态失败',
      ),
  })
}

/**
 * 更新 Panel 视频提示词
 */
export function useUpdateProjectPanelVideoPrompt(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      storyboardId,
      panelIndex,
      value,
      field = 'videoPrompt',
    }: {
      storyboardId: string
      panelIndex: number
      value: string
      field?: 'videoPrompt' | 'firstLastFramePrompt'
    }) =>
      await requestJsonWithError(
        `/api/novel-promotion/${projectId}/panel`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyboardId,
            panelIndex,
            ...(field === 'firstLastFramePrompt'
              ? { firstLastFramePrompt: value }
              : { videoPrompt: value }),
          }),
        },
        'update failed',
      ),
    onSettled: () => {
      invalidateQueryTemplates(queryClient, [queryKeys.projectData(projectId)])
    },
  })
}

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '../keys'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'
import type {
  StoryboardAutoFixApplyResult,
  StoryboardReadinessResult,
} from '@/lib/novel-promotion/storyboard-readiness/types'

export type StoryboardAutoFixClientAction = 'prepare' | 'apply' | 'regenerate' | 'accept_risk'
export type StoryboardAutoFixClientResult = StoryboardReadinessResult | StoryboardAutoFixApplyResult

async function readApiError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return new Error(resolveTaskErrorMessage(payload, fallback))
}

function invalidateStoryboardReadiness(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string | null,
  episodeId: string | null,
) {
  if (!projectId || !episodeId) return
  queryClient.invalidateQueries({ queryKey: queryKeys.storyboardReadiness.detail(projectId, episodeId) })
  queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
  queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
  queryClient.invalidateQueries({ queryKey: queryKeys.voiceLines.all(episodeId) })
  queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) })
  queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
}

export function useStoryboardReadiness(
  projectId: string | null,
  episodeId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.storyboardReadiness.detail(projectId || '', episodeId || ''),
    queryFn: async () => {
      if (!projectId || !episodeId) throw new Error('Project ID and Episode ID are required')
      const response = await apiFetch(
        `/api/novel-promotion/${projectId}/storyboard-readiness?episodeId=${encodeURIComponent(episodeId)}`,
      )
      if (!response.ok) throw await readApiError(response, '分镜图片前置检查失败')
      return await response.json() as StoryboardReadinessResult
    },
    enabled: enabled && !!projectId && !!episodeId,
    staleTime: 5000,
  })
}

export function useStoryboardAutoFix(projectId: string | null, episodeId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (action: StoryboardAutoFixClientAction = 'prepare') => {
      if (!projectId || !episodeId) throw new Error('Project ID and Episode ID are required')
      const response = await apiFetch(`/api/novel-promotion/${projectId}/storyboard-auto-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, action }),
      })
      if (!response.ok) throw await readApiError(response, '分镜自动修复失败')
      return await response.json() as StoryboardAutoFixClientResult
    },
    onSettled: async () => {
      invalidateStoryboardReadiness(queryClient, projectId, episodeId)
    },
  })
}

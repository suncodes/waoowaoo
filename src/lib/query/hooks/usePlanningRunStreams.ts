'use client'

import { apiFetch } from '@/lib/api-fetch'
import type { BookGuideSeed } from '@/lib/book-guide/seed'
import { selectRecoverableRun } from '@/lib/run-runtime/recovery'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { useRunStreamState, type RunResult } from './useRunStreamState'

type PlanningRunOptions = {
  projectId: string
  episodeId?: string | null
}

type BasePlanningParams = {
  episodeId: string
  model?: string
}

export type ContentPlanRunParams = BasePlanningParams & {
  content: string
  bookGuideSeed?: BookGuideSeed | null
  mode?: 'full' | 'rewrite_unit'
  targetUnitId?: string
  instruction?: string
}

export type VisualPlanRunParams = BasePlanningParams & {
  deferStoryboard?: boolean
  instruction?: string
  forceRegenerate?: boolean
}
export type PlanningRunResult = RunResult

async function resolvePlanningRunId(params: {
  projectId: string
  episodeId?: string
  workflowType: TaskType
}) {
  if (!params.episodeId) return null
  const search = new URLSearchParams({
    projectId: params.projectId,
    workflowType: params.workflowType,
    targetType: 'NovelPromotionEpisode',
    targetId: params.episodeId,
    episodeId: params.episodeId,
    limit: '20',
    _v: '2',
  })
  search.append('status', 'queued')
  search.append('status', 'running')
  search.append('status', 'canceling')
  const response = await apiFetch(`/api/runs?${search.toString()}`, {
    method: 'GET',
    cache: 'no-store',
  })
  if (!response.ok) return null
  const data = await response.json().catch(() => null)
  const runs = data && typeof data === 'object' && Array.isArray((data as { runs?: unknown[] }).runs)
    ? (data as { runs: Array<Record<string, unknown>> }).runs
    : []
  return selectRecoverableRun(runs.map((run) => ({
    id: typeof run.id === 'string' ? run.id : null,
    status: typeof run.status === 'string' ? run.status : null,
    createdAt: typeof run.createdAt === 'string' ? run.createdAt : null,
    updatedAt: typeof run.updatedAt === 'string' ? run.updatedAt : null,
    leaseExpiresAt: typeof run.leaseExpiresAt === 'string' ? run.leaseExpiresAt : null,
    heartbeatAt: typeof run.heartbeatAt === 'string' ? run.heartbeatAt : null,
  }))).runId
}

export function useContentPlanRunStream({ projectId, episodeId }: PlanningRunOptions) {
  return useRunStreamState<ContentPlanRunParams>({
    projectId,
    endpoint: (pid) => `/api/novel-promotion/${pid}/content-plan`,
    storageKeyPrefix: 'novel-promotion:content-plan-run',
    storageScopeKey: episodeId || undefined,
    resolveActiveRunId: async ({ projectId: pid, storageScopeKey }) => await resolvePlanningRunId({
      projectId: pid,
      episodeId: storageScopeKey,
      workflowType: TASK_TYPE.CONTENT_PLAN_RUN,
    }),
    validateParams: (params) => {
      if (!params.episodeId || !params.content.trim()) throw new Error('content is required')
    },
    buildRequestBody: (params) => ({
      episodeId: params.episodeId,
      content: params.content,
      bookGuideSeed: params.bookGuideSeed || undefined,
      model: params.model || undefined,
      mode: params.mode || 'full',
      targetUnitId: params.targetUnitId || undefined,
      instruction: params.instruction || undefined,
      async: true,
      displayMode: 'detail',
    }),
  })
}

export function useVisualPlanRunStream({ projectId, episodeId }: PlanningRunOptions) {
  return useRunStreamState<VisualPlanRunParams>({
    projectId,
    endpoint: (pid) => `/api/novel-promotion/${pid}/visual-plan`,
    storageKeyPrefix: 'novel-promotion:visual-plan-run',
    storageScopeKey: episodeId || undefined,
    resolveActiveRunId: async ({ projectId: pid, storageScopeKey }) => await resolvePlanningRunId({
      projectId: pid,
      episodeId: storageScopeKey,
      workflowType: TASK_TYPE.VISUAL_PLAN_RUN,
    }),
    validateParams: (params) => {
      if (!params.episodeId) throw new Error('episodeId is required')
    },
    buildRequestBody: (params) => ({
      episodeId: params.episodeId,
      model: params.model || undefined,
      deferStoryboard: params.deferStoryboard === true,
      instruction: params.instruction || undefined,
      forceRegenerate: params.forceRegenerate === true || undefined,
      async: true,
      displayMode: 'detail',
    }),
  })
}

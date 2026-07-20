'use client'

import { useCallback, useMemo } from 'react'
import type { BookGuideSeed } from '@/lib/book-guide/seed'
import {
  useContentPlanRunStream,
  useVisualPlanRunStream,
} from '@/lib/query/hooks'

interface UseWorkspacePlanningFlowsParams {
  projectId: string
  episodeId?: string
  analysisModel?: string | null
  t: (key: string) => string
  setTransitionProgress: (value: { message: string; step: string }) => void
}

export function useWorkspacePlanningFlows({
  projectId,
  episodeId,
  analysisModel,
  t,
  setTransitionProgress,
}: UseWorkspacePlanningFlowsParams) {
  const contentPlanStream = useContentPlanRunStream({ projectId, episodeId })
  const visualPlanStream = useVisualPlanRunStream({ projectId, episodeId })

  const runContentPlan = useCallback(async (content: string, options?: { bookGuideSeed?: BookGuideSeed | null }) => {
    if (!episodeId) throw new Error(t('execution.selectEpisode'))
    setTransitionProgress({ message: t('execution.contentPlanRunning'), step: 'planning' })
    const result = await contentPlanStream.run({
      episodeId,
      content,
      bookGuideSeed: options?.bookGuideSeed || undefined,
      model: analysisModel || undefined,
    })
    if (result.status !== 'completed') {
      throw new Error(result.errorMessage || t('execution.contentPlanFailed'))
    }
  }, [analysisModel, contentPlanStream, episodeId, setTransitionProgress, t])

  const runContentUnitRewrite = useCallback(async (
    content: string,
    targetUnitId: string,
    instruction?: string,
  ) => {
    if (!episodeId) throw new Error(t('execution.selectEpisode'))
    setTransitionProgress({ message: t('execution.contentPlanRunning'), step: 'planning' })
    const result = await contentPlanStream.run({
      episodeId,
      content,
      model: analysisModel || undefined,
      mode: 'rewrite_unit',
      targetUnitId,
      instruction,
    })
    if (result.status !== 'completed') {
      throw new Error(result.errorMessage || t('execution.contentPlanFailed'))
    }
  }, [analysisModel, contentPlanStream, episodeId, setTransitionProgress, t])

  const runVisualPlan = useCallback(async (deferStoryboard = false) => {
    if (!episodeId) throw new Error(t('execution.selectEpisode'))
    setTransitionProgress({ message: t('execution.visualPlanRunning'), step: 'planning' })
    const result = await visualPlanStream.run({
      episodeId,
      model: analysisModel || undefined,
      deferStoryboard,
    })
    if (result.status !== 'completed') {
      throw new Error(result.errorMessage || t('execution.visualPlanFailed'))
    }
  }, [analysisModel, episodeId, setTransitionProgress, t, visualPlanStream])

  const isPlanning = useMemo(() => (
    contentPlanStream.isRunning
    || contentPlanStream.isRecoveredRunning
    || visualPlanStream.isRunning
    || visualPlanStream.isRecoveredRunning
  ), [
    contentPlanStream.isRecoveredRunning,
    contentPlanStream.isRunning,
    visualPlanStream.isRecoveredRunning,
    visualPlanStream.isRunning,
  ])

  return {
    contentPlanStream,
    visualPlanStream,
    runContentPlan,
    runContentUnitRewrite,
    runVisualPlan,
    isPlanning,
  }
}

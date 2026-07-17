'use client'

import { useCallback, useMemo } from 'react'
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

  const runContentPlan = useCallback(async (content: string) => {
    if (!episodeId) throw new Error(t('execution.selectEpisode'))
    setTransitionProgress({ message: t('execution.contentPlanRunning'), step: 'planning' })
    const result = await contentPlanStream.run({
      episodeId,
      content,
      model: analysisModel || undefined,
    })
    if (result.status !== 'completed') {
      throw new Error(result.errorMessage || t('execution.contentPlanFailed'))
    }
    contentPlanStream.reset()
  }, [analysisModel, contentPlanStream, episodeId, setTransitionProgress, t])

  const runVisualPlan = useCallback(async () => {
    if (!episodeId) throw new Error(t('execution.selectEpisode'))
    setTransitionProgress({ message: t('execution.visualPlanRunning'), step: 'planning' })
    const result = await visualPlanStream.run({
      episodeId,
      model: analysisModel || undefined,
    })
    if (result.status !== 'completed') {
      throw new Error(result.errorMessage || t('execution.visualPlanFailed'))
    }
    visualPlanStream.reset()
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
    runVisualPlan,
    isPlanning,
  }
}

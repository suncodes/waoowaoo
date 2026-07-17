'use client'

import { useEpisodeData } from '@/lib/query/hooks'
import type { NovelPromotionClip, NovelPromotionStoryboard } from '@/types/project'
import { useWorkspaceProvider } from '../WorkspaceProvider'

interface EpisodeStagePayload {
  name?: string
  novelText?: string | null
  clips?: NovelPromotionClip[]
  storyboards?: NovelPromotionStoryboard[]
  creativeBrief?: unknown
  contentPlan?: unknown
  contentReview?: unknown
  directorTreatment?: unknown
  productionBible?: unknown
}

export function useWorkspaceEpisodeStageData() {
  const { projectId, episodeId } = useWorkspaceProvider()
  const { data: episodeData } = useEpisodeData(projectId, episodeId || null)
  const payload = episodeData as EpisodeStagePayload | null

  return {
    episodeName: payload?.name,
    novelText: payload?.novelText || '',
    clips: payload?.clips || [],
    storyboards: payload?.storyboards || [],
    creativeBrief: payload?.creativeBrief,
    contentPlan: payload?.contentPlan,
    contentReview: payload?.contentReview,
    directorTreatment: payload?.directorTreatment,
    productionBible: payload?.productionBible,
  }
}

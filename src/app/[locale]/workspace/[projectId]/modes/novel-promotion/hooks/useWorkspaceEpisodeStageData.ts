'use client'

import { useEpisodeData } from '@/lib/query/hooks'
import type { NovelPromotionClip, NovelPromotionStoryboard } from '@/types/project'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import { isWorkspaceClipActive } from '@/lib/creation-workspace/guide-clips'

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
  const clips = (payload?.clips || []).filter(isWorkspaceClipActive)
  const activeClipIds = new Set(clips.map((clip) => clip.id))

  return {
    episodeName: payload?.name,
    novelText: payload?.novelText || '',
    clips,
    storyboards: (payload?.storyboards || []).filter((storyboard) => activeClipIds.has(storyboard.clipId)),
    creativeBrief: payload?.creativeBrief,
    contentPlan: payload?.contentPlan,
    contentReview: payload?.contentReview,
    directorTreatment: payload?.directorTreatment,
    productionBible: payload?.productionBible,
  }
}

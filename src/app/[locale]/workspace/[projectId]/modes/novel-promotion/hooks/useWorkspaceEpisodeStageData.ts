'use client'

import { useMemo } from 'react'
import { useEpisodeData } from '@/lib/query/hooks'
import type { NovelPromotionClip, NovelPromotionStoryboard } from '@/types/project'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import { isWorkspaceClipActive } from '@/lib/creation-workspace/guide-clips'

interface EpisodeStagePayload {
  name?: string
  novelText?: string | null
  clips?: NovelPromotionClip[]
  storyboards?: NovelPromotionStoryboard[]
  voiceLines?: Array<{
    id: string
    audioUrl?: string | null
    media?: { url?: string | null } | null
    voicePresetId?: string | null
    matchedPanelId?: string | null
    matchedStoryboardId?: string | null
    matchedPanelIndex?: number | null
  }>
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
  const sourceClips = payload?.clips
  const sourceStoryboards = payload?.storyboards
  const clips = useMemo(
    () => (sourceClips || []).filter(isWorkspaceClipActive),
    [sourceClips],
  )
  const storyboards = useMemo(() => {
    const activeClipIds = new Set(clips.map((clip) => clip.id))
    return (sourceStoryboards || []).filter((storyboard) => activeClipIds.has(storyboard.clipId))
  }, [clips, sourceStoryboards])

  return {
    episodeName: payload?.name,
    novelText: payload?.novelText || '',
    clips,
    storyboards,
    voiceLines: payload?.voiceLines || [],
    creativeBrief: payload?.creativeBrief,
    contentPlan: payload?.contentPlan,
    contentReview: payload?.contentReview,
    directorTreatment: payload?.directorTreatment,
    productionBible: payload?.productionBible,
  }
}

'use client'

import type { AppIconName } from '@/components/ui/icons'
import type { StageArtifactReadiness } from '@/lib/novel-promotion/stage-readiness'
import { isBookGuideProfile, type VideoProfile } from '@/lib/video-profile'

export type WorkspaceStageStatus =
  | 'not_started'
  | 'ready'
  | 'running'
  | 'attention'
  | 'completed'
  | 'failed'
  | 'stale'

export interface WorkspaceStageNavItem {
  id: string
  icon: AppIconName
  label: string
  status: WorkspaceStageStatus
  disabled?: boolean
  disabledLabel?: string
}

interface StageRunState {
  status?: string
  isRunning?: boolean
  isRecoveredRunning?: boolean
}

interface UseWorkspaceStageNavigationParams {
  stageArtifacts: StageArtifactReadiness
  videoProfile: VideoProfile
  contentPlanStream: StageRunState
  storyToScriptStream: StageRunState
  visualPlanStream: StageRunState
  scriptToStoryboardStream: StageRunState
  t: (key: string) => string
}

function resolveRunStatus(stream: StageRunState): 'running' | 'failed' | null {
  if (stream.isRunning || stream.isRecoveredRunning || stream.status === 'running') return 'running'
  if (stream.status === 'failed') return 'failed'
  return null
}

function resolveStageStatus(params: {
  completed: boolean
  ready: boolean
  stream?: StageRunState
}): WorkspaceStageStatus {
  const runStatus = params.stream ? resolveRunStatus(params.stream) : null
  if (runStatus) return runStatus
  if (params.completed) return 'completed'
  if (params.ready) return 'ready'
  return 'not_started'
}

export function useWorkspaceStageNavigation({
  stageArtifacts,
  videoProfile,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
  t,
}: UseWorkspaceStageNavigationParams): WorkspaceStageNavItem[] {
  const isBookGuide = isBookGuideProfile(videoProfile)
  const storyboardReady = stageArtifacts.hasVisualPlan
    || (stageArtifacts.hasScript && !stageArtifacts.hasContentPlan)

  return [
    {
      id: 'config',
      icon: isBookGuide ? 'bookOpen' : 'fileText',
      label: isBookGuide ? t('stages.bookSource') : t('stages.story'),
      status: resolveStageStatus({ completed: stageArtifacts.hasStory, ready: true }),
    },
    {
      id: 'content-plan',
      icon: 'brain',
      label: isBookGuide ? t('stages.guidePlan') : t('stages.contentPlan'),
      status: resolveStageStatus({
        completed: stageArtifacts.hasContentPlan,
        ready: stageArtifacts.hasStory,
        stream: contentPlanStream,
      }),
    },
    {
      id: 'script',
      icon: 'fileText',
      label: isBookGuide ? t('stages.guideScript') : t('stages.script'),
      status: resolveStageStatus({
        completed: stageArtifacts.hasScript,
        ready: stageArtifacts.hasContentPlan,
        stream: storyToScriptStream,
      }),
    },
    {
      id: 'visual-plan',
      icon: 'clapperboard',
      label: t('stages.visualPlan'),
      status: resolveStageStatus({
        completed: stageArtifacts.hasVisualPlan,
        ready: stageArtifacts.hasScript && stageArtifacts.hasContentPlan,
        stream: visualPlanStream,
      }),
    },
    {
      id: 'storyboard',
      icon: 'image',
      label: isBookGuide ? t('stages.guideStoryboard') : t('stages.storyboard'),
      status: resolveStageStatus({
        completed: stageArtifacts.hasStoryboard,
        ready: storyboardReady,
        stream: scriptToStoryboardStream,
      }),
    },
    {
      id: 'videos',
      icon: 'video',
      label: isBookGuide ? t('stages.videoNarration') : t('stages.videoAudio'),
      status: resolveStageStatus({
        completed: stageArtifacts.hasVideo,
        ready: stageArtifacts.hasStoryboard,
      }),
    },
    {
      id: 'editor',
      icon: 'film',
      label: t('stages.finalExport'),
      status: stageArtifacts.hasVideo ? 'ready' : 'not_started',
      disabled: true,
      disabledLabel: t('stages.editorComingSoon'),
    },
  ]
}

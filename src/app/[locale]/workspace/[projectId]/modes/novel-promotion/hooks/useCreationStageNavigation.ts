'use client'

import type { AppIconName } from '@/components/ui/icons'
import type { StageArtifactReadiness } from '@/lib/novel-promotion/stage-readiness'
import {
  CREATION_STAGE_REGISTRY,
  type CreationStageId,
  type CreationStageStatus,
} from '@/lib/creation-workspace/stages'
import { isBookGuideProfile, type VideoProfile } from '@/lib/video-profile'

interface StageRunState {
  status?: string
  isRunning?: boolean
  isRecoveredRunning?: boolean
}

interface UseCreationStageNavigationParams {
  stageArtifacts: StageArtifactReadiness
  videoProfile: VideoProfile
  contentPlanStream: StageRunState
  storyToScriptStream: StageRunState
  visualPlanStream: StageRunState
  scriptToStoryboardStream: StageRunState
  t: (key: string) => string
}

export interface CreationStageNavItem {
  id: CreationStageId
  icon: AppIconName
  label: string
  description: string
  status: CreationStageStatus
  issueCount: number
}

function resolveRunStatus(streams: StageRunState[]): 'running' | 'failed' | null {
  if (streams.some((stream) => stream.isRunning || stream.isRecoveredRunning || stream.status === 'running')) {
    return 'running'
  }
  if (streams.some((stream) => stream.status === 'failed')) return 'failed'
  return null
}

function resolveStageStatus(params: {
  completed: boolean
  ready: boolean
  streams?: StageRunState[]
}): CreationStageStatus {
  const runStatus = resolveRunStatus(params.streams || [])
  if (runStatus) return runStatus
  if (params.completed) return 'completed'
  if (params.ready) return 'ready'
  return 'not_started'
}

export function buildCreationStageNavigation({
  stageArtifacts,
  videoProfile,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
  t,
}: UseCreationStageNavigationParams): CreationStageNavItem[] {
  const isBookGuide = isBookGuideProfile(videoProfile)
  const contentCompleted = stageArtifacts.hasContentPlan && stageArtifacts.hasScript
  const visualReady = contentCompleted || stageArtifacts.hasScript
  const storyboardReady = stageArtifacts.hasVisualPlan || visualReady

  const statusById: Record<CreationStageId, CreationStageStatus> = {
    setup: resolveStageStatus({
      completed: stageArtifacts.hasStory,
      ready: true,
    }),
    content: resolveStageStatus({
      completed: contentCompleted,
      ready: stageArtifacts.hasStory,
      streams: isBookGuide ? [contentPlanStream] : [contentPlanStream, storyToScriptStream],
    }),
    'visual-design': resolveStageStatus({
      completed: stageArtifacts.hasVisualPlan,
      ready: visualReady,
      streams: [visualPlanStream],
    }),
    'storyboard-preview': resolveStageStatus({
      completed: stageArtifacts.hasStoryboard,
      ready: storyboardReady,
      streams: isBookGuide ? [] : [scriptToStoryboardStream],
    }),
    production: resolveStageStatus({
      completed: stageArtifacts.hasVideo,
      ready: stageArtifacts.hasStoryboard,
    }),
    edit: resolveStageStatus({
      completed: false,
      ready: stageArtifacts.hasVideo,
    }),
  }

  return CREATION_STAGE_REGISTRY.map((definition) => ({
    id: definition.id,
    icon: definition.icon,
    label: t(definition.labelKey),
    description: t(definition.descriptionKey),
    status: statusById[definition.id],
    issueCount: statusById[definition.id] === 'failed' ? 1 : 0,
  }))
}

'use client'

import type { AppIconName } from '@/components/ui/icons'
import type { StageArtifactReadiness } from '@/lib/novel-promotion/stage-readiness'
import {
  CREATION_STAGE_REGISTRY,
  type CreationStageId,
  type CreationStageStatus,
} from '@/lib/creation-workspace/stages'
import {
  readContentArtifactMeta,
  readVisualArtifactMeta,
  type WorkspaceArtifactStatus,
} from '@/lib/creation-workspace/artifact-state'
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
  contentPlan?: unknown
  productionBible?: unknown
  t: (key: string) => string
}

export interface CreationStageNavItem {
  id: CreationStageId
  icon: AppIconName
  label: string
  description: string
  status: CreationStageStatus
  issueCount: number
  locked?: boolean
  blockedByStageId?: CreationStageId
  blockedByLabel?: string
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

function resolveArtifactStatus(params: {
  artifactStatus?: WorkspaceArtifactStatus
  completed: boolean
  ready: boolean
  streams?: StageRunState[]
}): CreationStageStatus {
  const runStatus = resolveRunStatus(params.streams || [])
  if (runStatus) return runStatus
  if (params.artifactStatus === 'approved') return 'completed'
  if (params.artifactStatus === 'stale') return 'stale'
  if (params.artifactStatus === 'draft' || params.artifactStatus === 'needs_review') return 'attention'
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
  contentPlan,
  productionBible,
  t,
}: UseCreationStageNavigationParams): CreationStageNavItem[] {
  const isBookGuide = isBookGuideProfile(videoProfile)
  const contentMeta = readContentArtifactMeta(contentPlan)
  const visualMeta = readVisualArtifactMeta(productionBible)
  const legacyContentCompleted = stageArtifacts.hasContentPlan && (isBookGuide || stageArtifacts.hasScript)
  const contentDocumentApproved = contentMeta ? contentMeta.status === 'approved' : legacyContentCompleted
  const assetRequirementsApproved = !contentMeta
    || contentMeta.assetRequirements.status === 'approved'
    || stageArtifacts.hasVisualPlan
  const contentCompleted = contentDocumentApproved && assetRequirementsApproved
  const contentArtifactStatus = contentMeta
    && contentDocumentApproved
    && !assetRequirementsApproved
    ? 'needs_review'
    : contentMeta?.status
  const visualReady = contentCompleted || stageArtifacts.hasScript
  const legacyVisualCompleted = stageArtifacts.hasVisualPlan
  const visualCompleted = visualMeta ? visualMeta.status === 'approved' : legacyVisualCompleted
  const storyboardReady = visualCompleted || (!visualMeta && visualReady)
  const storyboardStale = stageArtifacts.hasStoryboard && (
    contentMeta?.downstream.storyboard === true || visualMeta?.downstream.storyboard === true
  )
  const productionStale = stageArtifacts.hasVideo && (
    contentMeta?.downstream.production === true || visualMeta?.downstream.production === true
  )

  const statusById: Record<CreationStageId, CreationStageStatus> = {
    setup: resolveStageStatus({
      completed: stageArtifacts.hasStory,
      ready: true,
    }),
    content: resolveArtifactStatus({
      artifactStatus: contentArtifactStatus,
      completed: legacyContentCompleted,
      ready: stageArtifacts.hasStory,
      streams: isBookGuide ? [contentPlanStream] : [contentPlanStream, storyToScriptStream],
    }),
    'visual-design': resolveArtifactStatus({
      artifactStatus: visualMeta?.status,
      completed: legacyVisualCompleted,
      ready: visualReady,
      streams: [visualPlanStream],
    }),
    'storyboard-preview': storyboardStale ? 'stale' : resolveStageStatus({
      completed: stageArtifacts.hasStoryboard,
      ready: storyboardReady,
      streams: isBookGuide ? [] : [scriptToStoryboardStream],
    }),
    production: productionStale ? 'stale' : resolveStageStatus({
      completed: stageArtifacts.hasVideo,
      ready: stageArtifacts.hasStoryboard,
    }),
    edit: resolveStageStatus({
      completed: false,
      ready: stageArtifacts.hasVideo,
    }),
  }

  const baseItems = CREATION_STAGE_REGISTRY.map((definition) => ({
    id: definition.id,
    icon: definition.icon,
    label: t(definition.labelKey),
    description: t(definition.descriptionKey),
    status: statusById[definition.id],
    issueCount: statusById[definition.id] === 'failed'
      || statusById[definition.id] === 'attention'
      || statusById[definition.id] === 'stale'
      ? 1
      : 0,
  }))

  return baseItems.map((item) => {
    const definition = CREATION_STAGE_REGISTRY.find((candidate) => candidate.id === item.id)
    const blockedBy = definition?.dependencies
      .map((dependencyId) => baseItems.find((candidate) => candidate.id === dependencyId))
      .find((dependency) => dependency?.status !== 'completed')
    const locked = item.status === 'not_started' && !!blockedBy
    return {
      ...item,
      locked,
      ...(locked && blockedBy
        ? {
            blockedByStageId: blockedBy.id,
            blockedByLabel: blockedBy.label,
          }
        : {}),
    }
  })
}

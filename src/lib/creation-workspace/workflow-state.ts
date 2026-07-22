import type { StageArtifactReadiness } from '@/lib/novel-promotion/stage-readiness'
import { isBookGuideProfile, type VideoProfile } from '@/lib/video-profile'
import {
  readContentArtifactMeta,
  readVisualArtifactMeta,
  type AssetRequirementStatus,
} from './artifact-state'
import {
  CREATION_STAGE_REGISTRY,
  type CreationStageId,
  type CreationStageStatus,
} from './stages'

export type ContentWorkflowStepId = 'plan' | 'script' | 'assets'

export interface CreationWorkflowRunState {
  runId?: string | null
  status?: string | null
  isRunning?: boolean
  isRecoveredRunning?: boolean
  activeStepId?: string | null
  orderedSteps?: Array<{ id: string }>
  overallProgress?: number
  activeMessage?: string
}

export interface CreationWorkflowNodeState<TId extends string> {
  id: TId
  status: CreationStageStatus
  locked: boolean
  blockedById?: string
  hasArtifact: boolean
}

export interface CreationWorkflowActiveTarget {
  key: string
  stageId: CreationStageId
  view?: ContentWorkflowStepId | 'direction'
  route: string
  kind: 'content_plan' | 'content_rewrite' | 'story_script' | 'asset_requirements' | 'visual_plan' | 'storyboard'
  progress: number
  message: string
}

export interface CreationWorkflowState {
  stages: Record<CreationStageId, CreationWorkflowNodeState<CreationStageId>>
  contentSteps: Record<ContentWorkflowStepId, CreationWorkflowNodeState<ContentWorkflowStepId>>
  activeTarget: CreationWorkflowActiveTarget | null
  facts: {
    isBookGuide: boolean
    hasContentPlan: boolean
    hasScriptOutput: boolean
    contentDocumentApproved: boolean
    assetRequirementStatus: AssetRequirementStatus
    assetRequirementCount: number
    contentCompleted: boolean
    visualCompleted: boolean
  }
}

export interface BuildCreationWorkflowStateInput {
  stageArtifacts: StageArtifactReadiness
  videoProfile: VideoProfile
  contentPlanStream: CreationWorkflowRunState
  storyToScriptStream: CreationWorkflowRunState
  visualPlanStream: CreationWorkflowRunState
  scriptToStoryboardStream: CreationWorkflowRunState
  contentPlan?: unknown
  productionBible?: unknown
  isAssetAnalysisRunning?: boolean
}

function isActive(stream: CreationWorkflowRunState) {
  return stream.isRunning || stream.isRecoveredRunning || stream.status === 'running'
}

function isFailed(stream: CreationWorkflowRunState) {
  return stream.status === 'failed'
}

function isContentRewrite(stream: CreationWorkflowRunState) {
  return stream.activeStepId === 'content_unit_rewrite'
    || stream.activeStepId === 'content_unit_review'
    || stream.orderedSteps?.some((step) => step.id === 'content_unit_rewrite') === true
}

function normalizedProgress(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0
}

function activeTarget(params: {
  taskId: string
  stream?: CreationWorkflowRunState
  stageId: CreationStageId
  view?: CreationWorkflowActiveTarget['view']
  route: string
  kind: CreationWorkflowActiveTarget['kind']
  fallbackMessage?: string
}): CreationWorkflowActiveTarget {
  return {
    key: `${params.taskId}:${params.stream?.runId?.trim() || 'active'}`,
    stageId: params.stageId,
    view: params.view,
    route: params.route,
    kind: params.kind,
    progress: normalizedProgress(params.stream?.overallProgress),
    message: params.stream?.activeMessage?.trim() || params.fallbackMessage || '',
  }
}

function resolveActiveTarget(input: BuildCreationWorkflowStateInput): CreationWorkflowActiveTarget | null {
  if (!isBookGuideProfile(input.videoProfile) && isActive(input.scriptToStoryboardStream)) {
    return activeTarget({
      taskId: 'script-to-storyboard',
      stream: input.scriptToStoryboardStream,
      stageId: 'storyboard-preview',
      route: 'storyboard',
      kind: 'storyboard',
    })
  }
  if (isActive(input.visualPlanStream)) {
    return activeTarget({
      taskId: 'visual-plan',
      stream: input.visualPlanStream,
      stageId: 'storyboard-preview',
      route: 'storyboard',
      kind: 'visual_plan',
    })
  }
  if (input.isAssetAnalysisRunning) {
    return activeTarget({
      taskId: 'asset-requirements',
      stageId: 'content',
      view: 'assets',
      route: 'content-assets',
      kind: 'asset_requirements',
    })
  }
  if (!isBookGuideProfile(input.videoProfile) && isActive(input.storyToScriptStream)) {
    return activeTarget({
      taskId: 'story-to-script',
      stream: input.storyToScriptStream,
      stageId: 'content',
      view: 'script',
      route: 'script',
      kind: 'story_script',
    })
  }
  if (isActive(input.contentPlanStream)) {
    const rewrite = isContentRewrite(input.contentPlanStream)
    return activeTarget({
      taskId: rewrite ? 'content-unit-rewrite' : 'content-plan',
      stream: input.contentPlanStream,
      stageId: 'content',
      view: rewrite ? 'script' : 'plan',
      route: rewrite ? 'script' : 'content-plan',
      kind: rewrite ? 'content_rewrite' : 'content_plan',
    })
  }
  return null
}

function applyStageDependencies(
  states: Record<CreationStageId, CreationWorkflowNodeState<CreationStageId>>,
) {
  const result = { ...states }
  for (const definition of CREATION_STAGE_REGISTRY) {
    const blockedBy = definition.dependencies.find((dependencyId) => (
      result[dependencyId].status !== 'completed'
    ))
    result[definition.id] = {
      ...result[definition.id],
      locked: !!blockedBy,
      ...(blockedBy ? { blockedById: blockedBy } : {}),
    }
  }
  return result
}

export function buildCreationWorkflowState(input: BuildCreationWorkflowStateInput): CreationWorkflowState {
  const { stageArtifacts } = input
  const isBookGuide = isBookGuideProfile(input.videoProfile)
  const contentMeta = readContentArtifactMeta(input.contentPlan)
  const visualMeta = readVisualArtifactMeta(input.productionBible)
  const contentPlanRunning = isActive(input.contentPlanStream) && !isContentRewrite(input.contentPlanStream)
  const contentRewriteRunning = isActive(input.contentPlanStream) && isContentRewrite(input.contentPlanStream)
  const storyScriptRunning = !isBookGuide && isActive(input.storyToScriptStream)
  const hasContentPlan = stageArtifacts.hasContentPlan
  const hasScriptOutput = isBookGuide
    ? hasContentPlan
    : stageArtifacts.hasScript
  const legacyContentCompleted = !contentMeta
    && stageArtifacts.hasContentPlan
    && (stageArtifacts.hasVisualPlan || stageArtifacts.hasStoryboard || stageArtifacts.hasVideo)
  const contentDocumentApproved = contentMeta?.status === 'approved' || legacyContentCompleted
  const assetRequirementStatus = contentMeta?.assetRequirements.status
    || (legacyContentCompleted ? 'approved' : 'not_started')
  const assetRequirementCount = contentMeta?.assetRequirements.assetIds.length || 0

  const planStatus: CreationStageStatus = contentPlanRunning
    ? 'running'
    : isFailed(input.contentPlanStream) && !hasContentPlan
      ? 'failed'
      : hasContentPlan
        ? 'completed'
        : 'ready'
  const scriptStatus: CreationStageStatus = contentRewriteRunning || storyScriptRunning
    ? 'running'
    : !isBookGuide && isFailed(input.storyToScriptStream) && !hasScriptOutput
      ? 'failed'
      : planStatus !== 'completed'
        ? hasScriptOutput ? 'stale' : 'not_started'
        : contentDocumentApproved && hasScriptOutput
          ? 'completed'
          : hasScriptOutput
            ? contentMeta?.status === 'stale' ? 'stale' : 'attention'
            : 'ready'
  const assetsStatus: CreationStageStatus = input.isAssetAnalysisRunning
    ? 'running'
    : scriptStatus !== 'completed'
      ? assetRequirementStatus === 'not_started' ? 'not_started' : 'stale'
      : assetRequirementStatus === 'approved'
        ? 'completed'
        : assetRequirementStatus === 'needs_review'
          ? 'attention'
          : assetRequirementStatus === 'stale'
            ? 'stale'
            : 'ready'
  const contentStepStatuses: CreationStageStatus[] = [planStatus, scriptStatus, assetsStatus]
  const contentCompleted = contentStepStatuses.every((status) => status === 'completed')
  const contentRunning = contentStepStatuses.includes('running')

  let contentStatus: CreationStageStatus
  if (contentRunning) contentStatus = 'running'
  else if (contentStepStatuses.includes('failed')) contentStatus = 'failed'
  else if (contentCompleted) contentStatus = 'completed'
  else if (contentStepStatuses.includes('stale')) contentStatus = 'stale'
  else if (contentStepStatuses.includes('attention')) contentStatus = 'attention'
  else if (hasContentPlan || hasScriptOutput || !!contentMeta) contentStatus = 'attention'
  else contentStatus = stageArtifacts.hasStory ? 'ready' : 'not_started'

  const legacyVisualCompleted = !visualMeta && stageArtifacts.hasVisualPlan
  let visualStatus: CreationStageStatus
  if (stageArtifacts.hasVisualPlan && !contentCompleted) visualStatus = 'stale'
  else if (visualMeta?.status === 'approved' || legacyVisualCompleted) visualStatus = 'completed'
  else if (visualMeta?.status === 'stale') visualStatus = 'stale'
  else if (visualMeta || stageArtifacts.hasVisualPlan) visualStatus = 'attention'
  else visualStatus = contentCompleted ? 'ready' : 'not_started'
  const visualCompleted = visualStatus === 'completed'

  const storyboardStale = stageArtifacts.hasStoryboard && (
    visualStatus !== 'completed'
    || contentMeta?.downstream.storyboard === true
    || visualMeta?.downstream.storyboard === true
  )
  let storyboardStatus: CreationStageStatus
  if (isActive(input.visualPlanStream)) storyboardStatus = 'running'
  else if (isFailed(input.visualPlanStream) && !stageArtifacts.hasStoryboard) storyboardStatus = 'failed'
  else if (!isBookGuide && isActive(input.scriptToStoryboardStream)) storyboardStatus = 'running'
  else if (!isBookGuide && isFailed(input.scriptToStoryboardStream)) storyboardStatus = 'failed'
  else if (storyboardStale) storyboardStatus = 'stale'
  else if (stageArtifacts.hasStoryboard) storyboardStatus = 'completed'
  else storyboardStatus = visualCompleted ? 'ready' : 'not_started'

  const productionStale = stageArtifacts.hasVideo && (
    storyboardStatus !== 'completed'
    || contentMeta?.downstream.production === true
    || visualMeta?.downstream.production === true
  )
  const productionStatus: CreationStageStatus = productionStale
    ? 'stale'
    : stageArtifacts.hasVideo
      ? 'completed'
      : storyboardStatus === 'completed'
        ? 'ready'
        : 'not_started'
  const editStatus: CreationStageStatus = productionStatus === 'completed' ? 'ready' : 'not_started'

  const stages = applyStageDependencies({
    setup: {
      id: 'setup',
      status: stageArtifacts.hasStory ? 'completed' : 'ready',
      locked: false,
      hasArtifact: stageArtifacts.hasStory,
    },
    content: {
      id: 'content',
      status: contentStatus,
      locked: false,
      hasArtifact: hasContentPlan || hasScriptOutput,
    },
    'visual-design': {
      id: 'visual-design',
      status: visualStatus,
      locked: false,
      hasArtifact: stageArtifacts.hasVisualPlan,
    },
    'storyboard-preview': {
      id: 'storyboard-preview',
      status: storyboardStatus,
      locked: false,
      hasArtifact: stageArtifacts.hasStoryboard,
    },
    production: {
      id: 'production',
      status: productionStatus,
      locked: false,
      hasArtifact: stageArtifacts.hasVideo,
    },
    edit: {
      id: 'edit',
      status: editStatus,
      locked: false,
      hasArtifact: false,
    },
  })

  const contentSteps: CreationWorkflowState['contentSteps'] = {
    plan: {
      id: 'plan',
      status: planStatus,
      locked: false,
      hasArtifact: stageArtifacts.hasContentPlan,
    },
    script: {
      id: 'script',
      status: scriptStatus,
      locked: planStatus !== 'completed',
      ...(planStatus === 'completed' ? {} : { blockedById: 'plan' }),
      hasArtifact: isBookGuide ? stageArtifacts.hasContentPlan : stageArtifacts.hasScript,
    },
    assets: {
      id: 'assets',
      status: assetsStatus,
      locked: scriptStatus !== 'completed',
      ...(scriptStatus === 'completed' ? {} : { blockedById: 'script' }),
      hasArtifact: assetRequirementStatus !== 'not_started',
    },
  }

  return {
    stages,
    contentSteps,
    activeTarget: resolveActiveTarget(input),
    facts: {
      isBookGuide,
      hasContentPlan,
      hasScriptOutput,
      contentDocumentApproved,
      assetRequirementStatus,
      assetRequirementCount,
      contentCompleted,
      visualCompleted,
    },
  }
}

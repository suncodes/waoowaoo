'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  CREATION_STAGE_REGISTRY,
  type CreationStageId,
} from '@/lib/creation-workspace/stages'

interface AutoFollowStream {
  runId?: string | null
  status?: string | null
  isRunning?: boolean
  isRecoveredRunning?: boolean
  activeStepId?: string | null
  orderedSteps?: Array<{ id: string }>
}

interface CreationWorkspaceAutoFollowInput {
  currentStage: CreationStageId
  stageView?: string
  contentPlanStream: AutoFollowStream
  storyToScriptStream: AutoFollowStream
  visualPlanStream: AutoFollowStream
  scriptToStoryboardStream: AutoFollowStream
}

interface CreationWorkspaceAutoFollowTarget {
  key: string
  stageId: CreationStageId
  view?: string
  route: string
}

function isActive(stream: AutoFollowStream) {
  return stream.isRunning || stream.isRecoveredRunning || stream.status === 'running'
}

function targetKey(taskId: string, stream: AutoFollowStream) {
  return `${taskId}:${stream.runId?.trim() || 'active'}`
}

function isContentUnitRewrite(stream: AutoFollowStream) {
  return stream.activeStepId === 'content_unit_rewrite'
    || stream.activeStepId === 'content_unit_review'
    || stream.orderedSteps?.some((step) => step.id === 'content_unit_rewrite') === true
}

export function resolveCreationWorkspaceAutoFollowTarget({
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
}: Omit<CreationWorkspaceAutoFollowInput, 'currentStage' | 'stageView'>): CreationWorkspaceAutoFollowTarget | null {
  if (isActive(scriptToStoryboardStream)) {
    return {
      key: targetKey('script-to-storyboard', scriptToStoryboardStream),
      stageId: 'storyboard-preview',
      route: 'storyboard',
    }
  }
  if (isActive(visualPlanStream)) {
    return {
      key: targetKey('visual-plan', visualPlanStream),
      stageId: 'visual-design',
      view: 'direction',
      route: 'visual-plan',
    }
  }
  if (isActive(storyToScriptStream)) {
    return {
      key: targetKey('story-to-script', storyToScriptStream),
      stageId: 'content',
      view: 'script',
      route: 'script',
    }
  }
  if (isActive(contentPlanStream)) {
    if (isContentUnitRewrite(contentPlanStream)) {
      return {
        key: targetKey('content-unit-rewrite', contentPlanStream),
        stageId: 'content',
        view: 'script',
        route: 'script',
      }
    }
    return {
      key: targetKey('content-plan', contentPlanStream),
      stageId: 'content',
      view: 'plan',
      route: 'content-plan',
    }
  }
  return null
}

function stageOrder(stageId: CreationStageId) {
  return CREATION_STAGE_REGISTRY.find((stage) => stage.id === stageId)?.order ?? 0
}

export function useCreationWorkspaceAutoFollow({
  currentStage,
  stageView,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
  onStageChange,
}: CreationWorkspaceAutoFollowInput & { onStageChange: (stage: string) => void }) {
  const handledTargetRef = useRef('')
  const target = useMemo(() => resolveCreationWorkspaceAutoFollowTarget({
    contentPlanStream,
    storyToScriptStream,
    visualPlanStream,
    scriptToStoryboardStream,
  }), [contentPlanStream, scriptToStoryboardStream, storyToScriptStream, visualPlanStream])

  useEffect(() => {
    if (!target) {
      handledTargetRef.current = ''
      return
    }
    if (handledTargetRef.current === target.key) return

    handledTargetRef.current = target.key
    if (stageOrder(currentStage) > stageOrder(target.stageId)) return
    if (target.route === 'content-plan' && currentStage === 'content' && stageView === 'script') return
    if (currentStage === target.stageId && (!target.view || stageView === target.view)) return

    onStageChange(target.route)
  }, [currentStage, onStageChange, stageView, target])
}

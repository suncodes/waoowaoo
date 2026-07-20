'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import LLMStageStreamCard, { type LLMStageViewItem } from '@/components/llm-console/LLMStageStreamCard'
import { AppIcon } from '@/components/ui/icons'
import { isBookGuideProfile, type VideoProfile } from '@/lib/video-profile'
import type { WorkspaceRunStreamState } from './workspace-run-types'

type RunCenterTaskId = 'content-plan' | 'story-to-script' | 'visual-plan' | 'script-to-storyboard'

interface RunCenterTaskDescriptor {
  id: RunCenterTaskId
  stageIds: string[]
  label: string
  subtitle: string
  runningLabel: string
  stream: WorkspaceRunStreamState
  appliesToBookGuide: boolean
}

interface WorkspaceRunStreamConsolesProps {
  currentStage: string
  videoProfile: VideoProfile
  contentPlanStream: WorkspaceRunStreamState
  storyToScriptStream: WorkspaceRunStreamState
  visualPlanStream: WorkspaceRunStreamState
  scriptToStoryboardStream: WorkspaceRunStreamState
  hideMinimizedBadges?: boolean
}

function isRunActive(stream: WorkspaceRunStreamState) {
  return stream.isRunning || stream.isRecoveredRunning || stream.status === 'running'
}

function hasRenderableRun(stream: WorkspaceRunStreamState) {
  return stream.isVisible && (
    isRunActive(stream) ||
    stream.status === 'failed' ||
    stream.stages.length > 0 ||
    !!stream.errorMessage
  )
}

function getTaskStatus(stream: WorkspaceRunStreamState) {
  if (isRunActive(stream)) return 'running'
  if (stream.status === 'failed') return 'failed'
  if (stream.status === 'completed') return 'completed'
  return 'idle'
}

function statusDotClass(status: ReturnType<typeof getTaskStatus>) {
  if (status === 'running') return 'animate-pulse bg-[var(--glass-tone-info-fg)]'
  if (status === 'failed') return 'bg-[var(--glass-tone-danger-fg)]'
  if (status === 'completed') return 'bg-[var(--glass-tone-success-fg)]'
  return 'bg-[var(--glass-stroke-strong)]'
}

function buildFallbackStages(task: RunCenterTaskDescriptor): LLMStageViewItem[] {
  if (task.stream.stages.length > 0) return task.stream.stages

  const status: LLMStageViewItem['status'] =
    task.stream.status === 'failed'
      ? 'failed'
      : isRunActive(task.stream)
        ? 'processing'
        : task.stream.status === 'completed'
          ? 'completed'
          : 'pending'

  return [{
    id: `${task.id}-run`,
    title: task.label,
    status,
    progress: status === 'completed' ? 100 : 0,
    subtitle: task.stream.errorMessage || undefined,
  }]
}

function resolveSelectedStage(
  stages: LLMStageViewItem[],
  stream: WorkspaceRunStreamState,
) {
  const selectedStageId = stream.selectedStep?.id || stream.activeStepId || null
  if (!selectedStageId) return null
  return stages.find((stage) => stage.id === selectedStageId) || null
}

export default function WorkspaceRunStreamConsoles({
  currentStage,
  videoProfile,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
  hideMinimizedBadges,
}: WorkspaceRunStreamConsolesProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.runCenter')
  const isBookGuide = isBookGuideProfile(videoProfile)
  const isContentRewrite =
    contentPlanStream.activeStepId === 'content_unit_rewrite' ||
    contentPlanStream.activeStepId === 'content_unit_review' ||
    contentPlanStream.orderedSteps.some((step) => step.id === 'content_unit_rewrite')

  const tasks = useMemo<RunCenterTaskDescriptor[]>(() => [
    {
      id: 'content-plan',
      stageIds: ['content-plan', 'content'],
      label: isContentRewrite ? t('tasks.contentRewrite') : t('tasks.contentPlan'),
      subtitle: t('subtitles.contentPlan'),
      runningLabel: t('running.contentPlan'),
      stream: contentPlanStream,
      appliesToBookGuide: true,
    },
    {
      id: 'story-to-script',
      stageIds: ['script', 'content'],
      label: t('tasks.storyScript'),
      subtitle: t('subtitles.storyScript'),
      runningLabel: t('running.storyScript'),
      stream: storyToScriptStream,
      appliesToBookGuide: false,
    },
    {
      id: 'visual-plan',
      stageIds: ['visual-plan', 'visual-design'],
      label: t('tasks.visualPlan'),
      subtitle: t('subtitles.visualPlan'),
      runningLabel: t('running.visualPlan'),
      stream: visualPlanStream,
      appliesToBookGuide: true,
    },
    {
      id: 'script-to-storyboard',
      stageIds: ['storyboard', 'storyboard-preview'],
      label: t('tasks.storyboard'),
      subtitle: t('subtitles.storyboard'),
      runningLabel: t('running.storyboard'),
      stream: scriptToStoryboardStream,
      appliesToBookGuide: false,
    },
  ], [
    contentPlanStream,
    isContentRewrite,
    scriptToStoryboardStream,
    storyToScriptStream,
    t,
    visualPlanStream,
  ])

  const visibleTasks = useMemo(
    () => tasks.filter((task) => (!isBookGuide || task.appliesToBookGuide) && hasRenderableRun(task.stream)),
    [isBookGuide, tasks],
  )
  const activeTasks = visibleTasks.filter((task) => isRunActive(task.stream))
  const preferredTaskId =
    activeTasks[0]?.id ||
    visibleTasks.find((task) => task.stageIds.includes(currentStage))?.id ||
    visibleTasks[0]?.id ||
    ''
  const [selectedId, setSelectedId] = useState<RunCenterTaskId | ''>('')
  const [minimized, setMinimized] = useState(false)

  useEffect(() => {
    if (!preferredTaskId) return
    setSelectedId((current) => {
      if (current && visibleTasks.some((task) => task.id === current)) return current
      return preferredTaskId
    })
  }, [preferredTaskId, visibleTasks])

  useEffect(() => {
    if (visibleTasks.length > 0) return
    setSelectedId('')
    setMinimized(false)
  }, [visibleTasks.length])

  const selectedTask = visibleTasks.find((task) => task.id === selectedId) || visibleTasks[0]

  const openTask = useCallback((taskId?: RunCenterTaskId) => {
    if (taskId) setSelectedId(taskId)
    setMinimized(false)
  }, [])

  const handleRetryStepById = useCallback(async (
    stream: WorkspaceRunStreamState,
    stepId: string,
  ) => {
    const input = typeof window !== 'undefined'
      ? window.prompt(t('retryModelPrompt'))
      : null
    const modelOverride = typeof input === 'string' ? input.trim() : ''
    await stream.retryStep({
      stepId,
      modelOverride: modelOverride || undefined,
      reason: 'user_retry_from_run_center',
    })
  }, [t])

  if (!selectedTask) return null

  const selectedStream = selectedTask.stream
  const selectedStages = buildFallbackStages(selectedTask)
  const activeStageId =
    selectedStream.activeStepId ||
    selectedStages[selectedStages.length - 1]?.id ||
    ''
  const selectedStage = resolveSelectedStage(selectedStages, selectedStream)
  const showCursor =
    isRunActive(selectedStream) &&
    selectedStream.selectedStep?.id === selectedStream.activeStepId &&
    selectedStage?.status === 'processing'
  const activeCount = activeTasks.length
  const showFloatingEntry = minimized && !hideMinimizedBadges

  return (
    <>
      {showFloatingEntry ? (
        <button
          type="button"
          onClick={() => openTask(preferredTaskId as RunCenterTaskId)}
          className="glass-surface-modal fixed bottom-6 right-6 z-120 inline-flex max-w-[calc(100vw-3rem)] cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left shadow-[var(--glass-shadow-lg)] transition-colors duration-200 hover:bg-[var(--glass-bg-surface-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--glass-stroke-focus)]"
          aria-label={activeCount > 0 ? t('runningCount', { count: activeCount }) : t('open')}
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
            <AppIcon name={activeCount > 0 ? 'loader' : 'cpu'} className={`h-4 w-4 ${activeCount > 0 ? 'animate-spin' : ''}`} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--glass-text-primary)]">
              {activeCount > 0 ? t('runningCount', { count: activeCount }) : t('open')}
            </span>
            <span className="block truncate text-xs text-[var(--glass-text-tertiary)]">
              {activeTasks[0]?.runningLabel || selectedTask.label}
            </span>
          </span>
        </button>
      ) : null}

      {!minimized ? (
        <div
          className="fixed inset-0 z-120 glass-overlay p-3 backdrop-blur-sm md:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('title')}
        >
          <div className="mx-auto flex h-full w-[min(96vw,1400px)] flex-col gap-3">
            {visibleTasks.length > 1 ? (
              <div className="glass-surface-modal flex shrink-0 gap-2 overflow-x-auto rounded-2xl border border-[var(--glass-stroke-base)] p-2 app-scrollbar">
                {visibleTasks.map((task) => {
                  const active = task.id === selectedTask.id
                  const status = getTaskStatus(task.stream)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => openTask(task.id)}
                      className={`inline-flex min-w-40 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors duration-200 ${active
                        ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] text-[var(--glass-text-primary)]'
                        : 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-surface-strong)] hover:text-[var(--glass-text-primary)]'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{task.label}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--glass-text-tertiary)]">
                          {status === 'running'
                            ? task.runningLabel
                            : status === 'failed'
                              ? t('status.failed')
                              : status === 'completed'
                                ? t('status.completed')
                                : t('status.idle')}
                        </span>
                      </span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(status)}`} />
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div className="min-h-0 flex-1">
              <LLMStageStreamCard
                title={selectedTask.label}
                subtitle={selectedTask.subtitle}
                stages={selectedStages}
                activeStageId={activeStageId}
                selectedStageId={selectedStream.selectedStep?.id || undefined}
                onSelectStage={selectedStream.selectStep}
                onRetryStage={(stepId) => {
                  void handleRetryStepById(selectedStream, stepId)
                }}
                outputText={selectedStream.outputText}
                activeMessage={selectedStream.activeMessage}
                overallProgress={selectedStream.overallProgress}
                showCursor={showCursor}
                autoScroll={selectedStream.selectedStep?.id === selectedStream.activeStepId}
                errorMessage={selectedStream.errorMessage}
                topRightAction={(
                  <div className="flex items-center gap-2">
                    {isRunActive(selectedStream) ? (
                      <button
                        type="button"
                        onClick={selectedStream.stop}
                        className="glass-btn-base glass-btn-secondary cursor-pointer rounded-lg px-3 py-1.5 text-xs"
                      >
                        {t('stop')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setMinimized(true)}
                      className="glass-btn-base glass-btn-secondary cursor-pointer rounded-lg px-3 py-1.5 text-xs"
                    >
                      {t('minimize')}
                    </button>
                  </div>
                )}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { splitStructuredOutput } from '@/components/llm-console/LLMStageStreamCard'
import { AppIcon } from '@/components/ui/icons'
import { isBookGuideProfile, type VideoProfile } from '@/lib/video-profile'
import type { LLMStageViewStatus } from '@/components/llm-console/LLMStageStreamCard'
import type { WorkspaceRunStreamState } from './workspace-run-types'

type WorkspaceTaskId = 'content-plan' | 'story-to-script' | 'visual-plan' | 'script-to-storyboard'

interface WorkspaceTaskPanelProps {
  currentStage: string
  videoProfile: VideoProfile
  contentPlanStream: WorkspaceRunStreamState
  storyToScriptStream: WorkspaceRunStreamState
  visualPlanStream: WorkspaceRunStreamState
  scriptToStoryboardStream: WorkspaceRunStreamState
}

interface TaskDescriptor {
  id: WorkspaceTaskId
  stageId: string
  label: string
  stream: WorkspaceRunStreamState
}

function isActive(stream: WorkspaceRunStreamState) {
  return stream.isRunning || stream.isRecoveredRunning || stream.status === 'running'
}

function taskStatus(stream: WorkspaceRunStreamState) {
  if (isActive(stream)) return 'running'
  if (stream.status === 'failed') return 'failed'
  if (stream.status === 'completed') return 'completed'
  return 'idle'
}

function stepStatusClass(status: LLMStageViewStatus) {
  if (status === 'completed') return 'text-[var(--glass-tone-success-fg)] bg-[var(--glass-tone-success-bg)]'
  if (status === 'processing') return 'text-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]'
  if (status === 'failed') return 'text-[var(--glass-tone-danger-fg)] bg-[var(--glass-tone-danger-bg)]'
  if (status === 'blocked' || status === 'stale') return 'text-[var(--glass-tone-warning-fg)] bg-[var(--glass-tone-warning-bg)]'
  return 'text-[var(--glass-text-tertiary)] bg-[var(--glass-bg-muted)]'
}

function stepStatusIcon(status: LLMStageViewStatus) {
  if (status === 'completed') return 'check'
  if (status === 'processing') return 'loader'
  if (status === 'failed') return 'alert'
  if (status === 'blocked' || status === 'stale') return 'clock'
  return 'minus'
}

function TaskPanelContent({
  descriptors,
  selectedId,
  onSelect,
  onClose,
}: {
  descriptors: TaskDescriptor[]
  selectedId: WorkspaceTaskId
  onSelect: (id: WorkspaceTaskId) => void
  onClose?: () => void
}) {
  const t = useTranslations('novelPromotion.workspaceFlow.taskPanel')
  const tProgress = useTranslations('progress')
  const selected = descriptors.find((item) => item.id === selectedId) || descriptors[0]
  const stream = selected.stream
  const selectedStepId = stream.selectedStep?.id || stream.activeStepId || ''
  const structuredOutput = splitStructuredOutput(stream.outputText)
  const finalOutput = structuredOutput.hasStructured
    ? structuredOutput.finalText
    : stream.outputText
  const resolveProgressText = useCallback((value: string | undefined, fallback: string) => {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw) return fallback
    if (!raw.startsWith('progress.')) return raw
    try {
      return tProgress(raw.slice('progress.'.length) as never)
    } catch {
      return raw
    }
  }, [tProgress])
  const currentMessage = resolveProgressText(stream.activeMessage, t('waiting'))
  const completedSteps = stream.stages.filter((stage) => stage.status === 'completed' || stage.status === 'stale').length
  const selectedStep = stream.selectedStep
  const canRetry = stream.status === 'failed' && !!selectedStep?.retryable

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-[var(--glass-bg-surface)]">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke-base)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
          <p className="mt-0.5 truncate text-xs text-[var(--glass-text-tertiary)]">{currentMessage}</p>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="glass-btn-base glass-btn-secondary inline-flex h-8 w-8 items-center justify-center p-0" title={t('close')}>
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-2 border-b border-[var(--glass-stroke-base)] p-3">
        {descriptors.map((descriptor) => {
          const status = taskStatus(descriptor.stream)
          const active = descriptor.id === selected.id
          return (
            <button
              key={descriptor.id}
              type="button"
              onClick={() => onSelect(descriptor.id)}
              className={`min-h-14 cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${active
                ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)]'
                : 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] hover:bg-[var(--glass-bg-surface-strong)]'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-[var(--glass-text-primary)]">{descriptor.label}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${status === 'running'
                  ? 'animate-pulse bg-[var(--glass-tone-info-fg)]'
                  : status === 'failed'
                    ? 'bg-[var(--glass-tone-danger-fg)]'
                    : status === 'completed'
                      ? 'bg-[var(--glass-tone-success-fg)]'
                      : 'bg-[var(--glass-stroke-strong)]'
                }`} />
              </span>
              <span className="mt-1 block text-[11px] text-[var(--glass-text-tertiary)]">
                {status === 'running' ? t('status.running') : status === 'failed' ? t('status.failed') : status === 'completed' ? t('status.completed') : t('status.notStarted')}
              </span>
            </button>
          )
        })}
      </div>

      <div className="border-b border-[var(--glass-stroke-base)] px-4 py-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-[var(--glass-text-secondary)]">{selected.label}</span>
          <span className="text-[var(--glass-text-tertiary)]">{t('stepCount', { current: completedSteps, total: stream.stages.length })}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-muted)]">
          <div
            className="h-full rounded-full bg-[var(--glass-accent-from)] transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, stream.overallProgress))}%` }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 app-scrollbar">
        {stream.stages.length > 0 ? (
          <ol className="space-y-2">
            {stream.stages.map((stage) => {
              const active = stage.id === selectedStepId
              return (
                <li key={stage.id}>
                  <button
                    type="button"
                    onClick={() => stream.selectStep(stage.id)}
                    className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${active
                      ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)]'
                      : 'border-transparent hover:border-[var(--glass-stroke-base)] hover:bg-[var(--glass-bg-surface-strong)]'
                    }`}
                  >
                    <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${stepStatusClass(stage.status)}`}>
                      <AppIcon name={stepStatusIcon(stage.status)} className={`h-3.5 w-3.5 ${stage.status === 'processing' ? 'animate-spin' : ''}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-xs font-semibold text-[var(--glass-text-primary)]">{resolveProgressText(stage.title, stage.title)}</span>
                      {stage.subtitle ? <span className="mt-1 block break-words text-[11px] leading-4 text-[var(--glass-text-tertiary)]">{resolveProgressText(stage.subtitle, stage.subtitle)}</span> : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="flex min-h-36 flex-col items-center justify-center text-center">
            <AppIcon name={isActive(stream) ? 'loader' : 'clock'} className={`h-5 w-5 text-[var(--glass-text-tertiary)] ${isActive(stream) ? 'animate-spin' : ''}`} />
            <p className="mt-2 text-xs text-[var(--glass-text-tertiary)]">{isActive(stream) ? t('waitingSteps') : t('noRun')}</p>
          </div>
        )}

        {stream.errorMessage ? (
          <div className="mt-3 rounded-lg border border-[var(--glass-tone-danger-fg)]/30 bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-xs leading-5 text-[var(--glass-tone-danger-fg)]">
            {stream.errorMessage}
          </div>
        ) : null}

        {finalOutput ? (
          <section className="mt-4 border-t border-[var(--glass-stroke-base)] pt-4">
            <h3 className="text-xs font-semibold text-[var(--glass-text-primary)]">{t('outputTitle')}</h3>
            <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--glass-bg-muted)] p-3 font-sans text-xs leading-5 text-[var(--glass-text-secondary)] app-scrollbar">{finalOutput}</pre>
          </section>
        ) : null}
      </div>

      {(isActive(stream) || canRetry) ? (
        <footer className="flex justify-end gap-2 border-t border-[var(--glass-stroke-base)] px-3 py-3">
          {isActive(stream) ? (
            <button type="button" onClick={stream.stop} className="glass-btn-base glass-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs">
              <AppIcon name="pause" className="h-3.5 w-3.5" />
              <span>{t('stop')}</span>
            </button>
          ) : null}
          {canRetry && selectedStep ? (
            <button
              type="button"
              onClick={() => { void stream.retryStep({ stepId: selectedStep.id, reason: 'user_retry_from_workspace_panel' }) }}
              className="glass-btn-base glass-btn-primary inline-flex items-center gap-2 px-3 py-2 text-xs"
            >
              <AppIcon name="refresh" className="h-3.5 w-3.5" />
              <span>{t('retry')}</span>
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  )
}

export default function WorkspaceTaskPanel({
  currentStage,
  videoProfile,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
}: WorkspaceTaskPanelProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.taskPanel')
  const [selectedId, setSelectedId] = useState<WorkspaceTaskId>('content-plan')
  const [mobileOpen, setMobileOpen] = useState(false)
  const isBookGuide = isBookGuideProfile(videoProfile)
  const descriptors = useMemo<TaskDescriptor[]>(() => [
    { id: 'content-plan', stageId: 'content-plan', label: t('tasks.contentPlan'), stream: contentPlanStream },
    { id: 'story-to-script', stageId: 'script', label: isBookGuide ? t('tasks.guideScript') : t('tasks.storyScript'), stream: storyToScriptStream },
    { id: 'visual-plan', stageId: 'visual-plan', label: t('tasks.visualPlan'), stream: visualPlanStream },
    { id: 'script-to-storyboard', stageId: 'storyboard', label: t('tasks.storyboard'), stream: scriptToStoryboardStream },
  ], [contentPlanStream, isBookGuide, scriptToStoryboardStream, storyToScriptStream, t, visualPlanStream])
  const activeId = descriptors.find((descriptor) => isActive(descriptor.stream))?.id || null
  const stageId = descriptors.find((descriptor) => descriptor.stageId === currentStage)?.id || null
  const activeCount = descriptors.filter((descriptor) => isActive(descriptor.stream)).length

  useEffect(() => {
    if (activeId) {
      setSelectedId(activeId)
      return
    }
    if (stageId) setSelectedId(stageId)
  }, [activeId, stageId])

  return (
    <>
      <aside className="glass-surface-elevated sticky top-36 hidden h-[calc(100vh-10rem)] min-h-[480px] self-start overflow-hidden rounded-lg 2xl:block">
        <TaskPanelContent descriptors={descriptors} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>

      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        className="glass-btn-base glass-btn-primary fixed bottom-5 left-5 z-50 inline-flex h-11 items-center gap-2 px-4 text-sm shadow-lg 2xl:hidden"
      >
        <AppIcon name={activeCount > 0 ? 'loader' : 'clock'} className={`h-4 w-4 ${activeCount > 0 ? 'animate-spin' : ''}`} />
        <span>{activeCount > 0 ? t('runningCount', { count: activeCount }) : t('open')}</span>
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/25 p-3 backdrop-blur-sm 2xl:hidden" onClick={() => setMobileOpen(false)}>
          <div className="glass-surface-modal ml-auto h-full w-full max-w-sm overflow-hidden rounded-lg" onClick={(event) => event.stopPropagation()}>
            <TaskPanelContent
              descriptors={descriptors}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  )
}

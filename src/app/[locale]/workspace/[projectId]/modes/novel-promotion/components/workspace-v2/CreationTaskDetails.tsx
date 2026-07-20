'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { splitStructuredOutput, type LLMStageViewStatus } from '@/components/llm-console/LLMStageStreamCard'
import { AppIcon } from '@/components/ui/icons'
import type { WorkspaceRunStreamState } from '../workspace-run-types'

export interface CreationTaskDescriptor {
  id: string
  label: string
  stream: WorkspaceRunStreamState
}

interface CreationTaskDetailsProps {
  descriptors: CreationTaskDescriptor[]
}

export function isCreationTaskActive(stream: WorkspaceRunStreamState) {
  return stream.isRunning || stream.isRecoveredRunning || stream.status === 'running'
}

function taskStatus(stream: WorkspaceRunStreamState) {
  if (isCreationTaskActive(stream)) return 'running'
  if (stream.status === 'failed') return 'failed'
  if (stream.status === 'completed') return 'completed'
  return 'idle'
}

function stepStatusClass(status: LLMStageViewStatus) {
  if (status === 'completed') return 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
  if (status === 'processing') return 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
  if (status === 'failed') return 'bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]'
  if (status === 'blocked' || status === 'stale') return 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
  return 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]'
}

function stepStatusIcon(status: LLMStageViewStatus) {
  if (status === 'completed') return 'check'
  if (status === 'processing') return 'loader'
  if (status === 'failed') return 'alert'
  if (status === 'blocked' || status === 'stale') return 'clock'
  return 'minus'
}

export default function CreationTaskDetails({ descriptors }: CreationTaskDetailsProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.assistant')
  const tProgress = useTranslations('progress')
  const [selectedId, setSelectedId] = useState(descriptors[0]?.id || '')
  const activeId = descriptors.find((descriptor) => isCreationTaskActive(descriptor.stream))?.id

  useEffect(() => {
    if (activeId) {
      setSelectedId(activeId)
      return
    }
    if (!descriptors.some((descriptor) => descriptor.id === selectedId)) {
      setSelectedId(descriptors[0]?.id || '')
    }
  }, [activeId, descriptors, selectedId])

  const selected = useMemo(
    () => descriptors.find((descriptor) => descriptor.id === selectedId) || descriptors[0],
    [descriptors, selectedId],
  )
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

  if (!selected) {
    return <p className="py-4 text-sm text-[var(--glass-text-tertiary)]">{t('noGeneration')}</p>
  }

  const stream = selected.stream
  const selectedStepId = stream.selectedStep?.id || stream.activeStepId || ''
  const selectedStep = stream.selectedStep
  const structuredOutput = splitStructuredOutput(stream.outputText)
  const finalOutput = structuredOutput.hasStructured ? structuredOutput.finalText : stream.outputText
  const completedSteps = stream.stages.filter((stage) => stage.status === 'completed' || stage.status === 'stale').length
  const canRetry = stream.status === 'failed' && !!selectedStep?.retryable

  return (
    <div className="min-w-0">
      {descriptors.length > 1 ? (
        <div className="border-b border-[var(--glass-stroke-base)]">
          {descriptors.map((descriptor) => {
            const status = taskStatus(descriptor.stream)
            const active = descriptor.id === selected.id
            return (
              <button
                key={descriptor.id}
                type="button"
                onClick={() => setSelectedId(descriptor.id)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 border-l-2 px-1 py-2.5 text-left transition-colors ${active
                  ? 'border-[var(--glass-stroke-focus)] text-[var(--glass-text-primary)]'
                  : 'border-transparent text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]'
                }`}
              >
                <span className="min-w-0 truncate text-xs font-semibold">{descriptor.label}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${status === 'running'
                  ? 'animate-pulse bg-[var(--glass-tone-info-fg)]'
                  : status === 'failed'
                    ? 'bg-[var(--glass-tone-danger-fg)]'
                    : status === 'completed'
                      ? 'bg-[var(--glass-tone-success-fg)]'
                      : 'bg-[var(--glass-stroke-strong)]'
                }`} />
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="py-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="truncate font-medium text-[var(--glass-text-secondary)]">{selected.label}</span>
          <span className="shrink-0 text-[var(--glass-text-tertiary)]">
            {t('stepCount', { current: completedSteps, total: stream.stages.length })}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-muted)]">
          <div
            className="h-full rounded-full bg-[var(--glass-accent-from)] transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, stream.overallProgress))}%` }}
          />
        </div>
        <p className="mt-2 break-words text-xs leading-5 text-[var(--glass-text-tertiary)]">
          {resolveProgressText(stream.activeMessage, isCreationTaskActive(stream) ? t('waitingSteps') : t('waiting'))}
        </p>
      </div>

      {stream.stages.length > 0 ? (
        <ol className="border-t border-[var(--glass-stroke-base)]">
          {stream.stages.map((stage) => {
            const active = stage.id === selectedStepId
            return (
              <li key={stage.id} className="border-b border-[var(--glass-stroke-soft)] last:border-b-0">
                <button
                  type="button"
                  onClick={() => stream.selectStep(stage.id)}
                  className={`flex w-full cursor-pointer items-start gap-3 px-1 py-2.5 text-left transition-colors ${active ? 'bg-[var(--glass-tone-info-bg)]' : 'hover:bg-[var(--glass-bg-surface-strong)]'}`}
                >
                  <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${stepStatusClass(stage.status)}`}>
                    <AppIcon name={stepStatusIcon(stage.status)} className={`h-3.5 w-3.5 ${stage.status === 'processing' ? 'animate-spin' : ''}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-xs font-semibold text-[var(--glass-text-primary)]">
                      {resolveProgressText(stage.title, stage.title)}
                    </span>
                    {stage.subtitle ? (
                      <span className="mt-1 block break-words text-[11px] leading-4 text-[var(--glass-text-tertiary)]">
                        {resolveProgressText(stage.subtitle, stage.subtitle)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="border-t border-[var(--glass-stroke-base)] py-5 text-center text-xs text-[var(--glass-text-tertiary)]">
          {isCreationTaskActive(stream) ? t('waitingSteps') : t('noRun')}
        </div>
      )}

      {stream.errorMessage ? (
        <div className="border-t border-[var(--glass-stroke-base)] py-3 text-xs leading-5 text-[var(--glass-tone-danger-fg)]">
          {stream.errorMessage}
        </div>
      ) : null}

      {finalOutput ? (
        <details className="border-t border-[var(--glass-stroke-base)] py-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--glass-text-primary)]">{t('outputTitle')}</summary>
          <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words bg-[var(--glass-bg-muted)] p-3 font-sans text-xs leading-5 text-[var(--glass-text-secondary)] app-scrollbar">{finalOutput}</pre>
        </details>
      ) : null}

      {isCreationTaskActive(stream) || canRetry ? (
        <div className="flex justify-end gap-2 border-t border-[var(--glass-stroke-base)] pt-3">
          {isCreationTaskActive(stream) ? (
            <button type="button" onClick={stream.stop} className="glass-btn-base glass-btn-secondary h-9 px-3 text-xs">
              <AppIcon name="pause" className="h-3.5 w-3.5" />
              {t('stop')}
            </button>
          ) : null}
          {canRetry && selectedStep ? (
            <button
              type="button"
              onClick={() => { void stream.retryStep({ stepId: selectedStep.id, reason: 'user_retry_from_creation_workspace' }) }}
              className="glass-btn-base glass-btn-primary h-9 px-3 text-xs"
            >
              <AppIcon name="refresh" className="h-3.5 w-3.5" />
              {t('retry')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

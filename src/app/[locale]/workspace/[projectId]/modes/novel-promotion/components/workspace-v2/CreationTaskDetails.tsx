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
  if (status === 'completed') return 'bg-emerald-400/10 text-emerald-200'
  if (status === 'processing') return 'bg-cyan-400/10 text-cyan-100'
  if (status === 'failed') return 'bg-rose-400/10 text-rose-100'
  if (status === 'blocked' || status === 'stale') return 'bg-amber-400/10 text-amber-100'
  return 'bg-white/[0.06] text-stone-500'
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
    return <p className="py-4 text-sm text-stone-500">{t('noGeneration')}</p>
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
        <div className="mb-3 grid gap-2 border-b border-white/10 pb-3 sm:grid-cols-2">
          {descriptors.map((descriptor) => {
            const status = taskStatus(descriptor.stream)
            const active = descriptor.id === selected.id
            return (
              <button
                key={descriptor.id}
                type="button"
                onClick={() => setSelectedId(descriptor.id)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${active
                  ? 'border-[#e8d18a]/50 bg-[#e8d18a]/10 text-stone-50'
                  : 'border-white/10 bg-white/[0.02] text-stone-400 hover:bg-white/[0.05] hover:text-stone-100'
                }`}
              >
                <span className="min-w-0 truncate text-xs font-semibold">{descriptor.label}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${status === 'running'
                  ? 'animate-pulse bg-cyan-300'
                  : status === 'failed'
                    ? 'bg-rose-300'
                    : status === 'completed'
                      ? 'bg-emerald-300'
                      : 'bg-stone-700'
                }`} />
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="py-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="truncate font-medium text-stone-300">{selected.label}</span>
          <span className="shrink-0 text-stone-500">
            {t('stepCount', { current: completedSteps, total: stream.stages.length })}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#e8d18a] transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, stream.overallProgress))}%` }}
          />
        </div>
        <p className="mt-2 break-words text-xs leading-5 text-stone-500">
          {resolveProgressText(stream.activeMessage, isCreationTaskActive(stream) ? t('waitingSteps') : t('waiting'))}
        </p>
      </div>

      {stream.stages.length > 0 ? (
        <ol className="space-y-1 border-t border-white/10 pt-3">
          {stream.stages.map((stage) => {
            const active = stage.id === selectedStepId
            return (
              <li key={stage.id}>
                <button
                  type="button"
                  onClick={() => stream.selectStep(stage.id)}
                  className={`flex w-full cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 text-left transition-colors ${active ? 'bg-cyan-400/10' : 'hover:bg-white/[0.04]'}`}
                >
                  <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${stepStatusClass(stage.status)}`}>
                    <AppIcon name={stepStatusIcon(stage.status)} className={`h-3.5 w-3.5 ${stage.status === 'processing' ? 'animate-spin' : ''}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-xs font-semibold text-stone-100">
                      {resolveProgressText(stage.title, stage.title)}
                    </span>
                    {stage.subtitle ? (
                      <span className="mt-1 block break-words text-[11px] leading-4 text-stone-500">
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
        <div className="border-t border-white/10 py-5 text-center text-xs text-stone-500">
          {isCreationTaskActive(stream) ? t('waitingSteps') : t('noRun')}
        </div>
      )}

      {stream.errorMessage ? (
        <div className="mt-3 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-3 text-xs leading-5 text-rose-100">
          {stream.errorMessage}
        </div>
      ) : null}

      {finalOutput ? (
        <details className="mt-3 border-t border-white/10 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-stone-100">{t('outputTitle')}</summary>
          <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-3 font-sans text-xs leading-5 text-stone-300">{finalOutput}</pre>
        </details>
      ) : null}

      {isCreationTaskActive(stream) || canRetry ? (
        <div className="mt-3 flex justify-end gap-2 border-t border-white/10 pt-3">
          {isCreationTaskActive(stream) ? (
            <button type="button" onClick={stream.stop} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]">
              <AppIcon name="pause" className="h-3.5 w-3.5" />
              {t('stop')}
            </button>
          ) : null}
          {canRetry && selectedStep ? (
            <button
              type="button"
              onClick={() => { void stream.retryStep({ stepId: selectedStep.id, reason: 'user_retry_from_creation_workspace' }) }}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9]"
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

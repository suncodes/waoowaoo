'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { ContentUnitArtifactState } from '@/lib/creation-workspace/artifact-state'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'

interface ContentUnitActionsProps {
  unitId: string
  state?: ContentUnitArtifactState
  candidateTitle?: string
  candidateBody?: string
  candidateIssueCount?: number
  disabled?: boolean
}

type PendingAction = 'lock' | 'rewrite' | 'accept' | 'discard' | 'restore' | null

export default function ContentUnitActions({
  unitId,
  state,
  candidateTitle,
  candidateBody,
  candidateIssueCount = 0,
  disabled = false,
}: ContentUnitActionsProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.contentUnit')
  const runtime = useWorkspaceStageRuntime()
  const [showRewrite, setShowRewrite] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [error, setError] = useState('')
  const locked = state?.locked === true
  const candidate = state?.candidate

  const run = async (action: Exclude<PendingAction, null>, operation: () => Promise<unknown>) => {
    if (disabled) return
    setPendingAction(action)
    setError('')
    try {
      await operation()
      if (action === 'rewrite') setShowRewrite(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('actionFailed'))
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="mt-3 border-t border-[var(--glass-stroke-base)] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void run('lock', () => runtime.onToggleContentLock(unitId, !locked)) }}
          disabled={disabled || pendingAction !== null}
          className={`glass-btn-base h-8 px-2.5 text-xs ${locked ? 'glass-btn-primary' : 'glass-btn-secondary'}`}
          title={locked ? t('unlockHint') : t('lockHint')}
        >
          <AppIcon name={pendingAction === 'lock' ? 'loader' : locked ? 'unlock' : 'lock'} className={`h-3.5 w-3.5 ${pendingAction === 'lock' ? 'animate-spin' : ''}`} />
          {locked ? t('unlock') : t('lock')}
        </button>

        <button
          type="button"
          onClick={() => setShowRewrite((value) => !value)}
          disabled={disabled || locked || !!candidate || pendingAction !== null || runtime.isTransitioning}
          className="glass-btn-base glass-btn-secondary h-8 px-2.5 text-xs"
          title={locked ? t('rewriteLockedHint') : candidate ? t('candidatePendingHint') : t('rewriteHint')}
        >
          <AppIcon name="sparkles" className="h-3.5 w-3.5" />
          {t('rewrite')}
        </button>

        <button
          type="button"
          onClick={() => { void run('restore', () => runtime.onRestoreContentUnit(unitId)) }}
          disabled={disabled || !state?.previous || locked || pendingAction !== null}
          className="glass-btn-base glass-btn-secondary h-8 px-2.5 text-xs"
          title={!state?.previous ? t('noPreviousHint') : t('restoreHint')}
        >
          <AppIcon name={pendingAction === 'restore' ? 'loader' : 'undo'} className={`h-3.5 w-3.5 ${pendingAction === 'restore' ? 'animate-spin' : ''}`} />
          {t('restore')}
        </button>

        {state && state.revision > 0 ? (
          <span className="ml-auto text-[11px] text-[var(--glass-text-tertiary)]">{t('unitRevision', { revision: state.revision })}</span>
        ) : null}
      </div>

      {showRewrite ? (
        <div className="mt-3 rounded-md bg-[var(--glass-bg-muted)] p-3">
          <label className="block text-xs font-semibold text-[var(--glass-text-secondary)]" htmlFor={`rewrite-${unitId}`}>
            {t('instructionLabel')}
          </label>
          <textarea
            id={`rewrite-${unitId}`}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={2}
            placeholder={t('instructionPlaceholder')}
            className="mt-2 w-full resize-y rounded-md border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowRewrite(false)} className="glass-btn-base glass-btn-secondary h-8 px-3 text-xs">
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => { void run('rewrite', () => runtime.onRegenerateContentUnit(unitId, instruction.trim() || undefined)) }}
              disabled={disabled || pendingAction !== null}
              className="glass-btn-base glass-btn-primary h-8 px-3 text-xs"
            >
              <AppIcon name={pendingAction === 'rewrite' ? 'loader' : 'sparkles'} className={`h-3.5 w-3.5 ${pendingAction === 'rewrite' ? 'animate-spin' : ''}`} />
              {pendingAction === 'rewrite' ? t('rewriting') : t('generateSuggestion')}
            </button>
          </div>
        </div>
      ) : null}

      {candidate ? (
        <div className="mt-3 rounded-md border border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[var(--glass-tone-info-fg)]">{t('candidateTitle')}</p>
              {candidateTitle ? <p className="mt-1 text-sm font-semibold text-[var(--glass-text-primary)]">{candidateTitle}</p> : null}
            </div>
            {candidateIssueCount > 0 ? (
              <span className="rounded-md bg-[var(--glass-tone-warning-bg)] px-2 py-1 text-[11px] text-[var(--glass-tone-warning-fg)]">
                {t('candidateIssues', { count: candidateIssueCount })}
              </span>
            ) : null}
          </div>
          {candidateBody ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--glass-text-secondary)]">{candidateBody}</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => { void run('discard', () => runtime.onDiscardContentCandidate(unitId)) }}
              disabled={disabled || pendingAction !== null}
              className="glass-btn-base glass-btn-secondary h-8 px-3 text-xs"
            >
              <AppIcon name={pendingAction === 'discard' ? 'loader' : 'close'} className={`h-3.5 w-3.5 ${pendingAction === 'discard' ? 'animate-spin' : ''}`} />
              {t('discard')}
            </button>
            <button
              type="button"
              onClick={() => { void run('accept', () => runtime.onAcceptContentCandidate(unitId)) }}
              disabled={disabled || pendingAction !== null}
              className="glass-btn-base glass-btn-primary h-8 px-3 text-xs"
            >
              <AppIcon name={pendingAction === 'accept' ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${pendingAction === 'accept' ? 'animate-spin' : ''}`} />
              {t('accept')}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-[var(--glass-tone-danger-fg)]">{error}</p> : null}
    </div>
  )
}

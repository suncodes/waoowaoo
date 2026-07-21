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
    <div className="border-t border-white/10 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void run('lock', () => runtime.onToggleContentLock(unitId, !locked)) }}
          disabled={disabled || pendingAction !== null}
          className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${locked ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/[0.04] text-stone-200 hover:bg-white/[0.08]'}`}
          title={locked ? t('unlockHint') : t('lockHint')}
        >
          <AppIcon name={pendingAction === 'lock' ? 'loader' : locked ? 'unlock' : 'lock'} className={`h-3.5 w-3.5 ${pendingAction === 'lock' ? 'animate-spin' : ''}`} />
          {locked ? t('unlock') : t('lock')}
        </button>

        <button
          type="button"
          onClick={() => setShowRewrite((value) => !value)}
          disabled={disabled || locked || !!candidate || pendingAction !== null || runtime.isTransitioning}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
          title={locked ? t('rewriteLockedHint') : candidate ? t('candidatePendingHint') : t('rewriteHint')}
        >
          <AppIcon name="sparkles" className="h-3.5 w-3.5" />
          {t('rewrite')}
        </button>

        <button
          type="button"
          onClick={() => { void run('restore', () => runtime.onRestoreContentUnit(unitId)) }}
          disabled={disabled || !state?.previous || locked || pendingAction !== null}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
          title={!state?.previous ? t('noPreviousHint') : t('restoreHint')}
        >
          <AppIcon name={pendingAction === 'restore' ? 'loader' : 'undo'} className={`h-3.5 w-3.5 ${pendingAction === 'restore' ? 'animate-spin' : ''}`} />
          {t('restore')}
        </button>

        {state && state.revision > 0 ? (
          <span className="ml-auto text-[11px] text-stone-500">{t('unitRevision', { revision: state.revision })}</span>
        ) : null}
      </div>

      {showRewrite ? (
        <div className="mt-3 rounded-md border border-[#e8d18a]/20 bg-[#e8d18a]/[0.06] p-3">
          <label className="block text-xs font-semibold text-stone-300" htmlFor={`rewrite-${unitId}`}>
            {t('instructionLabel')}
          </label>
          <textarea
            id={`rewrite-${unitId}`}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={2}
            placeholder={t('instructionPlaceholder')}
            className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#10110f] px-3 py-2 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowRewrite(false)} className="h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]">
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => { void run('rewrite', () => runtime.onRegenerateContentUnit(unitId, instruction.trim() || undefined)) }}
              disabled={disabled || pendingAction !== null}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:opacity-45"
            >
              <AppIcon name={pendingAction === 'rewrite' ? 'loader' : 'sparkles'} className={`h-3.5 w-3.5 ${pendingAction === 'rewrite' ? 'animate-spin' : ''}`} />
              {pendingAction === 'rewrite' ? t('rewriting') : t('generateSuggestion')}
            </button>
          </div>
        </div>
      ) : null}

      {candidate ? (
        <div className="mt-3 rounded-md border border-cyan-400/30 bg-cyan-400/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-cyan-100">{t('candidateTitle')}</p>
              {candidateTitle ? <p className="mt-1 text-sm font-semibold text-stone-50">{candidateTitle}</p> : null}
            </div>
            {candidateIssueCount > 0 ? (
              <span className="rounded-md bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100">
                {t('candidateIssues', { count: candidateIssueCount })}
              </span>
            ) : null}
          </div>
          {candidateBody ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-300">{candidateBody}</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => { void run('discard', () => runtime.onDiscardContentCandidate(unitId)) }}
              disabled={disabled || pendingAction !== null}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08] disabled:opacity-45"
            >
              <AppIcon name={pendingAction === 'discard' ? 'loader' : 'close'} className={`h-3.5 w-3.5 ${pendingAction === 'discard' ? 'animate-spin' : ''}`} />
              {t('discard')}
            </button>
            <button
              type="button"
              onClick={() => { void run('accept', () => runtime.onAcceptContentCandidate(unitId)) }}
              disabled={disabled || pendingAction !== null}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:opacity-45"
            >
              <AppIcon name={pendingAction === 'accept' ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${pendingAction === 'accept' ? 'animate-spin' : ''}`} />
              {t('accept')}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-rose-200">{error}</p> : null}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'

type StageGenerationTone = 'neutral' | 'warning' | 'danger'

interface StageGenerationPanelProps {
  variant?: 'empty' | 'notice'
  tone?: StageGenerationTone
  icon: AppIconName
  title: string
  description: string
  actionLabel?: string
  runningLabel?: string
  actionIcon?: AppIconName
  onAction?: () => Promise<unknown> | void
  isRunning?: boolean
  disabled?: boolean
  progress?: number
  errorFallback: string
}

function toneClasses(tone: StageGenerationTone) {
  if (tone === 'danger') {
    return 'border-[var(--glass-tone-danger-fg)]/25 bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]'
  }
  if (tone === 'warning') {
    return 'border-[var(--glass-stroke-warning)] bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
  }
  return 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] text-[var(--glass-tone-info-fg)]'
}

export default function StageGenerationPanel({
  variant = 'empty',
  tone = 'neutral',
  icon,
  title,
  description,
  actionLabel,
  runningLabel,
  actionIcon = 'sparkles',
  onAction,
  isRunning = false,
  disabled = false,
  progress = 0,
  errorFallback,
}: StageGenerationPanelProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = isRunning || pending
  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)))

  const runAction = async () => {
    if (!onAction || busy || disabled) return
    setPending(true)
    setError('')
    try {
      await onAction()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorFallback)
    } finally {
      setPending(false)
    }
  }

  if (variant === 'notice') {
    return (
      <section
        aria-live="polite"
        aria-busy={busy}
        className={`flex flex-col gap-4 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${toneClasses(tone)}`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--glass-bg-surface)]/70">
            <AppIcon name={busy ? 'loader' : icon} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--glass-text-secondary)]">{description}</p>
            {error ? <p className="mt-2 text-xs text-[var(--glass-tone-danger-fg)]">{error}</p> : null}
          </div>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={() => { void runAction() }}
            disabled={busy || disabled}
            className="glass-btn-base glass-btn-primary h-10 shrink-0 px-4 text-sm"
          >
            <AppIcon name={busy ? 'loader' : actionIcon} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
            <span>{busy ? runningLabel || actionLabel : actionLabel}</span>
          </button>
        ) : null}
      </section>
    )
  }

  return (
    <section
      aria-live="polite"
      aria-busy={busy}
      className="flex min-h-[360px] flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-6 py-12 text-center"
    >
      <span className={`inline-flex h-12 w-12 items-center justify-center rounded-lg border ${toneClasses(tone)}`}>
        <AppIcon name={busy ? 'loader' : icon} className={`h-6 w-6 ${busy ? 'animate-spin' : ''}`} />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-[var(--glass-text-primary)]">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">{description}</p>
      {busy && normalizedProgress > 0 ? (
        <div className="mt-5 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-[var(--glass-bg-muted)]">
          <div
            className="h-full rounded-full bg-[var(--glass-tone-info-fg)] transition-[width] duration-300"
            style={{ width: `${normalizedProgress}%` }}
          />
        </div>
      ) : null}
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={() => { void runAction() }}
          disabled={busy || disabled}
          className="glass-btn-base glass-btn-primary mt-5 h-10 px-4 text-sm"
        >
          <AppIcon name={busy ? 'loader' : actionIcon} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          <span>{busy ? runningLabel || actionLabel : actionLabel}</span>
        </button>
      ) : null}
      {error ? <p className="mt-3 text-xs text-[var(--glass-tone-danger-fg)]">{error}</p> : null}
    </section>
  )
}

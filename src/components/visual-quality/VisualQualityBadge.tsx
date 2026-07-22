'use client'

import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { parseVisualQualityState } from '@/lib/quality-workflow'
import { evaluateVisualReadiness } from '@/lib/visual-readiness'

interface BadgePresentation {
  labelKey: string
  labelValues?: Record<string, number>
  icon: AppIconName
  className: string
  spin?: boolean
}

function resolvePresentation(rawState: unknown): BadgePresentation | null {
  const state = parseVisualQualityState(rawState)
  if (!state) return null
  const readiness = evaluateVisualReadiness(state)

  if (state.humanConfirmedAt) {
    return { labelKey: 'quality.confirmed', icon: 'check', className: 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]' }
  }

  if (state.mode === 'shadow') {
    if (state.status === 'failed') {
      return { labelKey: 'quality.shadowFailed', icon: 'alert', className: 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]' }
    }
    if (state.status === 'shadow_completed') {
      return { labelKey: 'quality.shadowCompleted', icon: 'eye', className: 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)]' }
    }
    return { labelKey: 'quality.shadowReview', icon: 'eye', className: 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]' }
  }

  if (readiness.status === 'ready') {
    return { labelKey: 'quality.approved', icon: 'check', className: 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]' }
  }
  if (readiness.status === 'blocked') {
    return { labelKey: 'quality.humanRequired', icon: 'alert', className: 'bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]' }
  }
  if (state.status === 'repairing') {
    return {
      labelKey: 'quality.repairing',
      labelValues: {
        attempt: Math.min(state.maxAttempts, state.attempt + 1),
        maxAttempts: state.maxAttempts,
      },
      icon: 'loader',
      className: 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]',
      spin: true,
    }
  }
  if (state.status === 'reviewing') {
    return { labelKey: 'quality.reviewing', icon: 'loader', className: 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]', spin: true }
  }
  return { labelKey: 'quality.pending', icon: 'loader', className: 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]', spin: true }
}

export default function VisualQualityBadge({
  state,
  className = '',
}: {
  state: unknown
  className?: string
}) {
  const presentation = resolvePresentation(state)
  if (!presentation) return null

  return <TranslatedVisualQualityBadge presentation={presentation} className={className} />
}

function TranslatedVisualQualityBadge({
  presentation,
  className,
}: {
  presentation: BadgePresentation
  className: string
}) {
  const t = useTranslations('video')

  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium ${presentation.className} ${className}`}>
      <AppIcon name={presentation.icon} className={`h-3 w-3 ${presentation.spin ? 'animate-spin' : ''}`} />
      <span>{t(presentation.labelKey as never, presentation.labelValues as never)}</span>
    </span>
  )
}

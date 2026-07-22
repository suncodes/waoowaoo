'use client'

import type { ReactNode } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { statusLabel, type StudioProductStatus } from './studio-types'

export function studioStatusClass(status: StudioProductStatus) {
  if (status === 'locked') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'generating') return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'
  if (status === 'failed') return 'border-rose-400/30 bg-rose-400/10 text-rose-100'
  if (status === 'stale' || status === 'needs_review') return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  return 'border-white/10 bg-white/5 text-stone-300'
}

export function studioStatusDotClass(status: StudioProductStatus) {
  if (status === 'locked') return 'bg-emerald-400'
  if (status === 'generating') return 'bg-cyan-300'
  if (status === 'failed') return 'bg-rose-300'
  if (status === 'stale' || status === 'needs_review') return 'bg-amber-300'
  if (status === 'drafting') return 'bg-stone-300'
  return 'bg-stone-700'
}

export function StudioPanel({
  children,
  className = '',
  padding = 'md',
}: {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md'
}) {
  const paddingClass = padding === 'none' ? '' : padding === 'sm' ? 'p-4' : 'p-5'
  return (
    <section className={`rounded-lg border border-white/10 bg-[#151613] ${paddingClass} ${className}`}>
      {children}
    </section>
  )
}

export function StudioSectionHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-stone-50">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

export function StudioProcessSteps({
  steps,
}: {
  steps: Array<{
    label: string
    helper?: string
    status: StudioProductStatus
  }>
}) {
  return (
    <ol className="grid gap-2 md:grid-cols-4">
      {steps.map((step, index) => (
        <li key={`${step.label}:${index}`} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${studioStatusDotClass(step.status)}`} />
            <span className="truncate text-sm font-semibold text-stone-100">{step.label}</span>
          </div>
          {step.helper ? <p className="mt-1 truncate text-xs text-stone-500">{step.helper}</p> : null}
        </li>
      ))}
    </ol>
  )
}

export function StudioButton({
  children,
  icon,
  loading,
  onClick,
  disabled,
  variant = 'primary',
  size = 'md',
}: {
  children: ReactNode
  icon?: AppIconName
  loading?: boolean
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
}) {
  const tone = variant === 'primary'
    ? 'bg-[#f3e9cf] text-[#161512] hover:bg-[#fff5d9]'
    : variant === 'secondary'
      ? 'border border-white/12 bg-white/[0.04] text-stone-100 hover:bg-white/[0.08]'
      : 'text-stone-400 hover:bg-white/[0.06] hover:text-stone-100'
  const dimensions = size === 'sm' ? 'h-9 px-3 text-xs' : 'h-10 px-4 text-sm'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dimensions} ${tone}`}
    >
      {loading || icon ? (
        <AppIcon name={loading ? 'loader' : icon!} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      ) : null}
      {children}
    </button>
  )
}

export function StudioStatusBadge({ status, label }: { status: StudioProductStatus; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] ${studioStatusClass(status)}`}>
      {label || statusLabel(status)}
    </span>
  )
}

export function StudioMetric({
  label,
  value,
  helper,
}: {
  label: string
  value: string | number
  helper?: string
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-stone-100">{value}</div>
      {helper ? <div className="mt-1 truncate text-[11px] text-stone-600">{helper}</div> : null}
    </div>
  )
}

export function StudioEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: AppIconName
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-[440px] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#151613] px-6 py-12 text-center">
      <AppIcon name={icon} className="h-8 w-8 text-[#e8d18a]" />
      <h2 className="mt-4 text-lg font-semibold text-stone-50">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function StudioStageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-50">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-400">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  )
}

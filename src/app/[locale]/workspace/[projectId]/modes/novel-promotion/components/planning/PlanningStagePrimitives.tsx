import type { ReactNode } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'

export type PlanningTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

function toneClass(tone: PlanningTone) {
  if (tone === 'success') return 'glass-chip-success'
  if (tone === 'warning') return 'glass-chip-warning'
  if (tone === 'danger') return 'glass-chip-danger'
  if (tone === 'info') return 'glass-chip-info'
  return 'glass-chip-neutral'
}

export function PlanningStageFrame({ children }: { children: ReactNode }) {
  return (
    <section className="glass-surface-elevated min-w-0 overflow-hidden rounded-lg">
      {children}
    </section>
  )
}

export function PlanningStageHeader({
  icon,
  title,
  subtitle,
  statusLabel,
  statusTone = 'neutral',
  actions,
}: {
  icon: AppIconName
  title: string
  subtitle?: string
  statusLabel: string
  statusTone?: PlanningTone
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[var(--glass-stroke-base)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="glass-surface-soft inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--glass-tone-info-fg)]">
          <AppIcon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--glass-text-primary)]">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-sm leading-6 text-[var(--glass-text-secondary)]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`glass-chip ${toneClass(statusTone)}`}>{statusLabel}</span>
        {actions}
      </div>
    </header>
  )
}

export function PlanningStageBody({ children }: { children: ReactNode }) {
  return <div className="p-5 sm:p-6">{children}</div>
}

export function PlanningSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-[var(--glass-stroke-soft)] py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-[var(--glass-text-tertiary)]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

export function PlanningDefinitionGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>
}) {
  return (
    <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium text-[var(--glass-text-tertiary)]">{item.label}</dt>
          <dd className="mt-1 break-words text-sm leading-6 text-[var(--glass-text-primary)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PlanningTagList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <span className="text-sm text-[var(--glass-text-tertiary)]">{emptyLabel}</span>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className="glass-chip glass-chip-neutral max-w-full break-words">
          {item}
        </span>
      ))}
    </div>
  )
}

export function PlanningEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: AppIconName
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
      <span className="glass-surface-soft inline-flex h-12 w-12 items-center justify-center rounded-lg text-[var(--glass-text-secondary)]">
        <AppIcon name={icon} className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-[var(--glass-text-primary)]">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--glass-text-secondary)]">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className="glass-btn-base glass-btn-primary mt-5 inline-flex items-center gap-2 px-4 py-2"
      >
        <span>{actionLabel}</span>
        <AppIcon name="arrowRight" className="h-4 w-4" />
      </button>
    </div>
  )
}

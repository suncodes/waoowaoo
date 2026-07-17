'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import type {
  WorkspaceStageNavItem,
  WorkspaceStageStatus,
} from '../hooks/useWorkspaceStageNavigation'

interface WorkspaceWorkflowRailProps {
  items: WorkspaceStageNavItem[]
  currentStage: string
  projectId: string
  episodeId?: string
  onStageChange: (stage: string) => void
}

function statusIcon(status: WorkspaceStageStatus) {
  if (status === 'completed') return 'check'
  if (status === 'running') return 'loader'
  if (status === 'failed' || status === 'attention') return 'alert'
  if (status === 'stale') return 'clock'
  if (status === 'ready') return 'arrowRight'
  return 'minus'
}

function statusClass(status: WorkspaceStageStatus) {
  if (status === 'completed') return 'text-[var(--glass-tone-success-fg)] bg-[var(--glass-tone-success-bg)]'
  if (status === 'running') return 'text-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]'
  if (status === 'failed' || status === 'attention') return 'text-[var(--glass-tone-danger-fg)] bg-[var(--glass-tone-danger-bg)]'
  if (status === 'stale') return 'text-[var(--glass-tone-warning-fg)] bg-[var(--glass-tone-warning-bg)]'
  if (status === 'ready') return 'text-[var(--glass-text-secondary)] bg-[var(--glass-bg-muted)]'
  return 'text-[var(--glass-text-tertiary)] bg-[var(--glass-bg-muted)]'
}

function WorkspaceStageLink({
  item,
  active,
  href,
  onStageChange,
  statusLabel,
}: {
  item: WorkspaceStageNavItem
  active: boolean
  href: string
  onStageChange: (stage: string) => void
  statusLabel: string
}) {
  const content = (
    <>
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-[var(--glass-tone-info-fg)] text-white' : 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)]'}`}>
        <AppIcon name={item.icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{item.label}</span>
        <span className="mt-0.5 block text-xs text-[var(--glass-text-tertiary)]">{statusLabel}</span>
      </span>
      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${statusClass(item.status)}`}>
        <AppIcon name={statusIcon(item.status)} className={`h-3.5 w-3.5 ${item.status === 'running' ? 'animate-spin' : ''}`} />
      </span>
    </>
  )

  const className = `flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-200 ${active
    ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] text-[var(--glass-text-primary)]'
    : item.disabled
      ? 'cursor-not-allowed border-transparent text-[var(--glass-text-tertiary)] opacity-60'
      : 'cursor-pointer border-transparent text-[var(--glass-text-secondary)] hover:border-[var(--glass-stroke-base)] hover:bg-[var(--glass-bg-surface-strong)] hover:text-[var(--glass-text-primary)]'
  }`

  if (item.disabled) {
    return (
      <button type="button" disabled className={className} title={item.disabledLabel}>
        {content}
      </button>
    )
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'step' : undefined}
      onClick={(event) => {
        if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault()
          onStageChange(item.id)
        }
      }}
      className={className}
    >
      {content}
    </Link>
  )
}

export default function WorkspaceWorkflowRail({
  items,
  currentStage,
  projectId,
  episodeId,
  onStageChange,
}: WorkspaceWorkflowRailProps) {
  const t = useTranslations('novelPromotion.workspaceFlow')
  const statusLabels: Record<WorkspaceStageStatus, string> = {
    not_started: t('status.notStarted'),
    ready: t('status.ready'),
    running: t('status.running'),
    attention: t('status.attention'),
    completed: t('status.completed'),
    failed: t('status.failed'),
    stale: t('status.stale'),
  }
  const buildHref = (stageId: string) => {
    const params = new URLSearchParams({ stage: stageId })
    if (episodeId) params.set('episode', episodeId)
    return `/workspace/${projectId}?${params.toString()}`
  }

  return (
    <>
      <nav aria-label={t('title')} className="glass-surface-elevated hidden self-start rounded-lg p-3 lg:sticky lg:top-36 lg:block">
        <div className="border-b border-[var(--glass-stroke-base)] px-2 pb-3 pt-1">
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
          <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('stageCount', { count: items.length })}</p>
        </div>
        <ol className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <WorkspaceStageLink
                item={item}
                active={currentStage === item.id}
                href={buildHref(item.id)}
                onStageChange={onStageChange}
                statusLabel={statusLabels[item.status]}
              />
            </li>
          ))}
        </ol>
      </nav>

      <nav aria-label={t('title')} className="glass-surface-elevated overflow-x-auto rounded-lg p-2 lg:hidden">
        <ol className="flex min-w-max gap-2">
          {items.map((item) => {
            const active = currentStage === item.id
            if (item.disabled) {
              return (
                <li key={item.id}>
                  <button type="button" disabled className="flex h-14 min-w-32 cursor-not-allowed items-center gap-2 rounded-lg px-3 text-[var(--glass-text-tertiary)] opacity-60" title={item.disabledLabel}>
                    <AppIcon name={item.icon} className="h-4 w-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                </li>
              )
            }
            return (
              <li key={item.id}>
                <Link
                  href={buildHref(item.id)}
                  aria-current={active ? 'step' : undefined}
                  onClick={(event) => {
                    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                      event.preventDefault()
                      onStageChange(item.id)
                    }
                  }}
                  className={`flex h-14 min-w-32 cursor-pointer items-center gap-2 rounded-lg border px-3 transition-colors ${active
                    ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] text-[var(--glass-text-primary)]'
                    : 'border-transparent text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-surface-strong)]'
                  }`}
                >
                  <AppIcon name={item.icon} className="h-4 w-4" />
                  <span className="text-sm font-semibold">{item.label}</span>
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${statusClass(item.status)}`}>
                    <AppIcon name={statusIcon(item.status)} className={`h-3 w-3 ${item.status === 'running' ? 'animate-spin' : ''}`} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
}

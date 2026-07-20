'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { resolveCreationStageRoute, type CreationStageStatus } from '@/lib/creation-workspace/stages'
import type { CreationStageNavItem } from '../../hooks/useCreationStageNavigation'

interface CreationWorkflowRailProps {
  items: CreationStageNavItem[]
  currentStage: string
  projectId: string
  episodeId?: string
  onStageChange: (stage: string) => void
}

function statusIcon(status: CreationStageStatus) {
  if (status === 'completed') return 'check'
  if (status === 'running') return 'loader'
  if (status === 'failed' || status === 'attention') return 'alert'
  if (status === 'stale') return 'clock'
  if (status === 'ready') return 'arrowRight'
  return 'minus'
}

function statusClass(status: CreationStageStatus) {
  if (status === 'completed') return 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
  if (status === 'running') return 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
  if (status === 'failed' || status === 'attention') return 'bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]'
  if (status === 'stale') return 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
  return 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]'
}

export default function CreationWorkflowRail({
  items,
  currentStage,
  projectId,
  episodeId,
  onStageChange,
}: CreationWorkflowRailProps) {
  const t = useTranslations('novelPromotion.workspaceFlow')
  const statusLabels: Record<CreationStageStatus, string> = {
    not_started: t('status.notStarted'),
    ready: t('status.ready'),
    running: t('status.running'),
    attention: t('status.attention'),
    completed: t('status.completed'),
    failed: t('status.failed'),
    stale: t('status.stale'),
  }
  const buildHref = (stageId: CreationStageNavItem['id']) => {
    const route = resolveCreationStageRoute(stageId)
    const params = new URLSearchParams({ stage: route.stageId })
    if (route.view) params.set('view', route.view)
    if (episodeId) params.set('episode', episodeId)
    return `/workspace/${projectId}?${params.toString()}`
  }

  const renderItem = (item: CreationStageNavItem, compact: boolean) => {
    const active = item.id === currentStage
    const blockedLabel = item.blockedByLabel
      ? t('v2.navigation.completeStageFirst', { stage: item.blockedByLabel })
      : undefined
    const className = `group flex items-center gap-3 border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-stroke-focus)] ${compact
          ? 'h-14 min-w-36 rounded-lg px-3'
          : 'min-h-16 w-full rounded-lg px-3 py-2.5 text-left'
        } ${item.locked
          ? 'cursor-not-allowed border-transparent bg-[var(--glass-bg-muted)]/50 text-[var(--glass-text-tertiary)] opacity-70'
          : active
          ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] text-[var(--glass-text-primary)]'
          : 'cursor-pointer border-transparent text-[var(--glass-text-secondary)] hover:border-[var(--glass-stroke-base)] hover:bg-[var(--glass-bg-surface-strong)] hover:text-[var(--glass-text-primary)]'
        }`
    const content = (
      <>
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active
          ? 'bg-[var(--glass-tone-info-fg)] text-white'
          : 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)]'
        }`}>
          <AppIcon name={item.icon} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{item.label}</span>
          {!compact ? (
            <span className="mt-0.5 block text-xs text-[var(--glass-text-tertiary)]">
              {blockedLabel || statusLabels[item.status]}
            </span>
          ) : null}
        </span>
        <span className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${statusClass(item.status)}`}>
          <AppIcon name={item.locked ? 'lock' : statusIcon(item.status)} className={`h-3.5 w-3.5 ${item.status === 'running' ? 'animate-spin' : ''}`} />
          {item.issueCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--glass-tone-danger-fg)] px-1 text-[10px] font-bold text-white">
              {item.issueCount}
            </span>
          ) : null}
        </span>
      </>
    )

    if (item.locked) {
      return (
        <div aria-disabled="true" title={blockedLabel} className={className}>
          {content}
        </div>
      )
    }

    return (
      <Link
        href={buildHref(item.id)}
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

  return (
    <>
      <nav aria-label={t('v2.flowTitle')} className="glass-surface-elevated hidden self-start rounded-lg p-3 lg:sticky lg:top-36 lg:block">
        <div className="border-b border-[var(--glass-stroke-base)] px-2 pb-3 pt-1">
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('v2.flowTitle')}</h2>
          <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('stageCount', { count: items.length })}</p>
        </div>
        <ol className="mt-2 space-y-1">
          {items.map((item) => <li key={item.id}>{renderItem(item, false)}</li>)}
        </ol>
      </nav>

      <nav aria-label={t('v2.flowTitle')} className="glass-surface-elevated overflow-x-auto rounded-lg p-2 lg:hidden">
        <ol className="flex min-w-max gap-2">
          {items.map((item) => <li key={item.id}>{renderItem(item, true)}</li>)}
        </ol>
      </nav>
    </>
  )
}

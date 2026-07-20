'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { CreationStageNavItem } from '../../hooks/useCreationStageNavigation'

interface CreationStageHeaderProps {
  item: CreationStageNavItem
}

export default function CreationStageHeader({ item }: CreationStageHeaderProps) {
  const t = useTranslations('novelPromotion.workspaceFlow')
  return (
    <header className="mb-4 border-b border-[var(--glass-stroke-base)] pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
            <AppIcon name={item.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--glass-text-primary)]">{item.label}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--glass-text-secondary)]">{item.description}</p>
          </div>
        </div>
        <span className={`glass-chip ${item.status === 'completed'
          ? 'glass-chip-success'
          : item.status === 'failed' || item.status === 'attention'
            ? 'glass-chip-danger'
            : item.status === 'running'
              ? 'glass-chip-info'
              : 'glass-chip-neutral'
        }`}>
          {t(`status.${item.status === 'not_started' ? 'notStarted' : item.status}`)}
        </span>
      </div>
    </header>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { CreationStageNavItem } from '../../hooks/useCreationStageNavigation'

interface CreationStageActionBarProps {
  items: CreationStageNavItem[]
  currentStage: string
  onStageChange: (stage: string) => void
}

export default function CreationStageActionBar({
  items,
  currentStage,
  onStageChange,
}: CreationStageActionBarProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.actionBar')
  const currentIndex = items.findIndex((item) => item.id === currentStage)
  const current = items[currentIndex]
  const previous = currentIndex > 0 ? items[currentIndex - 1] : null
  const next = currentIndex >= 0 && currentIndex < items.length - 1 ? items[currentIndex + 1] : null
  const canContinue = current?.status === 'completed'

  return (
    <div className="sticky bottom-3 z-30 mt-6 flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-modal)] px-3 py-2 shadow-[var(--glass-shadow-lg)] backdrop-blur-lg">
      <button
        type="button"
        onClick={() => previous && onStageChange(previous.id)}
        disabled={!previous}
        className="glass-btn-base glass-btn-secondary h-10 px-3 text-sm"
      >
        <AppIcon name="chevronLeft" className="h-4 w-4" />
        <span>{t('previous')}</span>
      </button>

      <span className="inline-flex items-center gap-2 text-xs text-[var(--glass-text-tertiary)]">
        <AppIcon name="check" className="h-3.5 w-3.5 text-[var(--glass-tone-success-fg)]" />
        {t('autoSaved')}
      </span>

      {next ? (
        <button
          type="button"
          onClick={() => onStageChange(next.id)}
          disabled={!canContinue}
          title={!canContinue ? t('completeFirst') : undefined}
          className="glass-btn-base glass-btn-primary h-10 px-4 text-sm"
        >
          <span>{t('continue', { stage: next.label })}</span>
          <AppIcon name="arrowRight" className="h-4 w-4" />
        </button>
      ) : (
        <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('finalStage')}</span>
      )}
    </div>
  )
}

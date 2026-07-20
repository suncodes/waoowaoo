'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'

export default function EditStage() {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.editStage')
  const runtime = useWorkspaceStageRuntime()
  return (
    <section className="glass-surface flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)]">
        <AppIcon name="film" className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('description')}</p>
      <button
        type="button"
        onClick={() => runtime.onStageChange('videos')}
        className="glass-btn-base glass-btn-secondary mt-5 h-10 px-4 text-sm"
      >
        <AppIcon name="video" className="h-4 w-4" />
        {t('backToProduction')}
      </button>
    </section>
  )
}

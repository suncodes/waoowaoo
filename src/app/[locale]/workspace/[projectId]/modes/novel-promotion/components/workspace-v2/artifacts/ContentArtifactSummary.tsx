'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { ContentArtifactMeta } from '@/lib/creation-workspace/artifact-state'

interface ContentArtifactSummaryProps {
  meta: ContentArtifactMeta | null
}

function statusTone(status: ContentArtifactMeta['status']) {
  if (status === 'approved') return 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
  if (status === 'stale') return 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
  return 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
}

export default function ContentArtifactSummary({ meta }: ContentArtifactSummaryProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.artifact')
  if (!meta) return null

  const impact = meta.latestImpact
  const pendingCandidates = Object.values(meta.units).filter((unit) => !!unit.candidate).length
  const lockedUnits = Object.values(meta.units).filter((unit) => unit.locked).length

  return (
    <div className="mb-4 border-y border-[var(--glass-stroke-base)] px-1 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-md px-2 py-1 font-semibold ${statusTone(meta.status)}`}>
          {t(`status.${meta.status}`)}
        </span>
        <span className="text-[var(--glass-text-tertiary)]">{t('revision', { revision: meta.revision })}</span>
        {lockedUnits > 0 ? (
          <span className="inline-flex items-center gap-1 text-[var(--glass-text-secondary)]">
            <AppIcon name="lock" className="h-3.5 w-3.5" />
            {t('lockedCount', { count: lockedUnits })}
          </span>
        ) : null}
        {pendingCandidates > 0 ? (
          <span className="inline-flex items-center gap-1 text-[var(--glass-tone-info-fg)]">
            <AppIcon name="sparkles" className="h-3.5 w-3.5" />
            {t('candidateCount', { count: pendingCandidates })}
          </span>
        ) : null}
      </div>

      {impact ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md bg-[var(--glass-tone-warning-bg)] px-3 py-2 text-xs text-[var(--glass-tone-warning-fg)]">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <AppIcon name="alert" className="h-3.5 w-3.5" />
            {t('impactTitle')}
          </span>
          <span>{t('impactStoryboard', { count: impact.storyboardCount })}</span>
          <span>{t('impactPanel', { count: impact.panelCount })}</span>
          <span>{t('impactVideo', { count: impact.videoCount })}</span>
          <span>{t('impactHint')}</span>
        </div>
      ) : null}
    </div>
  )
}

'use client'

import Image from 'next/image'
import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import { readContentArtifactMeta, readVisualArtifactMeta, type VisualAnchor } from '@/lib/creation-workspace/artifact-state'
import { resolveVisualAnchorReadiness } from '@/lib/creation-workspace/visual-readiness'
import { useAssets } from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'

const KIND_ICON: Record<VisualAnchor['semanticKind'], AppIconName> = {
  character: 'user',
  location: 'imageLandscape',
  prop: 'package',
  vehicle: 'videoWide',
  book_cover: 'bookOpen',
  diagram: 'chart',
}

export default function VisualAnchorBoard() {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.visualAnchors')
  const locale = useLocale()
  const { projectId } = useWorkspaceProvider()
  const runtime = useWorkspaceStageRuntime()
  const { contentPlan, productionBible } = useWorkspaceEpisodeStageData()
  const assetsQuery = useAssets({ scope: 'project', projectId })
  const meta = useMemo(() => readVisualArtifactMeta(productionBible), [productionBible])
  const contentMeta = useMemo(() => readContentArtifactMeta(contentPlan), [contentPlan])
  const assets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
  const readiness = useMemo(
    () => resolveVisualAnchorReadiness(meta?.anchors || [], assets),
    [assets, meta?.anchors],
  )
  const missingCoreNames = useMemo(
    () => new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' })
      .format(readiness.missingCoreItems.map((item) => item.anchor.name)),
    [locale, readiness.missingCoreItems],
  )

  const openAsset = (anchor: VisualAnchor) => {
    if (anchor.assetKind === 'character') {
      runtime.onOpenAssetLibraryForCharacter(anchor.assetId, false)
      return
    }
    runtime.onOpenAssetLibrary()
  }

  if (!meta?.plan) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-5 py-10 text-center">
        <AppIcon name="clapperboard" className="h-9 w-9 text-[var(--glass-text-tertiary)]" />
        <h2 className="mt-3 text-base font-semibold text-[var(--glass-text-primary)]">{t('planEmptyTitle')}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('planEmptyDescription')}</p>
      </div>
    )
  }

  if (readiness.items.length === 0) {
    const confirmedEmpty = contentMeta?.assetRequirements.status === 'approved'
      && contentMeta.assetRequirements.assetIds.length === 0
    return (
      <div className="flex min-h-64 flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-5 py-10 text-center">
        <AppIcon name={confirmedEmpty ? 'check' : 'folderCards'} className={`h-9 w-9 ${confirmedEmpty ? 'text-[var(--glass-tone-success-fg)]' : 'text-[var(--glass-text-tertiary)]'}`} />
        <h2 className="mt-3 text-base font-semibold text-[var(--glass-text-primary)]">{confirmedEmpty ? t('confirmedEmptyTitle') : t('emptyTitle')}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">{confirmedEmpty ? t('confirmedEmptyDescription') : t('emptyDescription')}</p>
      </div>
    )
  }

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center gap-5 border-y border-[var(--glass-stroke-base)] px-1 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="font-semibold text-[var(--glass-text-primary)]">{t('total', { count: readiness.items.length })}</span>
          <span className="text-[var(--glass-tone-success-fg)]">{t('confirmed', { count: readiness.confirmedCount })}</span>
          <span className={readiness.missingCoreItems.length > 0 ? 'text-[var(--glass-tone-warning-fg)]' : 'text-[var(--glass-text-secondary)]'}>
            {t('corePending', { count: readiness.missingCoreItems.length })}
          </span>
        </div>
      </div>

      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('coreTitle')}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--glass-text-secondary)]">{t('coreDescription')}</p>
        </div>
        {readiness.coreItems.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {readiness.coreItems.map((item) => (
              <AnchorItem key={item.anchor.id} item={item} onOpen={() => openAsset(item.anchor)} />
            ))}
          </div>
        ) : (
          <p className="rounded-md bg-[var(--glass-bg-muted)] px-3 py-4 text-sm text-[var(--glass-text-secondary)]">{t('noCore')}</p>
        )}
      </div>

      {readiness.supportingItems.length > 0 ? (
        <details className="group border-t border-[var(--glass-stroke-base)] pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--glass-text-primary)]">
            <span>{t('supportingTitle', { count: readiness.supportingItems.length })}</span>
            <AppIcon name="chevronDown" className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {readiness.supportingItems.map((item) => (
              <AnchorItem key={item.anchor.id} item={item} onOpen={() => openAsset(item.anchor)} />
            ))}
          </div>
        </details>
      ) : null}

      {readiness.missingCoreItems.length > 0 ? (
        <div className="flex gap-3 rounded-md bg-[var(--glass-tone-warning-bg)] px-3 py-3 text-sm text-[var(--glass-tone-warning-fg)]">
          <AppIcon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t('gateTitle')}</p>
            <p className="mt-1 leading-5">{t('gateDescription', { names: missingCoreNames })}</p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function AnchorItem({
  item,
  onOpen,
}: {
  item: ReturnType<typeof resolveVisualAnchorReadiness>['items'][number]
  onOpen: () => void
}) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.visualAnchors')
  const icon = KIND_ICON[item.anchor.semanticKind]
  return (
    <article className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-3">
      <div className="flex gap-3">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
          {item.imageUrl ? (
            <Image src={item.imageUrl} alt={item.anchor.name} fill sizes="80px" className="object-cover" unoptimized />
          ) : (
            <AppIcon name={icon} className="h-6 w-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-[var(--glass-text-primary)]">{item.anchor.name}</h3>
            <span className="rounded-md bg-[var(--glass-bg-muted)] px-2 py-0.5 text-[11px] text-[var(--glass-text-tertiary)]">{t(`kind.${item.anchor.semanticKind}`)}</span>
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${item.status === 'confirmed'
              ? 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
              : item.status === 'failed'
                ? 'bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]'
                : item.status === 'running'
                  ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
                  : 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
            }`}>{t(`status.${item.status}`)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--glass-text-secondary)]">{item.anchor.description || t('noDescription')}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--glass-text-tertiary)]">{t('sourceCount', { count: item.anchor.sourceUnitIds.length })}</span>
            <button type="button" onClick={onOpen} className="glass-btn-base glass-btn-secondary h-8 px-2.5 text-xs">
              <AppIcon name={item.status === 'confirmed' ? 'eye' : item.status === 'candidate' ? 'check' : 'imageEdit'} className="h-3.5 w-3.5" />
              {item.status === 'confirmed' ? t('viewFinal') : item.status === 'candidate' ? t('selectFinal') : t('createImage')}
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

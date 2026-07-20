'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import { readContentArtifactMeta } from '@/lib/creation-workspace/artifact-state'
import {
  resolveVisualAssetStatus,
  selectedVisualAssetImage,
  type WorkspaceVisualAssetStatus,
} from '@/lib/creation-workspace/visual-readiness'
import { useAssetActions, useAssets } from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'

type AssetRequirementStatus = WorkspaceVisualAssetStatus

interface AssetKindMeta {
  icon: AppIconName
  labelKey: 'character' | 'location' | 'prop'
  descriptionField: 'introduction' | 'summary'
}

const ASSET_KIND_META: Record<VisualAssetSummary['kind'], AssetKindMeta> = {
  character: { icon: 'user', labelKey: 'character', descriptionField: 'introduction' },
  location: { icon: 'imageLandscape', labelKey: 'location', descriptionField: 'summary' },
  prop: { icon: 'package', labelKey: 'prop', descriptionField: 'summary' },
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function collectVisualHints(contentPlan: unknown) {
  const plan = asRecord(contentPlan)
  const segments = Array.isArray(plan?.segments) ? plan.segments : []
  const hints = new Set<string>()
  for (const rawSegment of segments) {
    const segment = asRecord(rawSegment)
    if (!segment || !Array.isArray(segment.visualHints)) continue
    for (const hint of segment.visualHints) {
      if (typeof hint === 'string' && hint.trim()) hints.add(hint.trim())
    }
  }
  return [...hints].slice(0, 12)
}

function resolveStatus(asset: VisualAssetSummary): AssetRequirementStatus {
  return resolveVisualAssetStatus(asset)
}

function assetDescription(asset: VisualAssetSummary) {
  if (asset.kind === 'character') return asset.introduction || asset.variants[0]?.description || ''
  return asset.summary || asset.variants[0]?.description || ''
}

export default function ContentAssetRequirements() {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.assetRequirements')
  const { projectId } = useWorkspaceProvider()
  const runtime = useWorkspaceStageRuntime()
  const { contentPlan } = useWorkspaceEpisodeStageData()
  const assetsQuery = useAssets({ scope: 'project', projectId })
  const characterActions = useAssetActions({ scope: 'project', projectId, kind: 'character' })
  const locationActions = useAssetActions({ scope: 'project', projectId, kind: 'location' })
  const propActions = useAssetActions({ scope: 'project', projectId, kind: 'prop' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')

  const contentMeta = useMemo(() => readContentArtifactMeta(contentPlan), [contentPlan])
  const requirementState = contentMeta?.assetRequirements
  const requirementStatus = requirementState?.status || 'not_started'
  const requirementAssetIds = useMemo(
    () => new Set(requirementState?.assetIds || []),
    [requirementState?.assetIds],
  )
  const assets = useMemo(() => {
    const visualAssets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
    return visualAssets.filter((asset) => requirementAssetIds.has(asset.id))
  }, [assetsQuery.data, requirementAssetIds])
  const hints = useMemo(() => collectVisualHints(contentPlan), [contentPlan])
  const confirmedCount = assets.filter((asset) => resolveStatus(asset) === 'confirmed').length
  const attentionCount = assets.filter((asset) => ['failed', 'candidate', 'missing'].includes(resolveStatus(asset))).length

  const beginEdit = (asset: VisualAssetSummary) => {
    setEditingId(asset.id)
    setDraftName(asset.name)
    setDraftDescription(assetDescription(asset))
    setSaveError('')
  }

  const saveAsset = async (asset: VisualAssetSummary) => {
    const meta = ASSET_KIND_META[asset.kind]
    const actions = asset.kind === 'character'
      ? characterActions
      : asset.kind === 'location'
        ? locationActions
        : propActions
    setSavingId(asset.id)
    setSaveError('')
    try {
      await actions.update(asset.id, {
        name: draftName.trim(),
        [meta.descriptionField]: draftDescription.trim(),
      })
      setEditingId(null)
    } catch {
      setSaveError(t('saveFailed'))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="min-w-0 space-y-4">
      {requirementStatus !== 'not_started' ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-y border-[var(--glass-stroke-base)] px-1 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="font-semibold text-[var(--glass-text-primary)]">{t('summary', { count: requirementState?.assetIds.length || 0 })}</span>
            <span className="text-[var(--glass-tone-success-fg)]">{t('confirmedCount', { count: confirmedCount })}</span>
            <span className="text-[var(--glass-text-secondary)]">{t('attentionCount', { count: attentionCount })}</span>
          </div>
          <button
            type="button"
            onClick={() => { void runtime.onAnalyzeAssets() }}
            disabled={runtime.isAssetAnalysisRunning}
            className="glass-btn-base glass-btn-secondary h-9 px-3 text-xs"
          >
            <AppIcon name={runtime.isAssetAnalysisRunning ? 'loader' : 'refresh'} className={`h-3.5 w-3.5 ${runtime.isAssetAnalysisRunning ? 'animate-spin' : ''}`} />
            {runtime.isAssetAnalysisRunning ? t('analyzing') : t('reanalyze')}
          </button>
        </div>
      ) : null}

      <div className="border-b border-[var(--glass-stroke-base)] pb-4">
        <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--glass-text-secondary)]">{t('description')}</p>
        {hints.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {hints.map((hint) => (
              <span key={hint} className="rounded-md bg-[var(--glass-bg-muted)] px-2 py-1 text-xs text-[var(--glass-text-secondary)]">{hint}</span>
            ))}
          </div>
        ) : null}
      </div>

      {requirementStatus === 'stale' ? (
        <div className="flex gap-3 rounded-md bg-[var(--glass-tone-warning-bg)] px-3 py-3 text-sm text-[var(--glass-tone-warning-fg)]">
          <AppIcon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t('staleTitle')}</p>
            <p className="mt-1 leading-5">{t('staleDescription')}</p>
          </div>
        </div>
      ) : requirementStatus === 'needs_review' ? (
        <div className="flex gap-3 rounded-md bg-[var(--glass-tone-info-bg)] px-3 py-3 text-sm text-[var(--glass-tone-info-fg)]">
          <AppIcon name="clipboardCheck" className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t('reviewTitle')}</p>
            <p className="mt-1 leading-5">{t('reviewDescription')}</p>
          </div>
        </div>
      ) : requirementStatus === 'approved' ? (
        <div className="flex gap-3 rounded-md bg-[var(--glass-tone-success-bg)] px-3 py-3 text-sm text-[var(--glass-tone-success-fg)]">
          <AppIcon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-semibold">{t('approvedDescription')}</p>
        </div>
      ) : null}

      {runtime.isAssetAnalysisRunning ? (
        <div className="flex min-h-60 flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-5 py-10 text-center">
          <AppIcon name="loader" className="h-9 w-9 animate-spin text-[var(--glass-tone-info-fg)]" />
          <h3 className="mt-3 text-base font-semibold text-[var(--glass-text-primary)]">{t('analyzingTitle')}</h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('analyzingDescription')}</p>
        </div>
      ) : assetsQuery.isLoading && requirementStatus !== 'not_started' ? (
        <div className="flex min-h-52 items-center justify-center text-sm text-[var(--glass-text-tertiary)]">
          <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />
          {t('loading')}
        </div>
      ) : assets.length === 0 ? (
        <div className="flex min-h-60 flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-5 py-10 text-center">
          <AppIcon name={requirementStatus === 'not_started' ? 'folderCards' : 'check'} className={`h-9 w-9 ${requirementStatus === 'not_started' ? 'text-[var(--glass-text-tertiary)]' : 'text-[var(--glass-tone-success-fg)]'}`} />
          <h3 className="mt-3 text-base font-semibold text-[var(--glass-text-primary)]">
            {requirementStatus === 'not_started'
              ? t('emptyTitle')
              : requirementStatus === 'approved'
                ? t('approvedEmptyTitle')
                : requirementStatus === 'stale'
                  ? t('staleEmptyTitle')
                  : t('analyzedEmptyTitle')}
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">
            {requirementStatus === 'not_started'
              ? t('emptyDescription')
              : requirementStatus === 'approved'
                ? t('approvedEmptyDescription')
                : requirementStatus === 'stale'
                  ? t('staleDescription')
                  : t('analyzedEmptyDescription')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((asset) => {
            const meta = ASSET_KIND_META[asset.kind]
            const imageUrl = selectedVisualAssetImage(asset)
            const status = resolveStatus(asset)
            const editing = editingId === asset.id
            return (
              <article key={asset.id} className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-3">
                <div className="flex gap-3">
                  <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
                    {imageUrl ? (
                      <Image src={imageUrl} alt={asset.name} fill sizes="64px" className="object-cover" unoptimized />
                    ) : (
                      <AppIcon name={meta.icon} className="h-5 w-5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="space-y-2">
                        <input
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          aria-label={t('nameLabel')}
                          className="h-9 w-full rounded-md border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 text-sm font-semibold text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
                        />
                        <textarea
                          value={draftDescription}
                          onChange={(event) => setDraftDescription(event.target.value)}
                          aria-label={t('descriptionLabel')}
                          rows={3}
                          className="w-full resize-y rounded-md border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm leading-5 text-[var(--glass-text-secondary)] outline-none focus:border-[var(--glass-stroke-focus)]"
                        />
                        {saveError ? <p className="text-xs text-[var(--glass-tone-danger-fg)]">{saveError}</p> : null}
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingId(null)} className="glass-btn-base glass-btn-secondary h-8 px-3 text-xs">{t('cancel')}</button>
                          <button
                            type="button"
                            onClick={() => { void saveAsset(asset) }}
                            disabled={!draftName.trim() || savingId === asset.id}
                            className="glass-btn-base glass-btn-primary h-8 px-3 text-xs"
                          >
                            <AppIcon name={savingId === asset.id ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${savingId === asset.id ? 'animate-spin' : ''}`} />
                            {t('save')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold text-[var(--glass-text-primary)]">{asset.name}</h3>
                              <span className="rounded-md bg-[var(--glass-bg-muted)] px-2 py-0.5 text-[11px] text-[var(--glass-text-tertiary)]">{t(`kind.${meta.labelKey}`)}</span>
                              <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${status === 'confirmed'
                                ? 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
                                : status === 'failed'
                                  ? 'bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]'
                                  : status === 'running'
                                    ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
                                    : 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
                              }`}>{t(`status.${status}`)}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--glass-text-secondary)]">{assetDescription(asset) || t('noDescription')}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => beginEdit(asset)}
                            disabled={requirementStatus === 'stale'}
                            className="glass-btn-base glass-btn-secondary h-8 w-8 shrink-0 p-0 disabled:cursor-not-allowed disabled:opacity-50"
                            title={requirementStatus === 'stale' ? t('editStaleDisabled') : t('edit')}
                          >
                            <AppIcon name="edit" className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--glass-text-tertiary)]">
                          <AppIcon name="link" className="h-3.5 w-3.5" />
                          {asset.kind === 'character' ? t('consistencyRequired') : t('reusableVisual')}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="border-t border-[var(--glass-stroke-base)] pt-4">
        <p className="text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('boundaryHint')}</p>
      </div>
    </section>
  )
}

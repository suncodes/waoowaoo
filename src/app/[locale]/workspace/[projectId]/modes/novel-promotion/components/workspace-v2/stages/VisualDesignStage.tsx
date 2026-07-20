'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import { readVisualArtifactMeta } from '@/lib/creation-workspace/artifact-state'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { resolveVisualAnchorReadiness } from '@/lib/creation-workspace/visual-readiness'
import { useAssets } from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'
import AssetsStage from '../../AssetsStage'
import VisualPlanStage from '../../VisualPlanStage'
import VisualAnchorBoard from '../artifacts/VisualAnchorBoard'

interface VisualDesignStageProps {
  stageView?: string
  workflowState: CreationWorkflowState
}

export default function VisualDesignStage({ stageView, workflowState }: VisualDesignStageProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.views.visualDesign')
  const { projectId } = useWorkspaceProvider()
  const runtime = useWorkspaceStageRuntime()
  const { productionBible } = useWorkspaceEpisodeStageData()
  const assetsQuery = useAssets({ scope: 'project', projectId })
  const visualAssets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
  const visualMeta = useMemo(() => readVisualArtifactMeta(productionBible), [productionBible])
  const readiness = useMemo(
    () => resolveVisualAnchorReadiness(visualMeta?.anchors || [], visualAssets),
    [visualAssets, visualMeta?.anchors],
  )
  const confirmedAssets = readiness.confirmedCount
  const runningAssets = visualAssets.filter((asset) => asset.taskState.isRunning || asset.variants.some((variant) => variant.taskState.isRunning)).length
  const pendingAssets = readiness.missingCoreItems.length
  const currentView = stageView === 'assets' ? 'assets' : 'direction'
  const showCoreAssetGate = currentView === 'direction'
    && !!visualMeta?.plan
    && visualMeta.status !== 'approved'
    && visualMeta.status !== 'stale'
    && readiness.missingCoreItems.length > 0
  const options = useMemo(() => [
    { value: 'direction' as const, label: t('direction') },
    { value: 'assets' as const, label: t('assets') },
  ], [t])

  return (
    <section className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-[var(--glass-stroke-base)] px-1 py-3 text-sm">
        <span className="font-semibold text-[var(--glass-text-primary)]">{t('summary.total', { count: readiness.items.length })}</span>
        <span className="text-[var(--glass-tone-success-fg)]">{t('summary.confirmed', { count: confirmedAssets })}</span>
        <span className="text-[var(--glass-tone-info-fg)]">{t('summary.running', { count: runningAssets })}</span>
        <span className="text-[var(--glass-text-secondary)]">{t('summary.pending', { count: pendingAssets })}</span>
      </div>
      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          options={options}
          value={currentView}
          onChange={(value) => runtime.onStageChange(value === 'assets' ? 'assets' : 'visual-plan')}
          layout="compact"
        />
      </div>
      {showCoreAssetGate ? (
        <div className="mb-4 flex flex-col gap-3 border-y border-[var(--glass-stroke-warning)] bg-[var(--glass-tone-warning-bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('coreGate.title')}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--glass-text-secondary)]">
              {t('coreGate.description', { count: readiness.missingCoreItems.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => runtime.onStageChange('assets')}
            className="glass-btn-base glass-btn-secondary h-10 shrink-0 px-4 text-sm"
          >
            {t('coreGate.action')}
          </button>
        </div>
      ) : null}
      {currentView === 'assets' ? (
        <div className="space-y-6">
          <VisualAnchorBoard />
          <details className="group border-t border-[var(--glass-stroke-base)] pt-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--glass-text-primary)]">
              <span>{t('detailedAssets')}</span>
              <span className="text-xs font-normal text-[var(--glass-text-tertiary)]">{t('detailedAssetsHint')}</span>
            </summary>
            <div className="mt-4">
              <AssetsStage
                projectId={projectId}
                isAnalyzingAssets={runtime.isAssetAnalysisRunning}
              />
            </div>
          </details>
        </div>
      ) : <VisualPlanStage workflowState={workflowState} />}
    </section>
  )
}

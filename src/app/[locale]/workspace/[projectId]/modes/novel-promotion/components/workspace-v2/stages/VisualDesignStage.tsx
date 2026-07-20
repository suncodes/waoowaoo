'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { AppIcon } from '@/components/ui/icons'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import { useAssets } from '@/lib/query/hooks'
import { isBookGuideProfile } from '@/lib/video-profile'
import { useWorkspaceProvider } from '../../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import AssetsStage from '../../AssetsStage'
import VisualPlanStage from '../../VisualPlanStage'

interface VisualDesignStageProps {
  stageView?: string
}

export default function VisualDesignStage({ stageView }: VisualDesignStageProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.views.visualDesign')
  const { projectId } = useWorkspaceProvider()
  const runtime = useWorkspaceStageRuntime()
  const isBookGuide = isBookGuideProfile(runtime.videoProfile)
  const assetsQuery = useAssets({ scope: 'project', projectId })
  const visualAssets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
  const confirmedAssets = visualAssets.filter((asset) => asset.variants.some((variant) => variant.renders.some((render) => render.isSelected))).length
  const runningAssets = visualAssets.filter((asset) => asset.taskState.isRunning || asset.variants.some((variant) => variant.taskState.isRunning)).length
  const pendingAssets = Math.max(0, visualAssets.length - confirmedAssets - runningAssets)
  const currentView = stageView === 'assets' ? 'assets' : 'direction'
  const options = useMemo(() => [
    { value: 'direction' as const, label: t('direction') },
    { value: 'assets' as const, label: t('assets') },
  ], [t])

  return (
    <section className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-[var(--glass-stroke-base)] px-1 py-3 text-sm">
        <span className="font-semibold text-[var(--glass-text-primary)]">{t('summary.total', { count: visualAssets.length })}</span>
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
      {currentView === 'assets' ? (
        <div className="space-y-4">
          <div className="border-b border-[var(--glass-stroke-base)] pb-4">
            <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('assetsTitle')}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--glass-text-secondary)]">{t('assetsDescription')}</p>
          </div>
          <AssetsStage
            projectId={projectId}
            isAnalyzingAssets={runtime.isAssetAnalysisRunning}
          />
        </div>
      ) : <VisualPlanStage />}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--glass-stroke-base)] pt-4">
        <p className="text-xs leading-5 text-[var(--glass-text-tertiary)]">{t(isBookGuide ? 'guideStoryboardHint' : 'storyboardHint')}</p>
        <button
          type="button"
          onClick={() => { void (isBookGuide ? runtime.onRunVisualPlan() : runtime.onRunScriptToStoryboard()) }}
          disabled={isBookGuide
            ? runtime.isTransitioning
            : runtime.isConfirmingAssets || runtime.isStartingScriptToStoryboard}
          className="glass-btn-base glass-btn-primary h-10 px-4 text-sm"
        >
          <AppIcon
            name={(isBookGuide ? runtime.isTransitioning : runtime.isConfirmingAssets || runtime.isStartingScriptToStoryboard) ? 'loader' : 'clapperboard'}
            className={`h-4 w-4 ${(isBookGuide ? runtime.isTransitioning : runtime.isConfirmingAssets || runtime.isStartingScriptToStoryboard) ? 'animate-spin' : ''}`}
          />
          {isBookGuide
            ? (runtime.isTransitioning ? t('guideStoryboardRunning') : t('guideStoryboardAction'))
            : (runtime.isConfirmingAssets || runtime.isStartingScriptToStoryboard ? t('storyboardRunning') : t('storyboardAction'))}
        </button>
      </div>
    </section>
  )
}

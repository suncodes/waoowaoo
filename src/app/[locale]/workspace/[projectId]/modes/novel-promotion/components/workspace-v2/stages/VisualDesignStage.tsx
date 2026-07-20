'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
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
  const currentView = stageView === 'assets' ? 'assets' : 'direction'
  const options = useMemo(() => [
    { value: 'direction' as const, label: t('direction') },
    { value: 'assets' as const, label: t('assets') },
  ], [t])

  return (
    <section className="min-w-0">
      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          options={options}
          value={currentView}
          onChange={(value) => runtime.onStageChange(value === 'assets' ? 'assets' : 'visual-plan')}
          layout="compact"
        />
      </div>
      {currentView === 'assets' ? (
        <AssetsStage
          projectId={projectId}
          isAnalyzingAssets={runtime.isAssetAnalysisRunning}
        />
      ) : <VisualPlanStage />}
    </section>
  )
}

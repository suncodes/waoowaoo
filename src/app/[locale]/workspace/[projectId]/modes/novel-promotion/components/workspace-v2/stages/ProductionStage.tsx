'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import VideoStageRoute from '../../VideoStageRoute'
import VoiceStageRoute from '../../VoiceStageRoute'

interface ProductionStageProps {
  stageView?: string
}

export default function ProductionStage({ stageView }: ProductionStageProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.views.production')
  const runtime = useWorkspaceStageRuntime()
  const currentView = stageView === 'voice' ? 'voice' : 'shots'
  const options = useMemo(() => [
    { value: 'shots' as const, label: t('shots') },
    { value: 'voice' as const, label: t('voice') },
  ], [t])

  return (
    <section className="min-w-0">
      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          options={options}
          value={currentView}
          onChange={(value) => runtime.onStageChange(value === 'voice' ? 'voice' : 'videos')}
          layout="compact"
        />
      </div>
      {currentView === 'voice' ? <VoiceStageRoute /> : <VideoStageRoute />}
    </section>
  )
}

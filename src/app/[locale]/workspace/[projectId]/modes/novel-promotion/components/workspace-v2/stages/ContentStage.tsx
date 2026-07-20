'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { isBookGuideProfile } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import ContentPlanStage from '../../ContentPlanStage'
import ScriptStage from '../../ScriptStage'

interface ContentStageProps {
  stageView?: string
}

export default function ContentStage({ stageView }: ContentStageProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.views.content')
  const runtime = useWorkspaceStageRuntime()
  const currentView = stageView === 'script' ? 'script' : 'plan'
  const isBookGuide = isBookGuideProfile(runtime.videoProfile)
  const options = useMemo(() => [
    { value: 'plan' as const, label: t('plan') },
    { value: 'script' as const, label: isBookGuide ? t('guideScript') : t('script') },
  ], [isBookGuide, t])

  return (
    <section className="min-w-0">
      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          options={options}
          value={currentView}
          onChange={(value) => runtime.onStageChange(value === 'plan' ? 'content-plan' : 'script')}
          layout="compact"
        />
      </div>
      {currentView === 'plan' ? <ContentPlanStage /> : <ScriptStage />}
    </section>
  )
}

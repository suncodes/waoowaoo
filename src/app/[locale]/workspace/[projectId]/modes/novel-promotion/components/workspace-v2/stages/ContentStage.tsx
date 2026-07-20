'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { isBookGuideProfile } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import ContentPlanStage from '../../ContentPlanStage'
import ContentAssetRequirements from '../artifacts/ContentAssetRequirements'
import ContentScriptEditor from '../artifacts/ContentScriptEditor'
import GuideNarrationEditor from '../artifacts/GuideNarrationEditor'

interface ContentStageProps {
  stageView?: string
}

export default function ContentStage({ stageView }: ContentStageProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.views.content')
  const runtime = useWorkspaceStageRuntime()
  const currentView = stageView === 'script' || stageView === 'assets' ? stageView : 'plan'
  const isBookGuide = isBookGuideProfile(runtime.videoProfile)
  const options = useMemo(() => [
    { value: 'plan' as const, label: t('plan') },
    { value: 'script' as const, label: isBookGuide ? t('guideScript') : t('script') },
    { value: 'assets' as const, label: isBookGuide ? t('guideAssets') : t('assets') },
  ], [isBookGuide, t])

  return (
    <section className="min-w-0">
      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          options={options}
          value={currentView}
          onChange={(value) => runtime.onStageChange(value === 'plan'
            ? 'content-plan'
            : value === 'script'
              ? 'script'
              : 'content-assets')}
          layout="compact"
        />
      </div>
      {currentView === 'plan' ? <ContentPlanStage /> : null}
      {currentView === 'script' ? (isBookGuide ? <GuideNarrationEditor /> : <ContentScriptEditor />) : null}
      {currentView === 'assets' ? <ContentAssetRequirements /> : null}
    </section>
  )
}

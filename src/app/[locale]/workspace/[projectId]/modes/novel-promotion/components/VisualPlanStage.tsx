'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { isBookGuideProfile } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import {
  PlanningDefinitionGrid,
  PlanningEmptyState,
  PlanningSection,
  PlanningStageBody,
  PlanningStageFrame,
  PlanningStageHeader,
  PlanningTagList,
} from './planning/PlanningStagePrimitives'
import {
  asPlanningRecord,
  readPlanningString,
  readPlanningStrings,
} from './planning/planning-data'

type VisualPlanTab = 'treatment' | 'bible'

export default function VisualPlanStage() {
  const t = useTranslations('novelPromotion.workspaceFlow.visualPlan')
  const runtime = useWorkspaceStageRuntime()
  const { directorTreatment, productionBible } = useWorkspaceEpisodeStageData()
  const [tab, setTab] = useState<VisualPlanTab>('treatment')
  const treatment = asPlanningRecord(directorTreatment)
  const bible = asPlanningRecord(productionBible)
  const hasPlan = !!treatment && !!bible
  const isBookGuide = isBookGuideProfile(runtime.videoProfile)
  const tabs = useMemo(() => [
    { value: 'treatment' as const, label: t('tabs.treatment') },
    { value: 'bible' as const, label: t('tabs.bible') },
  ], [t])

  if (!hasPlan) {
    return (
      <PlanningStageFrame>
        <PlanningEmptyState
          icon="clapperboard"
          title={t('empty.title')}
          description={t('empty.description')}
          actionLabel={t('empty.action')}
          onAction={() => runtime.onStageChange('script')}
        />
      </PlanningStageFrame>
    )
  }

  return (
    <PlanningStageFrame>
      <PlanningStageHeader
        icon="clapperboard"
        title={isBookGuide ? t('titleGuide') : t('titleNarrative')}
        statusLabel={t('status.ready')}
        statusTone="success"
      />
      <div className="border-b border-[var(--glass-stroke-base)] px-5 py-3">
        <SegmentedControl options={tabs} value={tab} onChange={setTab} layout="compact" />
      </div>
      <PlanningStageBody>
        {tab === 'treatment' ? (
          <div className="space-y-6">
            <PlanningSection title={t('treatmentOverview')}>
              <PlanningDefinitionGrid items={[
                { label: t('fields.narrativeStrategy'), value: readPlanningString(treatment.narrativeStrategy, '-') },
                { label: t('fields.pacing'), value: readPlanningString(treatment.pacing, '-') },
                { label: t('fields.cameraLanguage'), value: readPlanningString(treatment.cameraLanguage, '-') },
                { label: t('fields.transitionStrategy'), value: readPlanningString(treatment.transitionStrategy, '-') },
                { label: t('fields.soundStrategy'), value: readPlanningString(treatment.soundStrategy, '-') },
              ]} />
            </PlanningSection>
          </div>
        ) : null}

        {tab === 'bible' ? (
          <div className="space-y-6">
            <PlanningSection title={t('visualBaseline')}>
              <PlanningDefinitionGrid items={[
                { label: t('fields.visualStyle'), value: readPlanningString(bible.visualStyle, '-') },
                { label: t('fields.lightingBaseline'), value: readPlanningString(bible.lightingBaseline, '-') },
                { label: t('fields.colorGrade'), value: readPlanningString(bible.colorGrade, '-') },
              ]} />
            </PlanningSection>
            <PlanningSection title={t('fields.compositionRules')}>
              <PlanningTagList items={readPlanningStrings(bible.compositionRules)} emptyLabel={t('emptyValue')} />
            </PlanningSection>
            <PlanningSection title={t('fields.continuityRules')}>
              <PlanningTagList items={readPlanningStrings(bible.continuityRules)} emptyLabel={t('emptyValue')} />
            </PlanningSection>
            <PlanningSection title={t('fields.forbiddenPatterns')}>
              <PlanningTagList items={readPlanningStrings(bible.forbiddenPatterns)} emptyLabel={t('emptyValue')} />
            </PlanningSection>
          </div>
        ) : null}
      </PlanningStageBody>
    </PlanningStageFrame>
  )
}

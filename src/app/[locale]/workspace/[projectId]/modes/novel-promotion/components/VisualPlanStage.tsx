'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import {
  readContentArtifactMeta,
  readVisualArtifactMeta,
} from '@/lib/creation-workspace/artifact-state'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { isBookGuideProfile } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import StageGenerationPanel from './workspace-v2/StageGenerationPanel'
import {
  PlanningDefinitionGrid,
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

export default function VisualPlanStage({
  workflowState,
}: {
  workflowState?: CreationWorkflowState
} = {}) {
  const t = useTranslations('novelPromotion.workspaceFlow.visualPlan')
  const runtime = useWorkspaceStageRuntime()
  const { contentPlan, directorTreatment, productionBible } = useWorkspaceEpisodeStageData()
  const [tab, setTab] = useState<VisualPlanTab>('treatment')
  const treatment = asPlanningRecord(directorTreatment)
  const bible = asPlanningRecord(productionBible)
  const contentMeta = useMemo(() => readContentArtifactMeta(contentPlan), [contentPlan])
  const visualMeta = useMemo(() => readVisualArtifactMeta(productionBible), [productionBible])
  const hasPlan = !!treatment && !!bible
  const isBookGuide = isBookGuideProfile(runtime.videoProfile)
  const activeTask = workflowState?.activeTarget?.kind === 'visual_plan'
    ? workflowState.activeTarget
    : null
  const stageStatus = workflowState?.stages['visual-design'].status
  const missingAnchors = !!visualMeta?.plan
    && visualMeta.anchors.length === 0
    && (contentMeta?.assetRequirements.assetIds.length || 0) > 0
  const planStale = visualMeta?.status === 'stale' || stageStatus === 'stale'
  const planFailed = stageStatus === 'failed'
  const tabs = useMemo(() => [
    { value: 'treatment' as const, label: t('tabs.treatment') },
    { value: 'bible' as const, label: t('tabs.bible') },
  ], [t])

  if (!hasPlan) {
    const running = !!activeTask
    const failed = planFailed && !running
    return (
      <PlanningStageFrame>
        <StageGenerationPanel
          icon={failed ? 'alert' : 'clapperboard'}
          tone={failed ? 'danger' : 'neutral'}
          title={running ? t('generation.runningTitle') : failed ? t('generation.failedTitle') : t('empty.title')}
          description={activeTask?.message || (failed ? t('generation.failedDescription') : t('empty.description'))}
          actionLabel={failed ? t('generation.retryAction') : t('empty.action')}
          runningLabel={t('generation.runningAction')}
          onAction={runtime.onRunVisualPlan}
          isRunning={running}
          progress={activeTask?.progress}
          errorFallback={t('generation.actionFailed')}
        />
      </PlanningStageFrame>
    )
  }

  const notice = activeTask
    ? {
        tone: 'neutral' as const,
        icon: 'loader' as const,
        title: t('generation.updatingTitle'),
        description: activeTask.message || t('generation.updatingDescription'),
        actionLabel: t('generation.runningAction'),
        running: true,
      }
    : planFailed
      ? {
          tone: 'danger' as const,
          icon: 'alert' as const,
          title: t('generation.failedTitle'),
          description: t('generation.failedDescription'),
          actionLabel: t('generation.retryAction'),
          running: false,
        }
      : planStale
        ? {
            tone: 'warning' as const,
            icon: 'refresh' as const,
            title: t('generation.staleTitle'),
            description: t('generation.staleDescription'),
            actionLabel: t('generation.refreshAction'),
            running: false,
          }
        : missingAnchors
          ? {
              tone: 'warning' as const,
              icon: 'link' as const,
              title: t('generation.missingAnchorsTitle'),
              description: t('generation.missingAnchorsDescription'),
              actionLabel: t('generation.refreshAction'),
              running: false,
            }
          : null

  const statusLabel = activeTask
    ? t('status.updating')
    : planFailed
      ? t('status.failed')
      : planStale || missingAnchors
        ? t('status.stale')
        : t('status.ready')
  const statusTone = planFailed
    ? 'danger' as const
    : planStale || missingAnchors
      ? 'warning' as const
      : activeTask
        ? 'info' as const
        : 'success' as const

  return (
    <PlanningStageFrame>
      {notice ? (
        <StageGenerationPanel
          variant="notice"
          tone={notice.tone}
          icon={notice.icon}
          title={notice.title}
          description={notice.description}
          actionLabel={notice.actionLabel}
          runningLabel={t('generation.runningAction')}
          actionIcon={notice.icon === 'refresh' ? 'refresh' : 'sparkles'}
          onAction={runtime.onRunVisualPlan}
          isRunning={notice.running}
          progress={activeTask?.progress}
          errorFallback={t('generation.actionFailed')}
        />
      ) : null}
      <PlanningStageHeader
        icon="clapperboard"
        title={isBookGuide ? t('titleGuide') : t('titleNarrative')}
        statusLabel={statusLabel}
        statusTone={statusTone}
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

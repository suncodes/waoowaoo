'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { isBookGuideProfile, type VideoProfile } from '@/lib/video-profile'
import type { CreationStageId } from '@/lib/creation-workspace/stages'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import type { CreationStageNavItem } from '../../hooks/useCreationStageNavigation'
import { useCreationWorkspaceAutoFollow } from '../../hooks/useCreationWorkspaceAutoFollow'
import type { WorkspaceRunStreamState } from '../workspace-run-types'
import CreationAssistantPanel from './CreationAssistantPanel'
import CreationStageActionBar from './CreationStageActionBar'
import CreationStageContent from './CreationStageContent'
import CreationStageHeader from './CreationStageHeader'
import CreationWorkflowRail from './CreationWorkflowRail'

interface CreationWorkspaceShellProps {
  items: CreationStageNavItem[]
  currentStage: CreationStageId
  stageView?: string
  projectId: string
  episodeId?: string
  videoProfile: VideoProfile
  workflowState: CreationWorkflowState
  onStageChange: (stage: string) => void
  contentPlanStream: WorkspaceRunStreamState
  storyToScriptStream: WorkspaceRunStreamState
  visualPlanStream: WorkspaceRunStreamState
  scriptToStoryboardStream: WorkspaceRunStreamState
  children?: ReactNode
}

export default function CreationWorkspaceShell({
  items,
  currentStage,
  stageView,
  projectId,
  episodeId,
  videoProfile,
  workflowState,
  onStageChange,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
  children,
}: CreationWorkspaceShellProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2')
  const current = items.find((item) => item.id === currentStage) || items[0]
  const currentIndex = Math.max(0, items.findIndex((item) => item.id === current?.id))
  const profileLabel = isBookGuideProfile(videoProfile) ? t('profile.bookGuide') : t('profile.aiComic')

  useCreationWorkspaceAutoFollow({
    currentStage,
    stageView,
    workflowState,
    onStageChange,
  })

  if (!current) return null

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--glass-stroke-base)] px-1 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[var(--glass-text-secondary)]">
          <span className="inline-flex items-center gap-2 font-medium text-[var(--glass-text-primary)]">
            <AppIcon name={isBookGuideProfile(videoProfile) ? 'bookOpen' : 'film'} className="h-4 w-4" />
            {profileLabel}
          </span>
          <span className="inline-flex items-center gap-2">
            <AppIcon name="sparkles" className="h-4 w-4" />
            {t('mode.auto')}
          </span>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-[var(--glass-text-tertiary)]">
          <AppIcon name="check" className="h-3.5 w-3.5 text-[var(--glass-tone-success-fg)]" />
          {t('actionBar.autoSaved')}
        </span>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[232px_minmax(0,1fr)] 2xl:grid-cols-[232px_minmax(0,1fr)_340px]">
        <CreationWorkflowRail
          items={items}
          currentStage={currentStage}
          projectId={projectId}
          episodeId={episodeId}
          onStageChange={onStageChange}
        />

        <main id="workspace-stage-content" className="min-w-0 scroll-mt-32 pb-3">
          <CreationStageHeader item={current} stepNumber={currentIndex + 1} stepTotal={items.length} />
          {current.locked ? (
            <section className="flex min-h-72 flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-5 py-10 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
                <AppIcon name="lock" className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-[var(--glass-text-primary)]">{t('navigation.lockedTitle')}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">
                {t('navigation.lockedDescription', { stage: current.blockedByLabel || '' })}
              </p>
              {current.blockedByStageId ? (
                <button type="button" onClick={() => onStageChange(current.blockedByStageId!)} className="glass-btn-base glass-btn-primary mt-5 h-10 px-4 text-sm">
                  {t('navigation.returnToRequired', { stage: current.blockedByLabel || '' })}
                  <AppIcon name="arrowRight" className="h-4 w-4" />
                </button>
              ) : null}
            </section>
          ) : (
            <>
              {children ?? (
                <CreationStageContent
                  currentStage={currentStage}
                  stageView={stageView}
                  workflowState={workflowState}
                />
              )}
              <CreationStageActionBar
                items={items}
                currentStage={currentStage}
                stageView={stageView}
                workflowState={workflowState}
                onStageChange={onStageChange}
              />
            </>
          )}
        </main>

        <CreationAssistantPanel
          currentStage={currentStage}
          items={items}
          videoProfile={videoProfile}
          contentPlanStream={contentPlanStream}
          storyToScriptStream={storyToScriptStream}
          visualPlanStream={visualPlanStream}
          scriptToStoryboardStream={scriptToStoryboardStream}
        />
      </div>
    </section>
  )
}

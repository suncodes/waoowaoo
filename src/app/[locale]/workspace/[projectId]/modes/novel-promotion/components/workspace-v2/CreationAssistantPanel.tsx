'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { isBookGuideProfile, type VideoProfile } from '@/lib/video-profile'
import type { CreationStageId } from '@/lib/creation-workspace/stages'
import type { CreationStageNavItem } from '../../hooks/useCreationStageNavigation'
import type { WorkspaceRunStreamState } from '../workspace-run-types'
import CreationTaskDetails, {
  isCreationTaskActive,
  type CreationTaskDescriptor,
} from './CreationTaskDetails'

interface CreationAssistantPanelProps {
  currentStage: CreationStageId
  items: CreationStageNavItem[]
  videoProfile: VideoProfile
  contentPlanStream: WorkspaceRunStreamState
  storyToScriptStream: WorkspaceRunStreamState
  visualPlanStream: WorkspaceRunStreamState
  scriptToStoryboardStream: WorkspaceRunStreamState
}

interface StageTaskDescriptor extends CreationTaskDescriptor {
  stageId: CreationStageId
  appliesToBookGuide: boolean
}

function uniqueTasks(tasks: StageTaskDescriptor[]) {
  const seen = new Set<string>()
  return tasks.filter((task) => {
    if (seen.has(task.id)) return false
    seen.add(task.id)
    return true
  })
}

export default function CreationAssistantPanel({
  currentStage,
  items,
  videoProfile,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
}: CreationAssistantPanelProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.assistant')
  const tStatus = useTranslations('novelPromotion.workspaceFlow.status')
  const [mobileOpen, setMobileOpen] = useState(false)
  const isBookGuide = isBookGuideProfile(videoProfile)
  const current = items.find((item) => item.id === currentStage) || items[0]
  const allTasks = useMemo<StageTaskDescriptor[]>(() => [
    {
      id: 'content-plan',
      stageId: 'content',
      label: t('tasks.contentPlan'),
      stream: contentPlanStream,
      appliesToBookGuide: true,
    },
    {
      id: 'story-to-script',
      stageId: 'content',
      label: t('tasks.storyScript'),
      stream: storyToScriptStream,
      appliesToBookGuide: false,
    },
    {
      id: 'visual-plan',
      stageId: 'visual-design',
      label: t('tasks.visualPlan'),
      stream: visualPlanStream,
      appliesToBookGuide: true,
    },
    {
      id: 'script-to-storyboard',
      stageId: 'storyboard-preview',
      label: t('tasks.storyboard'),
      stream: scriptToStoryboardStream,
      appliesToBookGuide: false,
    },
  ], [contentPlanStream, scriptToStoryboardStream, storyToScriptStream, t, visualPlanStream])
  const applicableTasks = allTasks.filter((task) => !isBookGuide || task.appliesToBookGuide)
  const activeTasks = applicableTasks.filter((task) => isCreationTaskActive(task.stream))
  const stageTasks = applicableTasks.filter((task) => task.stageId === currentStage)
  const visibleTasks = uniqueTasks([...activeTasks, ...stageTasks])
  const errors = visibleTasks
    .map((task) => task.stream.errorMessage?.trim())
    .filter((message): message is string => !!message)

  useEffect(() => {
    setMobileOpen(false)
  }, [currentStage])

  const statusKey = current?.status === 'not_started' ? 'notStarted' : current?.status || 'notStarted'
  const statusLabel = tStatus(statusKey)
  const activeCount = activeTasks.length

  const content = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke-base)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
          <p className="mt-0.5 truncate text-xs text-[var(--glass-text-tertiary)]">{current?.label}</p>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="glass-btn-base glass-btn-secondary inline-flex h-8 w-8 p-0 2xl:hidden"
          title={t('close')}
        >
          <AppIcon name="close" className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar">
        <section className="border-b border-[var(--glass-stroke-base)] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-[var(--glass-text-primary)]">{t('currentStatus')}</h3>
            <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{statusLabel}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--glass-text-secondary)]">
            {t(`statusMessage.${statusKey}`)}
          </p>
        </section>

        <section className="border-b border-[var(--glass-stroke-base)] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-[var(--glass-text-primary)]">{t('issues')}</h3>
            <span className={`text-xs font-semibold ${errors.length > 0 ? 'text-[var(--glass-tone-danger-fg)]' : 'text-[var(--glass-tone-success-fg)]'}`}>
              {errors.length > 0 ? errors.length : t('noIssues')}
            </span>
          </div>
          {errors.length > 0 ? (
            <ul className="mt-3 space-y-2 text-xs leading-5 text-[var(--glass-tone-danger-fg)]">
              {errors.map((message, index) => <li key={`${message}:${index}`}>{message}</li>)}
            </ul>
          ) : null}
        </section>

        <details className="group px-4 py-4" open={activeCount > 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--glass-text-primary)]">
            <span className="inline-flex items-center gap-2">
              <AppIcon name="cpu" className="h-4 w-4 text-[var(--glass-text-secondary)]" />
              {t('generationDetails')}
            </span>
            <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--glass-text-tertiary)]">
              {activeCount > 0 ? t('runningCount', { count: activeCount }) : t('expand')}
              <AppIcon name="chevronDown" className="h-4 w-4 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="mt-3 border-t border-[var(--glass-stroke-base)] pt-2">
            <CreationTaskDetails descriptors={visibleTasks} />
          </div>
        </details>
      </div>
    </div>
  )

  return (
    <>
      <aside className="glass-surface-elevated sticky top-36 hidden h-[calc(100vh-10rem)] min-h-[480px] self-start overflow-hidden rounded-lg 2xl:block">
        {content}
      </aside>

      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        className="glass-btn-base glass-btn-primary fixed bottom-20 right-4 z-50 inline-flex h-11 items-center gap-2 px-3 text-sm 2xl:hidden"
      >
        <AppIcon name={activeCount > 0 ? 'loader' : 'sparkles'} className={`h-4 w-4 ${activeCount > 0 ? 'animate-spin' : ''}`} />
        <span>{activeCount > 0 ? t('runningCount', { count: activeCount }) : t('open')}</span>
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/25 backdrop-blur-sm 2xl:hidden" onClick={() => setMobileOpen(false)}>
          <div
            className="glass-surface-modal absolute inset-x-3 bottom-3 max-h-[82vh] overflow-hidden rounded-lg lg:inset-y-3 lg:left-auto lg:right-3 lg:max-h-none lg:w-[380px]"
            onClick={(event) => event.stopPropagation()}
          >
            {content}
          </div>
        </div>
      ) : null}
    </>
  )
}

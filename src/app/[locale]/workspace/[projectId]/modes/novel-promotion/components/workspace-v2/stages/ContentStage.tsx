'use client'

import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type {
  ContentWorkflowStepId,
  CreationWorkflowActiveTarget,
  CreationWorkflowState,
} from '@/lib/creation-workspace/workflow-state'
import type { CreationStageStatus } from '@/lib/creation-workspace/stages'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import ContentPlanStage from '../../ContentPlanStage'
import ContentAssetRequirements from '../artifacts/ContentAssetRequirements'
import ContentScriptEditor from '../artifacts/ContentScriptEditor'
import GuideNarrationEditor from '../artifacts/GuideNarrationEditor'

interface ContentStageProps {
  stageView?: string
  workflowState: CreationWorkflowState
}

function stepIcon(status: CreationStageStatus): AppIconName {
  if (status === 'completed') return 'check'
  if (status === 'running') return 'loader'
  if (status === 'attention' || status === 'stale' || status === 'failed') return 'alert'
  return 'arrowRight'
}

function stepTone(status: CreationStageStatus) {
  if (status === 'completed') return 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
  if (status === 'running') return 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
  if (status === 'attention' || status === 'stale') return 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
  if (status === 'failed') return 'bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]'
  return 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]'
}

function ContentRunningState({
  title,
  description,
  target,
  compact = false,
}: {
  title: string
  description: string
  target: CreationWorkflowActiveTarget | null
  compact?: boolean
}) {
  const progress = target?.progress || 0
  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className={compact
        ? 'mb-4 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-tone-info-bg)] px-4 py-3'
        : 'flex min-h-72 flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-5 py-10 text-center'}
    >
      <div className={compact ? 'flex items-start gap-3' : 'flex flex-col items-center'}>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--glass-bg-surface)] text-[var(--glass-tone-info-fg)]">
          <AppIcon name="loader" className="h-5 w-5 animate-spin" />
        </span>
        <div className={compact ? 'min-w-0 flex-1' : ''}>
          <h2 className={`${compact ? '' : 'mt-4 '}text-sm font-semibold text-[var(--glass-text-primary)]`}>{title}</h2>
          <p className={`${compact ? 'mt-1' : 'mt-2 max-w-xl'} text-sm leading-6 text-[var(--glass-text-secondary)]`}>
            {target?.message || description}
          </p>
          {progress > 0 ? (
            <div className={`${compact ? 'mt-3' : 'mt-5 w-full max-w-md'} overflow-hidden rounded-full bg-[var(--glass-bg-muted)]`}>
              <div
                className="h-1.5 rounded-full bg-[var(--glass-tone-info-fg)] transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function ContentStage({ stageView, workflowState }: ContentStageProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.views.content')
  const tSteps = useTranslations('novelPromotion.workspaceFlow.v2.contentSteps')
  const runtime = useWorkspaceStageRuntime()
  const currentView: ContentWorkflowStepId = stageView === 'script' || stageView === 'assets' ? stageView : 'plan'
  const isBookGuide = workflowState.facts.isBookGuide
  const steps = [
    {
      ...workflowState.contentSteps.plan,
      view: 'plan' as const,
      route: 'content-plan',
      label: t('plan'),
      description: tSteps('planDescription'),
    },
    {
      ...workflowState.contentSteps.script,
      view: 'script' as const,
      route: 'script',
      label: isBookGuide ? t('guideScript') : t('script'),
      description: isBookGuide ? tSteps('guideScriptDescription') : tSteps('scriptDescription'),
    },
    {
      ...workflowState.contentSteps.assets,
      view: 'assets' as const,
      route: 'content-assets',
      label: isBookGuide ? t('guideAssets') : t('assets'),
      description: tSteps('assetsDescription'),
    },
  ]
  const currentStep = steps.find((step) => step.view === currentView) || steps[0]
  const activeTarget = workflowState.activeTarget?.stageId === 'content'
    && workflowState.activeTarget.view === currentView
    ? workflowState.activeTarget
    : null
  const runningTitle = currentView === 'plan'
    ? tSteps('planRunning')
    : currentView === 'script'
      ? tSteps(isBookGuide ? 'guideScriptRunning' : 'scriptRunning')
      : tSteps('assetsRunning')
  const showRunningState = currentStep.status === 'running' && !!activeTarget

  return (
    <section className="min-w-0">
      <ol className="mb-5 grid overflow-hidden rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] sm:grid-cols-3">
        {steps.map((step, index) => {
          const active = step.view === currentView
          return (
            <li key={step.view} className="border-b border-[var(--glass-stroke-base)] last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
              <button
                type="button"
                disabled={step.locked}
                onClick={() => runtime.onStageChange(step.route)}
                aria-current={active ? 'step' : undefined}
                className={`flex min-h-24 w-full items-start gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--glass-stroke-focus)] ${step.locked
                  ? 'cursor-not-allowed bg-[var(--glass-bg-muted)]/40 opacity-65'
                  : active
                    ? 'cursor-pointer bg-[var(--glass-tone-info-bg)]'
                    : 'cursor-pointer hover:bg-[var(--glass-bg-surface-strong)]'
                }`}
              >
                <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${active && !step.locked
                  ? 'bg-[var(--glass-tone-info-fg)] text-white'
                  : stepTone(step.status)
                }`}>
                  {step.locked ? (
                    <AppIcon name="lock" className="h-3.5 w-3.5" />
                  ) : step.status === 'ready' || step.status === 'not_started' ? index + 1 : (
                    <AppIcon name={stepIcon(step.status)} className={`h-3.5 w-3.5 ${step.status === 'running' ? 'animate-spin' : ''}`} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--glass-text-primary)]">{step.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--glass-text-tertiary)]">
                    {step.locked
                      ? tSteps(step.view === 'script' ? 'planRequired' : 'scriptApprovalRequired')
                      : step.description}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      {currentStep.locked ? (
        <div className="flex min-h-64 flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-5 py-10 text-center">
          <AppIcon name="lock" className="h-8 w-8 text-[var(--glass-text-tertiary)]" />
          <h2 className="mt-3 text-base font-semibold text-[var(--glass-text-primary)]">{tSteps('lockedTitle')}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">
            {tSteps(currentView === 'script' ? 'planRequired' : 'scriptApprovalRequired')}
          </p>
        </div>
      ) : showRunningState && !currentStep.hasArtifact ? (
        <ContentRunningState
          title={runningTitle}
          description={tSteps('runningDescription')}
          target={activeTarget}
        />
      ) : (
        <>
          {showRunningState ? (
            <ContentRunningState
              compact
              title={runningTitle}
              description={tSteps('runningDescription')}
              target={activeTarget}
            />
          ) : null}
          {currentView === 'plan' ? <ContentPlanStage /> : null}
          {currentView === 'script' ? (isBookGuide ? <GuideNarrationEditor /> : <ContentScriptEditor />) : null}
          {currentView === 'assets' ? <ContentAssetRequirements /> : null}
        </>
      )}
    </section>
  )
}

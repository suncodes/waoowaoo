'use client'

import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { readContentArtifactMeta } from '@/lib/creation-workspace/artifact-state'
import { isBookGuideProfile } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'
import ContentPlanStage from '../../ContentPlanStage'
import ContentAssetRequirements from '../artifacts/ContentAssetRequirements'
import ContentScriptEditor from '../artifacts/ContentScriptEditor'
import GuideNarrationEditor from '../artifacts/GuideNarrationEditor'

interface ContentStageProps {
  stageView?: string
}

type ContentStepStatus = 'ready' | 'running' | 'attention' | 'completed' | 'stale' | 'locked'

function stepIcon(status: ContentStepStatus): AppIconName {
  if (status === 'completed') return 'check'
  if (status === 'running') return 'loader'
  if (status === 'attention' || status === 'stale') return 'alert'
  if (status === 'locked') return 'lock'
  return 'arrowRight'
}

function stepTone(status: ContentStepStatus) {
  if (status === 'completed') return 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
  if (status === 'running') return 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
  if (status === 'attention' || status === 'stale') return 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)]'
  return 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]'
}

export default function ContentStage({ stageView }: ContentStageProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.views.content')
  const tSteps = useTranslations('novelPromotion.workspaceFlow.v2.contentSteps')
  const runtime = useWorkspaceStageRuntime()
  const { contentPlan, clips } = useWorkspaceEpisodeStageData()
  const currentView = stageView === 'script' || stageView === 'assets' ? stageView : 'plan'
  const isBookGuide = isBookGuideProfile(runtime.videoProfile)
  const meta = readContentArtifactMeta(contentPlan)
  const hasPlan = !!contentPlan
  const hasScript = hasPlan && (isBookGuide || (clips.length > 0 && clips.every((clip) => !!clip.screenplay?.trim())))
  const contentApproved = meta?.status === 'approved' || (!meta && hasScript)
  const requirementStatus = meta?.assetRequirements.status || 'approved'
  const steps = [
    {
      view: 'plan' as const,
      route: 'content-plan',
      label: t('plan'),
      description: tSteps('planDescription'),
      status: (hasPlan ? 'completed' : 'ready') as ContentStepStatus,
      locked: false,
    },
    {
      view: 'script' as const,
      route: 'script',
      label: isBookGuide ? t('guideScript') : t('script'),
      description: isBookGuide ? tSteps('guideScriptDescription') : tSteps('scriptDescription'),
      status: (!hasPlan ? 'locked' : contentApproved ? 'completed' : 'ready') as ContentStepStatus,
      locked: !hasPlan,
    },
    {
      view: 'assets' as const,
      route: 'content-assets',
      label: isBookGuide ? t('guideAssets') : t('assets'),
      description: tSteps('assetsDescription'),
      status: (!contentApproved
        ? 'locked'
        : runtime.isAssetAnalysisRunning
          ? 'running'
          : requirementStatus === 'approved'
            ? 'completed'
            : requirementStatus === 'needs_review'
              ? 'attention'
              : requirementStatus === 'stale'
                ? 'stale'
                : 'ready') as ContentStepStatus,
      locked: !contentApproved,
    },
  ]
  const currentStep = steps.find((step) => step.view === currentView) || steps[0]

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
                  {step.status === 'ready' ? index + 1 : (
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
      ) : (
        <>
          {currentView === 'plan' ? <ContentPlanStage /> : null}
          {currentView === 'script' ? (isBookGuide ? <GuideNarrationEditor /> : <ContentScriptEditor />) : null}
          {currentView === 'assets' ? <ContentAssetRequirements /> : null}
        </>
      )}
    </section>
  )
}

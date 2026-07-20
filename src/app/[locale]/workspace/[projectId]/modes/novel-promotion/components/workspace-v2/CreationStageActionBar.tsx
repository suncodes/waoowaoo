'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import {
  readContentArtifactMeta,
  readVisualArtifactMeta,
} from '@/lib/creation-workspace/artifact-state'
import {
  resolveStoryboardFooterAction,
  resolveVisualDesignFooterAction,
} from '@/lib/creation-workspace/stage-actions'
import { resolveVisualAnchorReadiness } from '@/lib/creation-workspace/visual-readiness'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { useAssets } from '@/lib/query/hooks'
import type { CreationStageNavItem } from '../../hooks/useCreationStageNavigation'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'

interface CreationStageActionBarProps {
  items: CreationStageNavItem[]
  currentStage: string
  stageView?: string
  workflowState: CreationWorkflowState
  onStageChange: (stage: string) => void
}

interface PrimaryAction {
  label: string
  icon: AppIconName
  disabled?: boolean
  title?: string
  hint?: string
  run: () => Promise<unknown> | void
}

export default function CreationStageActionBar({
  items,
  currentStage,
  stageView,
  workflowState,
  onStageChange,
}: CreationStageActionBarProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.actionBar')
  const { projectId } = useWorkspaceProvider()
  const runtime = useWorkspaceStageRuntime()
  const { contentPlan, productionBible } = useWorkspaceEpisodeStageData()
  const assetsQuery = useAssets({ scope: 'project', projectId })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const currentIndex = items.findIndex((item) => item.id === currentStage)
  const current = items[currentIndex]
  const previous = currentIndex > 0 ? items[currentIndex - 1] : null
  const next = currentIndex >= 0 && currentIndex < items.length - 1 ? items[currentIndex + 1] : null
  const contentMeta = useMemo(() => readContentArtifactMeta(contentPlan), [contentPlan])
  const visualMeta = useMemo(() => readVisualArtifactMeta(productionBible), [productionBible])
  const visualAssets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
  const visualReadiness = useMemo(
    () => resolveVisualAnchorReadiness(visualMeta?.anchors || [], visualAssets),
    [visualAssets, visualMeta?.anchors],
  )
  const isBookGuide = workflowState.facts.isBookGuide
  const contentDocumentApproved = workflowState.facts.contentDocumentApproved
  const assetRequirementStatus = workflowState.facts.assetRequirementStatus
  const assetRequirementCount = workflowState.facts.assetRequirementCount
  const contentReadyForVisuals = workflowState.facts.contentCompleted
  const hasScriptOutput = workflowState.facts.hasScriptOutput
  const contentView = stageView === 'script' || stageView === 'assets' ? stageView : 'plan'
  const candidateCount = Object.values(contentMeta?.units || {}).filter((unit) => !!unit.candidate).length
  const workspaceBusy = pending
    || runtime.isTransitioning
    || runtime.isAssetAnalysisRunning
    || runtime.isConfirmingAssets
    || runtime.isStartingScriptToStoryboard
    || !!workflowState.activeTarget

  const continueAction = next ? {
    label: t('continue', { stage: next.label }),
    icon: 'arrowRight' as const,
    disabled: current?.status !== 'completed',
    title: current?.status !== 'completed' ? t('completeFirst') : undefined,
    hint: current?.status !== 'completed' ? t('completeFirst') : undefined,
    run: () => onStageChange(next.id),
  } : null

  const currentTask = workflowState.activeTarget?.stageId === currentStage
    ? workflowState.activeTarget
    : null
  const runningTaskLabel = currentTask?.kind === 'content_plan'
    ? t('planningContent')
    : currentTask?.kind === 'content_rewrite'
      ? t('updatingContent')
      : currentTask?.kind === 'story_script'
        ? t('generatingScript')
        : currentTask?.kind === 'asset_requirements'
          ? t('analyzingAssetRequirements')
          : currentTask?.kind === 'visual_plan'
            ? t('generatingVisualPlan')
            : currentTask?.kind === 'storyboard'
              ? t('generatingStoryboard')
              : t('working')
  let primary: PrimaryAction | null = currentTask ? {
    label: runningTaskLabel,
    icon: 'loader',
    disabled: true,
    hint: t('workingHint'),
    run: () => undefined,
  } : continueAction
  let stageHint: string | undefined
  if (currentStage === 'content' && !currentTask) {
    if (contentView === 'plan') {
      primary = workflowState.contentSteps.plan.hasArtifact
        ? {
            label: isBookGuide ? t('reviewNarration') : t('reviewScript'),
            icon: 'arrowRight',
            run: () => onStageChange('script'),
          }
        : {
            label: t('returnToSetup'),
            icon: 'chevronLeft',
            run: () => onStageChange('setup'),
          }
    } else if (runtime.contentEditingState.saving) {
      primary = {
        label: t('savingContent'),
        icon: 'loader',
        disabled: true,
        hint: t('savingContentHint'),
        run: () => undefined,
      }
    } else if (runtime.contentEditingState.dirty) {
      primary = {
        label: t('saveContentFirst'),
        icon: 'edit',
        disabled: true,
        hint: t('saveContentFirstHint'),
        run: () => undefined,
      }
    } else if (candidateCount > 0) {
      primary = {
        label: t('reviewCandidates', { count: candidateCount }),
        icon: 'sparkles',
        hint: t('reviewCandidatesHint'),
        run: () => onStageChange('script'),
      }
    } else if (contentView === 'script' && !hasScriptOutput) {
      primary = {
        label: isBookGuide ? t('returnToPlan') : t('generateScript'),
        icon: isBookGuide ? 'chevronLeft' : 'sparkles',
        disabled: workspaceBusy,
        hint: isBookGuide ? t('returnToPlanHint') : t('generateScriptHint'),
        run: isBookGuide ? () => onStageChange('content-plan') : runtime.onRunStoryToScript,
      }
    } else if (contentView === 'script' && !contentDocumentApproved) {
      primary = {
        label: t('approveContentAndAnalyze'),
        icon: 'clipboardCheck',
        disabled: workspaceBusy,
        hint: t('approveContentAndAnalyzeHint'),
        run: async () => {
          await runtime.onApproveStage('content')
          await runtime.onAnalyzeAssets()
          onStageChange('content-assets')
        },
      }
    } else if (contentView === 'script' && (assetRequirementStatus === 'not_started' || assetRequirementStatus === 'stale')) {
      primary = {
        label: assetRequirementStatus === 'stale' ? t('refreshAssetRequirements') : t('analyzeAssetRequirements'),
        icon: 'sparkles',
        disabled: workspaceBusy,
        hint: assetRequirementStatus === 'stale' ? t('refreshAssetRequirementsHint') : t('analyzeAssetRequirementsHint'),
        run: async () => {
          await runtime.onAnalyzeAssets()
          onStageChange('content-assets')
        },
      }
    } else if (contentView === 'script' && assetRequirementStatus === 'needs_review') {
      primary = {
        label: t('reviewAssetRequirements', { count: assetRequirementCount }),
        icon: 'arrowRight',
        hint: t('reviewAssetRequirementsHint'),
        run: () => onStageChange('content-assets'),
      }
    } else if (contentView === 'script') {
      primary = {
        label: t('continueToVisualDesign'),
        icon: 'arrowRight',
        run: () => onStageChange('visual-plan'),
      }
    } else if (!contentDocumentApproved) {
      primary = {
        label: t('returnToScript'),
        icon: 'chevronLeft',
        hint: t('returnToScriptHint'),
        run: () => onStageChange('script'),
      }
    } else if (runtime.isAssetAnalysisRunning) {
      primary = {
        label: t('analyzingAssetRequirements'),
        icon: 'loader',
        disabled: true,
        hint: t('analyzingAssetRequirementsHint'),
        run: () => undefined,
      }
    } else if (assetRequirementStatus === 'not_started' || assetRequirementStatus === 'stale') {
      primary = {
        label: assetRequirementStatus === 'stale' ? t('refreshAssetRequirements') : t('analyzeAssetRequirements'),
        icon: 'sparkles',
        disabled: workspaceBusy,
        hint: assetRequirementStatus === 'stale' ? t('refreshAssetRequirementsHint') : t('analyzeAssetRequirementsHint'),
        run: runtime.onAnalyzeAssets,
      }
    } else if (assetRequirementStatus === 'needs_review') {
      primary = {
        label: assetRequirementCount === 0
          ? t('approveEmptyAssetRequirements')
          : t('approveAssetRequirements', { count: assetRequirementCount }),
        icon: 'clipboardCheck',
        disabled: workspaceBusy,
        hint: assetRequirementCount === 0
          ? t('approveEmptyAssetRequirementsHint')
          : t('approveAssetRequirementsHint'),
        run: async () => {
          await runtime.onApproveAssetRequirements()
          onStageChange('visual-plan')
        },
      }
    } else {
      primary = {
        label: t('continueToVisualDesign'),
        icon: 'arrowRight',
        run: () => onStageChange('visual-plan'),
      }
    }
  }

  if (currentStage === 'visual-design') {
    const visualFooterAction = resolveVisualDesignFooterAction({
      contentReady: contentReadyForVisuals,
      stageStatus: workflowState.stages['visual-design'].status,
      hasPlan: !!visualMeta?.plan || workflowState.stages['visual-design'].hasArtifact,
      taskRunning: !!currentTask,
      assetsLoading: assetsQuery.isLoading,
      assetAnalysisRunning: runtime.isAssetAnalysisRunning,
      missingAnchors: !!visualMeta?.plan && visualMeta.anchors.length === 0 && assetRequirementCount > 0,
      missingCoreCount: visualReadiness.missingCoreItems.length,
    })

    if (visualFooterAction.kind === 'continue') {
      primary = {
        label: t('openStoryboard'),
        icon: 'arrowRight',
        run: () => onStageChange('storyboard'),
      }
    } else if (visualFooterAction.kind === 'approve') {
      const hint = visualFooterAction.reason === 'checking_assets'
        ? t('checkingCoreAssets')
        : visualFooterAction.reason === 'missing_anchors'
          ? t('refreshVisualPlanMissingAnchorsHint')
          : visualFooterAction.reason === 'missing_core_assets'
            ? t('completeCoreAssetsHint', { count: visualReadiness.missingCoreItems.length })
            : undefined
      primary = {
        label: t('approveVisuals'),
        icon: 'clipboardCheck',
        disabled: visualFooterAction.disabled || workspaceBusy,
        hint,
        run: () => runtime.onApproveStage('visual-design'),
      }
    } else {
      primary = null
      stageHint = visualFooterAction.reason === 'task_running'
        ? t('workingHint')
        : t('visualGenerationInStageHint')
    }
  }

  if (currentStage === 'storyboard-preview') {
    const storyboardFooterAction = resolveStoryboardFooterAction({
      stageStatus: workflowState.stages['storyboard-preview'].status,
      taskRunning: !!currentTask,
    })
    primary = storyboardFooterAction === 'continue'
      ? continueAction
      : null
    if (storyboardFooterAction === 'none') {
      stageHint = currentTask ? t('workingHint') : t('storyboardGenerationInStageHint')
    }
  }

  const runPrimary = async () => {
    if (!primary || primary.disabled || workspaceBusy) return
    setPending(true)
    setError('')
    try {
      await primary.run()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('actionFailed'))
    } finally {
      setPending(false)
    }
  }

  const previousTarget = currentStage === 'content' && contentView === 'script'
    ? 'content-plan'
    : currentStage === 'content' && contentView === 'assets'
      ? 'script'
      : currentStage === 'visual-design' && stageView === 'assets'
        ? 'visual-plan'
        : previous?.id

  return (
    <div className="sticky bottom-3 z-30 mt-6 flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-modal)] px-3 py-2 shadow-[var(--glass-shadow-lg)] backdrop-blur-lg">
      <button
        type="button"
        onClick={() => previousTarget && onStageChange(previousTarget)}
        disabled={!previousTarget || workspaceBusy}
        className="glass-btn-base glass-btn-secondary h-10 px-3 text-sm"
      >
        <AppIcon name="chevronLeft" className="h-4 w-4" />
        <span>{t('previous')}</span>
      </button>

      <span className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 text-center text-xs text-[var(--glass-text-tertiary)]">
        <AppIcon name={current?.status === 'completed' ? 'check' : current?.status === 'stale' || current?.status === 'attention' ? 'alert' : 'clock'} className={`h-3.5 w-3.5 ${current?.status === 'completed' ? 'text-[var(--glass-tone-success-fg)]' : current?.status === 'stale' || current?.status === 'attention' ? 'text-[var(--glass-tone-warning-fg)]' : ''}`} />
        <span>{primary?.hint || stageHint || (current?.status === 'completed' ? t('stageApproved') : current?.status === 'stale' ? t('stageStale') : current?.status === 'attention' ? t('stageNeedsReview') : t('autoSaved'))}</span>
      </span>

      {primary ? (
        <button
          type="button"
          onClick={() => { void runPrimary() }}
          disabled={primary.disabled || workspaceBusy}
          title={primary.title}
          className="glass-btn-base glass-btn-primary h-10 px-4 text-sm"
        >
          <AppIcon name={workspaceBusy ? 'loader' : primary.icon} className={`h-4 w-4 ${workspaceBusy || primary.icon === 'loader' ? 'animate-spin' : ''}`} />
          <span>{primary.label}</span>
        </button>
      ) : !next ? (
        <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('finalStage')}</span>
      ) : null}

      {error ? <p className="basis-full text-right text-xs text-[var(--glass-tone-danger-fg)]">{error}</p> : null}
    </div>
  )
}

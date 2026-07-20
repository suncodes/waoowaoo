'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import {
  readContentArtifactMeta,
  readVisualArtifactMeta,
} from '@/lib/creation-workspace/artifact-state'
import { resolveVisualAnchorReadiness } from '@/lib/creation-workspace/visual-readiness'
import { useAssets } from '@/lib/query/hooks'
import { isBookGuideProfile } from '@/lib/video-profile'
import type { CreationStageNavItem } from '../../hooks/useCreationStageNavigation'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'

interface CreationStageActionBarProps {
  items: CreationStageNavItem[]
  currentStage: string
  onStageChange: (stage: string) => void
}

interface PrimaryAction {
  label: string
  icon: AppIconName
  disabled?: boolean
  title?: string
  run: () => Promise<unknown> | void
}

export default function CreationStageActionBar({
  items,
  currentStage,
  onStageChange,
}: CreationStageActionBarProps) {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.actionBar')
  const { projectId } = useWorkspaceProvider()
  const runtime = useWorkspaceStageRuntime()
  const { contentPlan, productionBible, clips } = useWorkspaceEpisodeStageData()
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
  const isBookGuide = isBookGuideProfile(runtime.videoProfile)
  const contentStage = items.find((item) => item.id === 'content')
  const storyboardStage = items.find((item) => item.id === 'storyboard-preview')
  const contentApproved = contentMeta?.status === 'approved'
    || (!contentMeta && contentStage?.status === 'completed')
  const hasContentOutput = !!contentPlan && (
    isBookGuide
    || (clips.length > 0 && clips.every((clip) => !!clip.screenplay?.trim()))
  )
  const candidateCount = Object.values(contentMeta?.units || {}).filter((unit) => !!unit.candidate).length
  const workspaceBusy = pending
    || runtime.isTransitioning
    || runtime.isAssetAnalysisRunning
    || runtime.isConfirmingAssets
    || runtime.isStartingScriptToStoryboard

  const continueAction = next ? {
    label: t('continue', { stage: next.label }),
    icon: 'arrowRight' as const,
    disabled: current?.status !== 'completed',
    title: current?.status !== 'completed' ? t('completeFirst') : undefined,
    run: () => onStageChange(next.id),
  } : null

  let primary: PrimaryAction | null = continueAction
  if (currentStage === 'content') {
    if (runtime.contentEditingState.saving) {
      primary = {
        label: t('savingContent'),
        icon: 'loader',
        disabled: true,
        run: () => undefined,
      }
    } else if (runtime.contentEditingState.dirty) {
      primary = {
        label: t('saveContentFirst'),
        icon: 'edit',
        disabled: true,
        run: () => undefined,
      }
    } else if (candidateCount > 0) {
      primary = {
        label: t('reviewCandidates', { count: candidateCount }),
        icon: 'sparkles',
        run: () => onStageChange('script'),
      }
    } else if (hasContentOutput && contentMeta?.status !== 'approved') {
      primary = {
        label: t('approveContent'),
        icon: 'clipboardCheck',
        disabled: workspaceBusy,
        run: async () => {
          await runtime.onApproveStage('content')
          onStageChange('visual-plan')
        },
      }
    }
  }

  if (currentStage === 'visual-design') {
    if (!contentApproved) {
      primary = {
        label: t('returnToContent'),
        icon: 'chevronLeft',
        run: () => onStageChange('script'),
      }
    } else if (!visualMeta?.plan || visualMeta.status === 'stale') {
      primary = {
        label: visualMeta?.status === 'stale' ? t('refreshVisualPlan') : t('generateVisualPlan'),
        icon: 'sparkles',
        disabled: workspaceBusy,
        run: runtime.onRunVisualPlan,
      }
    } else if (visualMeta.status !== 'approved') {
      if (runtime.isAssetAnalysisRunning) {
        primary = {
          label: t('identifyingCoreAssets'),
          icon: 'loader',
          disabled: true,
          run: () => undefined,
        }
      } else if (assetsQuery.isLoading) {
        primary = {
          label: t('checkingCoreAssets'),
          icon: 'loader',
          disabled: true,
          run: () => undefined,
        }
      } else if (visualMeta.anchors.length === 0 && visualAssets.length === 0) {
        primary = {
          label: t('identifyCoreAssets'),
          icon: 'sparkles',
          disabled: runtime.isAssetAnalysisRunning,
          run: runtime.onAnalyzeAssets,
        }
      } else if (visualReadiness.missingCoreItems.length > 0) {
        primary = {
          label: t('completeCoreAssets', { count: visualReadiness.missingCoreItems.length }),
          icon: 'imageEdit',
          run: () => onStageChange('assets'),
        }
      } else {
        primary = {
          label: t('approveVisuals'),
          icon: 'clipboardCheck',
          disabled: workspaceBusy,
          run: () => runtime.onApproveStage('visual-design'),
        }
      }
    } else if (storyboardStage?.status === 'completed' || storyboardStage?.status === 'stale') {
      primary = {
        label: t('openStoryboard'),
        icon: 'arrowRight',
        run: () => onStageChange('storyboard'),
      }
    } else {
      primary = {
        label: t('generateStoryboard'),
        icon: 'clapperboard',
        disabled: workspaceBusy,
        run: isBookGuide ? runtime.onMaterializeGuideStoryboard : runtime.onRunScriptToStoryboard,
      }
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

  return (
    <div className="sticky bottom-3 z-30 mt-6 flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-modal)] px-3 py-2 shadow-[var(--glass-shadow-lg)] backdrop-blur-lg">
      <button
        type="button"
        onClick={() => previous && onStageChange(previous.id)}
        disabled={!previous || workspaceBusy}
        className="glass-btn-base glass-btn-secondary h-10 px-3 text-sm"
      >
        <AppIcon name="chevronLeft" className="h-4 w-4" />
        <span>{t('previous')}</span>
      </button>

      <span className="inline-flex items-center gap-2 text-xs text-[var(--glass-text-tertiary)]">
        <AppIcon name={current?.status === 'completed' ? 'check' : current?.status === 'stale' || current?.status === 'attention' ? 'alert' : 'clock'} className={`h-3.5 w-3.5 ${current?.status === 'completed' ? 'text-[var(--glass-tone-success-fg)]' : current?.status === 'stale' || current?.status === 'attention' ? 'text-[var(--glass-tone-warning-fg)]' : ''}`} />
        {current?.status === 'completed' ? t('stageApproved') : current?.status === 'stale' ? t('stageStale') : current?.status === 'attention' ? t('stageNeedsReview') : t('autoSaved')}
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
      ) : (
        <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('finalStage')}</span>
      )}

      {error ? <p className="basis-full text-right text-xs text-[var(--glass-tone-danger-fg)]">{error}</p> : null}
    </div>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { DEFAULT_VIDEO_RATIO } from '@/lib/constants'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { isBookGuideProfile } from '@/lib/video-profile'
import StoryboardStageView from './storyboard'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import StageGenerationPanel from './workspace-v2/StageGenerationPanel'

interface StoryboardStageProps {
  workspaceLayout?: boolean
  workflowState?: CreationWorkflowState
}

export default function StoryboardStage({
  workspaceLayout = false,
  workflowState,
}: StoryboardStageProps = {}) {
  const t = useTranslations('novelPromotion.workspaceFlow.storyboardGeneration')
  const runtime = useWorkspaceStageRuntime()
  const { projectId, episodeId } = useWorkspaceProvider()
  const { clips, storyboards } = useWorkspaceEpisodeStageData()

  if (!episodeId) return null

  const stageStatus = workflowState?.stages['storyboard-preview'].status
  const activeTask = workflowState?.activeTarget?.kind === 'storyboard'
    ? workflowState.activeTarget
    : null
  const isBookGuide = workflowState?.facts.isBookGuide ?? isBookGuideProfile(runtime.videoProfile)
  const runStoryboardGeneration = isBookGuide
    ? runtime.onMaterializeGuideStoryboard
    : runtime.onRunScriptToStoryboard

  if (workspaceLayout && storyboards.length === 0) {
    const running = !!activeTask
    const failed = stageStatus === 'failed' && !running
    return (
      <StageGenerationPanel
        icon={failed ? 'alert' : 'clapperboard'}
        tone={failed ? 'danger' : 'neutral'}
        title={running ? t('runningTitle') : failed ? t('failedTitle') : t('emptyTitle')}
        description={activeTask?.message || (failed ? t('failedDescription') : t('emptyDescription'))}
        actionLabel={failed ? t('retryAction') : t('generateAction')}
        runningLabel={t('runningAction')}
        onAction={runStoryboardGeneration}
        isRunning={running}
        progress={activeTask?.progress}
        errorFallback={t('actionFailed')}
      />
    )
  }

  const generationNotice = workspaceLayout && activeTask
    ? {
        tone: 'neutral' as const,
        icon: 'loader' as const,
        title: t('runningTitle'),
        description: activeTask.message || t('emptyDescription'),
        actionLabel: t('runningAction'),
        running: true,
      }
    : workspaceLayout && (stageStatus === 'stale' || stageStatus === 'failed')
      ? {
          tone: stageStatus === 'failed' ? 'danger' as const : 'warning' as const,
          icon: stageStatus === 'failed' ? 'alert' as const : 'refresh' as const,
          title: stageStatus === 'failed' ? t('failedTitle') : t('staleTitle'),
          description: stageStatus === 'failed' ? t('failedDescription') : t('staleDescription'),
          actionLabel: stageStatus === 'failed' ? t('retryAction') : t('refreshAction'),
          running: false,
        }
      : null

  return (
    <>
      {generationNotice ? (
        <StageGenerationPanel
          variant="notice"
          tone={generationNotice.tone}
          icon={generationNotice.icon}
          title={generationNotice.title}
          description={generationNotice.description}
          actionLabel={generationNotice.actionLabel}
          runningLabel={t('runningAction')}
          actionIcon="refresh"
          onAction={runStoryboardGeneration}
          isRunning={generationNotice.running}
          progress={activeTask?.progress}
          errorFallback={t('actionFailed')}
        />
      ) : null}
      <StoryboardStageView
        projectId={projectId}
        episodeId={episodeId}
        storyboards={storyboards}
        clips={clips}
        videoRatio={runtime.videoRatio || DEFAULT_VIDEO_RATIO}
        onBack={() => runtime.onStageChange(workspaceLayout ? 'visual-plan' : 'script')}
        onNext={async () => runtime.onStageChange('videos')}
        isTransitioning={runtime.isTransitioning}
        showWorkflowNavigation={!workspaceLayout}
      />
    </>
  )
}

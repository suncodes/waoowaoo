import { describe, expect, it } from 'vitest'
import { resolveVideoProfile, VIDEO_PROFILE_PRESET } from '@/lib/video-profile'
import { useWorkspaceStageNavigation } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceStageNavigation'

const idleStream = {
  status: 'idle',
  isRunning: false,
  isRecoveredRunning: false,
}

describe('workspace stage navigation', () => {
  it('marks only the matching planning stage as running', () => {
    const items = useWorkspaceStageNavigation({
      stageArtifacts: {
        hasStory: true,
        hasContentPlan: false,
        hasScript: false,
        hasVisualPlan: false,
        hasStoryboard: false,
        hasVideo: false,
        hasVoice: false,
      },
      videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.AI_COMIC }),
      contentPlanStream: { ...idleStream, status: 'running' },
      storyToScriptStream: idleStream,
      visualPlanStream: idleStream,
      scriptToStoryboardStream: idleStream,
      t: (key) => key,
    })

    expect(items.find((item) => item.id === 'content-plan')?.status).toBe('running')
    expect(items.find((item) => item.id === 'script')?.status).toBe('not_started')
    expect(items.find((item) => item.id === 'storyboard')?.status).toBe('not_started')
  })

  it('uses guide-specific labels without duplicating the workflow structure', () => {
    const items = useWorkspaceStageNavigation({
      stageArtifacts: {
        hasStory: true,
        hasContentPlan: true,
        hasScript: true,
        hasVisualPlan: true,
        hasStoryboard: true,
        hasVideo: false,
        hasVoice: true,
      },
      videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.BOOK_GUIDE }),
      contentPlanStream: idleStream,
      storyToScriptStream: idleStream,
      visualPlanStream: idleStream,
      scriptToStoryboardStream: idleStream,
      t: (key) => key,
    })

    expect(items.map((item) => item.id)).toEqual([
      'config',
      'content-plan',
      'script',
      'visual-plan',
      'storyboard',
      'videos',
      'editor',
    ])
    expect(items.find((item) => item.id === 'script')?.label).toBe('stages.guideScript')
    expect(items.find((item) => item.id === 'storyboard')?.label).toBe('stages.guideStoryboard')
  })
})

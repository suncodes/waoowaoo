import { describe, expect, it } from 'vitest'
import { resolveVideoProfile, VIDEO_PROFILE_PRESET } from '@/lib/video-profile'
import { buildCreationStageNavigation } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useCreationStageNavigation'

const idleStream = {
  status: 'idle',
  isRunning: false,
  isRecoveredRunning: false,
}

const emptyArtifacts = {
  hasStory: true,
  hasContentPlan: false,
  hasScript: false,
  hasVisualPlan: false,
  hasStoryboard: false,
  hasVideo: false,
  hasVoice: false,
}

function createItems(preset: typeof VIDEO_PROFILE_PRESET[keyof typeof VIDEO_PROFILE_PRESET]) {
  return buildCreationStageNavigation({
    stageArtifacts: emptyArtifacts,
    videoProfile: resolveVideoProfile({ preset }),
    contentPlanStream: idleStream,
    storyToScriptStream: idleStream,
    visualPlanStream: idleStream,
    scriptToStoryboardStream: idleStream,
    t: (key) => key,
  })
}

describe('creation stage navigation', () => {
  it.each([
    VIDEO_PROFILE_PRESET.AI_COMIC,
    VIDEO_PROFILE_PRESET.BOOK_GUIDE,
  ])('uses the same six-stage product skeleton for %s', (preset) => {
    expect(createItems(preset).map((item) => item.id)).toEqual([
      'setup',
      'content',
      'visual-design',
      'storyboard-preview',
      'production',
      'edit',
    ])
  })

  it('combines content planning and script generation into one content stage', () => {
    const items = buildCreationStageNavigation({
      stageArtifacts: emptyArtifacts,
      videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.AI_COMIC }),
      contentPlanStream: idleStream,
      storyToScriptStream: { ...idleStream, status: 'running' },
      visualPlanStream: idleStream,
      scriptToStoryboardStream: idleStream,
      t: (key) => key,
    })

    expect(items.find((item) => item.id === 'content')?.status).toBe('running')
    expect(items).toHaveLength(6)
  })

  it('ignores narrative-only run failures for book guides', () => {
    const items = buildCreationStageNavigation({
      stageArtifacts: emptyArtifacts,
      videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.BOOK_GUIDE }),
      contentPlanStream: idleStream,
      storyToScriptStream: { ...idleStream, status: 'failed' },
      visualPlanStream: idleStream,
      scriptToStoryboardStream: { ...idleStream, status: 'failed' },
      t: (key) => key,
    })

    expect(items.find((item) => item.id === 'content')?.status).toBe('ready')
    expect(items.find((item) => item.id === 'storyboard-preview')?.status).toBe('not_started')
  })
})

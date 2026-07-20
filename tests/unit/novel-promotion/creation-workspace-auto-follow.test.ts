import { describe, expect, it } from 'vitest'
import { resolveCreationWorkspaceAutoFollowTarget } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useCreationWorkspaceAutoFollow'

const idle = {
  runId: '',
  status: 'idle',
  isRunning: false,
  isRecoveredRunning: false,
}

describe('creation workspace task auto follow', () => {
  it('opens content structure when content planning starts', () => {
    expect(resolveCreationWorkspaceAutoFollowTarget({
      contentPlanStream: { ...idle, runId: 'plan-1', status: 'running', isRunning: true },
      storyToScriptStream: idle,
      visualPlanStream: idle,
      scriptToStoryboardStream: idle,
    })).toMatchObject({
      stageId: 'content',
      view: 'plan',
      route: 'content-plan',
    })
  })

  it('follows the most downstream active task when a chained flow advances', () => {
    expect(resolveCreationWorkspaceAutoFollowTarget({
      contentPlanStream: { ...idle, status: 'completed' },
      storyToScriptStream: idle,
      visualPlanStream: { ...idle, runId: 'visual-1', status: 'running', isRecoveredRunning: true },
      scriptToStoryboardStream: idle,
    })).toMatchObject({
      stageId: 'visual-design',
      view: 'direction',
      route: 'visual-plan',
    })
  })

  it('does not navigate for completed historical runs', () => {
    expect(resolveCreationWorkspaceAutoFollowTarget({
      contentPlanStream: { ...idle, runId: 'old-plan', status: 'completed' },
      storyToScriptStream: { ...idle, runId: 'old-script', status: 'completed' },
      visualPlanStream: idle,
      scriptToStoryboardStream: idle,
    })).toBeNull()
  })

  it('opens the document view for a local content rewrite', () => {
    expect(resolveCreationWorkspaceAutoFollowTarget({
      contentPlanStream: {
        ...idle,
        runId: 'rewrite-1',
        status: 'running',
        isRunning: true,
        activeStepId: 'content_unit_rewrite',
      },
      storyToScriptStream: idle,
      visualPlanStream: idle,
      scriptToStoryboardStream: idle,
    })).toMatchObject({
      stageId: 'content',
      view: 'script',
      route: 'script',
    })
  })
})

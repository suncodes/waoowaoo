import * as React from 'react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WorkspaceTaskPanel from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/WorkspaceTaskPanel'
import type { WorkspaceRunStreamState } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/workspace-run-types'
import { resolveVideoProfile } from '@/lib/video-profile'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key
    return `${key}:${Object.values(values).join('/')}`
  },
}))

function createStream(overrides?: Partial<WorkspaceRunStreamState>): WorkspaceRunStreamState {
  return {
    runState: null,
    runId: '',
    status: 'idle',
    isRunning: false,
    isRecoveredRunning: false,
    isVisible: false,
    errorMessage: '',
    summary: null,
    payload: null,
    stages: [],
    orderedSteps: [],
    activeStepId: null,
    selectedStep: null,
    outputText: '',
    overallProgress: 0,
    activeMessage: '',
    run: async () => ({ runId: '', status: 'completed', summary: null, payload: null, errorMessage: '' }),
    retryStep: async () => ({ runId: '', status: 'running', summary: null, payload: null, errorMessage: '' }),
    stop: () => undefined,
    reset: () => undefined,
    selectStep: () => undefined,
    ...overrides,
  }
}

describe('WorkspaceTaskPanel', () => {
  it('renders all workflow tasks and hides reasoning text from the output area', () => {
    Reflect.set(globalThis, 'React', React)
    const completedStream = createStream({
      status: 'completed',
      outputText: '【思考过程】internal reasoning【最终结果】visible result',
      overallProgress: 100,
    })
    const html = renderToStaticMarkup(createElement(WorkspaceTaskPanel, {
      currentStage: 'content-plan',
      videoProfile: resolveVideoProfile(null),
      contentPlanStream: completedStream,
      storyToScriptStream: createStream(),
      visualPlanStream: createStream(),
      scriptToStoryboardStream: createStream(),
    }))

    expect(html).toContain('tasks.contentPlan')
    expect(html).toContain('tasks.storyScript')
    expect(html).toContain('tasks.visualPlan')
    expect(html).toContain('tasks.storyboard')
    expect(html).toContain('visible result')
    expect(html).not.toContain('internal reasoning')
  })
})

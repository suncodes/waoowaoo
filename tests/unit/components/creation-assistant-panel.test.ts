import * as React from 'react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CreationAssistantPanel from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/workspace-v2/CreationAssistantPanel'
import type { WorkspaceRunStreamState } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/workspace-run-types'
import { resolveVideoProfile, VIDEO_PROFILE_PRESET } from '@/lib/video-profile'

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

const items = [{
  id: 'content' as const,
  icon: 'bookOpen' as const,
  label: 'Content',
  description: 'Content description',
  status: 'ready' as const,
  issueCount: 0,
}]

describe('CreationAssistantPanel', () => {
  it('hides narrative-only tasks for book guides', () => {
    Reflect.set(globalThis, 'React', React)
    const html = renderToStaticMarkup(createElement(CreationAssistantPanel, {
      currentStage: 'content',
      items,
      videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.BOOK_GUIDE }),
      contentPlanStream: createStream(),
      storyToScriptStream: createStream(),
      visualPlanStream: createStream(),
      scriptToStoryboardStream: createStream(),
    }))

    expect(html).toContain('tasks.contentPlan')
    expect(html).not.toContain('tasks.storyScript')
    expect(html).not.toContain('tasks.storyboard')
  })

  it('shows an active task even when it belongs to the next product stage', () => {
    Reflect.set(globalThis, 'React', React)
    const html = renderToStaticMarkup(createElement(CreationAssistantPanel, {
      currentStage: 'content',
      items,
      videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.AI_COMIC }),
      contentPlanStream: createStream(),
      storyToScriptStream: createStream(),
      visualPlanStream: createStream({ status: 'running', isRunning: true }),
      scriptToStoryboardStream: createStream(),
    }))

    expect(html).toContain('tasks.visualPlan')
    expect(html).toContain('runningCount:1')
  })
})

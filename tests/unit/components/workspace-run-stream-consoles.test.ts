import * as React from 'react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WorkspaceRunStreamConsoles from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/WorkspaceRunStreamConsoles'
import { resolveVideoProfile, VIDEO_PROFILE_PRESET } from '@/lib/video-profile'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/llm-console/LLMStageStreamCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => createElement('section', null, `LLMStageStreamCard:${title}`),
}))

function createStreamState(overrides?: Partial<React.ComponentProps<typeof WorkspaceRunStreamConsoles>['storyToScriptStream']>) {
  return {
    runState: null,
    runId: 'run-1',
    status: 'running' as const,
    isVisible: true,
    isRecoveredRunning: true,
    errorMessage: '',
    summary: null,
    payload: null,
    stages: [],
    orderedSteps: [],
    selectedStep: null,
    activeStepId: null,
    outputText: '',
    activeMessage: '',
    overallProgress: 0,
    isRunning: false,
    run: async () => ({
      runId: 'run-1',
      status: 'running' as const,
      summary: null,
      payload: null,
      errorMessage: '',
    }),
    stop: () => undefined,
    reset: () => undefined,
    selectStep: () => undefined,
    retryStep: async () => ({
      runId: 'run-1',
      status: 'running' as const,
      summary: null,
      payload: null,
      errorMessage: '',
    }),
    ...overrides,
  }
}

describe('WorkspaceRunStreamConsoles', () => {
  it('shows fallback running console when a recovered run has no stages yet', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(WorkspaceRunStreamConsoles, {
        storyToScriptStream: createStreamState(),
        contentPlanStream: createStreamState({
          status: 'idle',
          isVisible: false,
          isRecoveredRunning: false,
        }),
        visualPlanStream: createStreamState({
          status: 'idle',
          isVisible: false,
          isRecoveredRunning: false,
        }),
        scriptToStoryboardStream: createStreamState({
          status: 'idle',
          isVisible: false,
          isRecoveredRunning: false,
        }),
        currentStage: 'script',
        videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.AI_COMIC }),
      }),
    )

    expect(html).toContain('LLMStageStreamCard:tasks.storyScript')
  })
})

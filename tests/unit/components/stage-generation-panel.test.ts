import * as React from 'react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StageGenerationPanel from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/workspace-v2/StageGenerationPanel'
import StoryboardStageShell from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardStageShell'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('StageGenerationPanel', () => {
  it('places an available stage generation action in the main empty state', () => {
    Reflect.set(globalThis, 'React', React)
    const html = renderToStaticMarkup(createElement(StageGenerationPanel, {
      icon: 'clapperboard',
      title: '分镜尚未生成',
      description: '进入本阶段后生成分镜',
      actionLabel: '生成分镜',
      onAction: () => undefined,
      errorFallback: '失败',
    }))

    expect(html).toContain('min-h-[360px]')
    expect(html).toContain('生成分镜')
    expect(html).toContain('aria-busy="false"')
  })

  it('renders running progress without enabling a second submission', () => {
    Reflect.set(globalThis, 'React', React)
    const html = renderToStaticMarkup(createElement(StageGenerationPanel, {
      icon: 'clapperboard',
      title: '正在生成分镜',
      description: '正在处理',
      actionLabel: '生成分镜',
      runningLabel: '正在生成',
      onAction: () => undefined,
      isRunning: true,
      progress: 42,
      errorFallback: '失败',
    }))

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('width:42%')
  })
})

describe('StoryboardStageShell', () => {
  it('removes the legacy floating next action in the V2 workspace', () => {
    Reflect.set(globalThis, 'React', React)
    const html = renderToStaticMarkup(createElement(
      StoryboardStageShell,
      {
        isTransitioning: false,
        isNextDisabled: false,
        transitioningState: null,
        onNext: () => undefined,
        showNextAction: false,
      },
      createElement('div', null, 'storyboard-content'),
    ))

    expect(html).toContain('storyboard-content')
    expect(html).not.toContain('header.generateVideo')
    expect(html).not.toContain('fixed bottom-6 right-6')
  })
})

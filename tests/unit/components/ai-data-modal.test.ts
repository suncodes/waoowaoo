import * as React from 'react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AIDataModal from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/AIDataModal'
import {
  applyPromptSnapshotsToPreview,
  buildAIDataPromptPreview,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/AIDataPromptPreview'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('react-dom', () => ({
  createPortal: (node: unknown) => node,
}))

describe('AIDataModal', () => {
  it('在查看数据预览中展示角色完整数据与 slot', () => {
    Reflect.set(globalThis, 'React', React)
    vi.stubGlobal('document', { body: {} })

    const html = renderToStaticMarkup(
      createElement(AIDataModal, {
        isOpen: true,
        onClose: () => undefined,
        projectId: 'project-1',
        panelId: 'panel-1',
        panelNumber: 1,
        shotType: 'medium shot',
        cameraMove: 'static',
        description: '皇帝立于大殿中央',
        location: '皇宫大殿',
        characters: [
          {
            name: '皇帝',
            appearance: '朝服形象',
            slot: '皇宫正中龙椅前方台阶下的位置',
          },
        ],
        imagePrompt: '皇帝站在大殿中央，电影感中景',
        videoPrompt: 'dramatic court scene',
        photographyRules: null,
        actingNotes: null,
        videoRatio: '16:9',
        onSave: () => undefined,
      }),
    )

    expect(html).toContain('&quot;characters&quot;')
    expect(html).toContain('&quot;appearance&quot;: &quot;朝服形象&quot;')
    expect(html).toContain('&quot;slot&quot;: &quot;皇宫正中龙椅前方台阶下的位置&quot;')
    expect(html).toContain('aiData.imagePromptPreview')
    expect(html).toContain('aiData.videoPromptPreview')
    expect(html).toContain('aiData.promptPreviewDraft')
    expect(html).toContain('主体与资产')
    expect(html).toContain('图生视频')
  })

  it('生成结构化图片和视频提示词预览', () => {
    const preview = buildAIDataPromptPreview({
      videoRatio: '16:9',
      shotType: 'medium shot',
      cameraMove: 'slow push',
      description: '尼摩船长站在舷窗前',
      location: '潜艇驾驶舱',
      characters: [{ name: '尼摩船长', appearance: '深色船长制服', slot: '舷窗前' }],
      imagePrompt: '尼摩船长站在舷窗前，无文字',
      videoPrompt: '缓慢转头看向深海',
      photographyRules: {
        scene_summary: '冷色潜艇驾驶舱',
        lighting: { direction: '窗外侧光', quality: '冷色柔光' },
        characters: [],
        depth_of_field: '浅景深',
        color_tone: '深蓝金属灰',
      },
      actingNotes: [{ name: '尼摩船长', acting: '克制凝视' }],
    })

    expect(preview.image).toContain('主体与资产：尼摩船长，深色船长制服，站位：舷窗前')
    expect(preview.image).toContain('光线：窗外侧光，冷色柔光')
    expect(preview.video).toContain('主体主运动：缓慢转头看向深海')
    expect(preview.video).toContain('禁止：改脸')
  })

  it('优先展示真实生成快照中的 compiled prompt', () => {
    const draft = buildAIDataPromptPreview({
      videoRatio: '16:9',
      shotType: null,
      cameraMove: null,
      description: '草稿描述',
      location: null,
      characters: [],
      imagePrompt: null,
      videoPrompt: null,
      photographyRules: null,
      actingNotes: null,
    })

    const preview = applyPromptSnapshotsToPreview(draft, {
      image: {
        artifactType: 'prompt.panel_image.snapshot',
        modelKey: 'provider::image-model',
        promptHash: 'hash-image',
        compiledPrompt: '真实图片 compiled prompt',
        createdAt: '2026-07-23T00:00:00.000Z',
      },
      video: null,
    })

    expect(preview.image).toBe('真实图片 compiled prompt')
    expect(preview.imageSource).toBe('snapshot')
    expect(preview.imageMeta?.promptHash).toBe('hash-image')
    expect(preview.video).toBe(draft.video)
    expect(preview.videoSource).toBe('draft')
  })
})

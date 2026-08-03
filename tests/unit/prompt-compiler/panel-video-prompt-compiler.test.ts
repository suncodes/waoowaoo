import { describe, expect, it } from 'vitest'
import {
  buildPanelVideoGenerationSnapshot,
  buildPanelVideoPromptSpec,
  compilePanelVideoPrompt,
} from '@/lib/prompt-compiler/panel-video-prompt-compiler'

describe('panel video prompt compiler', () => {
  it('compiles storyboard motion into an image-to-video prompt', () => {
    const spec = buildPanelVideoPromptSpec({
      locale: 'zh',
      context: {
        generationMode: 'normal',
        panel: {
          panelId: 'panel-1',
          description: '尼摩船长站在舷窗前',
          videoPrompt: '镜头缓慢推进',
          cameraMove: 'slow push',
          duration: 5,
          photographyRules: {
            shotSpec: {
              narrativeIntent: '建立深海压迫感',
              primarySubject: '尼摩船长',
              startState: '站在舷窗前',
              actionBeats: ['缓慢转头看向深海', '窗外微光流动'],
              endState: '目光停在远处黑暗水域',
              camera: '缓慢推进',
              continuity: {
                fromPrevious: '承接潜艇外观',
                toNext: '进入驾驶舱细节',
                screenDirection: '看向画面右侧',
                lightingContinuity: '冷色舷窗光',
              },
            },
          },
        },
      },
    })
    const prompt = compilePanelVideoPrompt(spec, 'zh')

    expect(spec.primaryMotion).toBe('缓慢转头看向深海')
    expect(prompt).toContain('源图是锁定首帧')
    expect(prompt).toContain('主体主运动：缓慢转头看向深海')
    expect(prompt).not.toContain('二级动画：窗外微光流动')
    expect(prompt).toContain('短视频段')
    expect(prompt).toContain('禁止项：')
    expect(prompt).toContain('不要改变角色身份')
  })

  it('creates a stable generation snapshot for video prompts', () => {
    const spec = buildPanelVideoPromptSpec({
      context: {
        generationMode: 'firstlastframe',
        lastFrameProvided: true,
        customPrompt: '从低头沉思过渡到抬头凝视',
        panel: { panelId: 'panel-1', description: '人物特写', duration: 8 },
      },
    })
    const compiledPrompt = compilePanelVideoPrompt(spec)
    const snapshot = buildPanelVideoGenerationSnapshot({
      targetId: 'panel-1',
      modelKey: 'video::model',
      promptTemplateId: 'prompt_compiler.panel_video.v1',
      referenceImages: ['first.png', 'last.png'],
      promptSpec: spec,
      compiledPrompt,
      assetVersionHash: 'asset-hash',
    })

    expect(snapshot).toMatchObject({
      snapshotType: 'panel_video_prompt',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      modelKey: 'video::model',
      referenceImages: ['first.png', 'last.png'],
    })
    expect(snapshot.promptHash).toBeTruthy()
    expect(snapshot.specHash).toBeTruthy()
  })

  it('uses promptBlueprint when action beats are absent', () => {
    const spec = buildPanelVideoPromptSpec({
      locale: 'zh',
      context: {
        generationMode: 'normal',
        panel: {
          panelId: 'panel-blueprint',
          description: '潜艇舷窗',
          photographyRules: {
            shotSpec: {
              primarySubject: '潜艇舷窗',
              promptBlueprint: {
                action: ['窗外水流缓慢掠过'],
                camera: ['固定机位轻微呼吸感'],
                negative: ['禁止新增人物'],
              },
            },
          },
        },
      },
    })
    const prompt = compilePanelVideoPrompt(spec, 'zh')

    expect(spec.primaryMotion).toBe('窗外水流缓慢掠过')
    expect(spec.cameraMotion).toBe('固定机位轻微呼吸感')
    expect(prompt).toContain('禁止新增人物')
  })

  it('inherits locked visual references and simplifies short clip motion', () => {
    const spec = buildPanelVideoPromptSpec({
      locale: 'zh',
      context: {
        generationMode: 'normal',
        panel: {
          panelId: 'panel-ref',
          description: '黄铜罗盘在桌面上',
          duration: 4,
          promptSpec: {
            primarySubject: '黄铜罗盘',
            assetRefs: [{
              id: 'prop-1',
              kind: 'prop',
              name: '黄铜罗盘',
              role: 'prop_detail',
            }],
          },
          referencePlan: {
            schemaVersion: 1,
            references: [{
              assetName: '黄铜罗盘',
              role: 'prop_detail',
              usage: 'must_match',
            }],
          },
          photographyRules: {
            shotSpec: {
              primarySubject: '黄铜罗盘',
              actionBeats: ['指针轻微颤动', '桌面阴影移动'],
            },
          },
        },
      },
    })

    expect(spec.secondaryMotion).toEqual([])
    expect(spec.continuityConstraints.join('\n')).toContain('黄铜罗盘')
    expect(spec.continuityConstraints.join('\n')).toContain('短视频段')
  })

  it('inherits the validated panel visual contract without repeating raw story text', () => {
    const spec = buildPanelVideoPromptSpec({
      locale: 'zh',
      context: {
        generationMode: 'normal',
        panel: {
          panelId: 'panel-contract',
          description: '这段长描述不应被当作静态画面合同重复输出。',
          videoPrompt: '罗盘指针缓慢转动',
          promptSpec: {
            visualContract: {
              primarySubject: '黄铜罗盘',
              assetLocks: ['黄铜罗盘', '木桌'],
              actionState: '罗盘静置于桌面',
              composition: '特写；俯视机位',
              settingAndLight: '昏暗木桌；暖色侧光',
              continuity: ['保持罗盘方向'],
              textPolicy: 'no_text',
              negativeConstraints: ['无文字'],
            },
          },
        },
      },
    })
    const prompt = compilePanelVideoPrompt(spec, 'zh')

    expect(spec.visualContract.primarySubject).toBe('黄铜罗盘')
    expect(spec.secondaryMotion).toEqual([])
    expect(prompt).toContain('继承画面合同：主体：黄铜罗盘')
    expect(prompt).toContain('主体主运动：罗盘指针缓慢转动')
    expect(prompt).not.toContain('这段长描述不应被当作静态画面合同重复输出')
  })
})

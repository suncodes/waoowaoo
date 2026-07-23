import { describe, expect, it } from 'vitest'
import { reviewPromptSnapshotQuality } from '@/lib/creative-quality/prompt-review'

describe('prompt snapshot quality review', () => {
  it('passes a complete panel image prompt snapshot', () => {
    const review = reviewPromptSnapshotQuality({
      reviewedAt: '2026-07-23T00:00:00.000Z',
      snapshot: {
        artifactId: 'artifact-1',
        artifactType: 'prompt.panel_image.snapshot',
        refId: 'panel-1',
        payload: {
          snapshotType: 'panel_image_prompt',
          targetId: 'panel-1',
          promptHash: 'prompt-hash',
          specHash: 'spec-hash',
          inputHash: 'input-hash',
          referenceImages: ['character.png'],
          promptSpec: {
            narrativeIntent: '展示角色做出不可逆选择',
            primarySubject: '黄铜钥匙',
            actionState: '钥匙停在锁孔前的关键瞬间',
            environment: '狭窄金属走廊和保险库门',
            spatialLayout: '角色在左前景，保险库门在背景',
            composition: { shotType: 'close-up' },
            lightingAndColor: '硬侧光照亮钥匙边缘',
            styleAndTexture: '电影感墨线插画',
            negativeConstraints: ['无文字', '无水印'],
          },
          compiledPrompt: [
            '镜头类型和构图：close-up，角色在左前景，保险库门在背景。',
            '主体和资产引用：黄铜钥匙，角色身份保持一致。',
            '当前动作状态：钥匙停在锁孔前的关键瞬间。',
            '场景与空间关系：狭窄金属走廊和保险库门，前中后景明确。',
            '光线与色彩：硬侧光照亮钥匙边缘，暗部保留层次。',
            '项目风格和质感：电影感墨线插画。',
            '画质要求：主体清晰，构图稳定，空间层次明确。',
            '禁止项：无文字；无水印；无标志；无多格拼图。',
          ].join('\n'),
        },
      },
    })

    expect(review).toMatchObject({
      targetId: 'panel-1',
      targetType: 'panel',
      reviewKind: 'prompt_snapshot',
      snapshotType: 'panel_image_prompt',
      status: 'passed',
      route: 'NONE',
      artifactId: 'artifact-1',
    })
  })

  it('routes incomplete prompt snapshots to prompt recompilation', () => {
    const review = reviewPromptSnapshotQuality({
      snapshot: {
        artifactId: 'artifact-2',
        artifactType: 'prompt.panel_image.snapshot',
        refId: 'panel-2',
        payload: {
          snapshotType: 'panel_image_prompt',
          targetId: 'panel-2',
          promptSpec: { primarySubject: '船长' },
          compiledPrompt: '船长，电影感。',
        },
      },
    })

    expect(review.status).toBe('human_required')
    expect(review.route).toBe('PROMPT_RECOMPILE')
    expect(review.criticalIssues).toEqual(expect.arrayContaining([
      expect.stringContaining('promptSpec 缺少 narrativeIntent'),
      expect.stringContaining('缺少 prompt/spec/input hash'),
    ]))
    expect(review.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('compiledPrompt 过短'),
      expect.stringContaining('compiledPrompt 未体现明确禁止项'),
    ]))
  })
})

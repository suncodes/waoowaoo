import { describe, expect, it } from 'vitest'
import { CHARACTER_PROMPT_SUFFIX, PROP_PROMPT_SUFFIX } from '@/lib/constants'
import {
  ASSET_PROMPT_TEMPLATE_ID,
  buildAssetImageGenerationSnapshot,
  buildAssetPromptSpec,
  compileAssetImagePrompt,
} from '@/lib/prompt-compiler/asset-prompt-compiler'

describe('asset image prompt compiler', () => {
  it('keeps character identity locks and terminal constraints after style text', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'appearance-1',
      assetKind: 'character',
      assetName: '尼摩船长',
      description: '中年男性，深色船长制服，银灰鬓角，神情冷峻',
      variantLabel: '船长形态',
      styleText: '真人电影感，35mm 镜头，低调硬光',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(spec.identityLocks).toEqual(expect.arrayContaining(['尼摩船长', '船长形态']))
    expect(prompt).toContain('项目风格作用范围：真人电影感')
    expect(prompt).toContain('身份不变量：尼摩船长')
    expect(prompt.endsWith(CHARACTER_PROMPT_SUFFIX)).toBe(true)
    expect(prompt.indexOf('真人电影感')).toBeLessThan(prompt.indexOf(CHARACTER_PROMPT_SUFFIX))
  })

  it('compiles generic prop prompts as isolated reference sheets', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'prop-1',
      assetKind: 'prop',
      assetName: '黄铜钥匙',
      description: '旧黄铜材质，方形齿纹，顶部有圆形孔洞，表面有磨损痕迹',
      styleText: '十九世纪幻想工业风',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(spec.renderPurpose).toBe('reference_sheet')
    expect(spec.semanticType).toBe('tool')
    expect(spec.templateKind).toBe('prop_turnaround')
    expect(spec.keyParts).toEqual(expect.arrayContaining(['方形齿纹', '顶部有圆形孔洞']))
    expect(prompt).toContain('单一道具设定图')
    expect(prompt.endsWith(PROP_PROMPT_SUFFIX)).toBe(true)
    expect(prompt.indexOf('十九世纪幻想工业风')).toBeLessThan(prompt.indexOf(PROP_PROMPT_SUFFIX))
  })

  it('routes vehicle props to a vehicle turnaround template', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'vehicle-1',
      assetKind: 'prop',
      assetName: '深海潜艇',
      description: '长梭形暗铜金属船体，圆形舷窗，船首撞角，表面有海水侵蚀痕迹',
      styleText: '十九世纪幻想工业风',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(spec.semanticType).toBe('vehicle')
    expect(spec.templateKind).toBe('vehicle_turnaround')
    expect(prompt).toContain('载具设定图')
    expect(prompt).toContain('头尾方向明确')
    expect(prompt.endsWith(PROP_PROMPT_SUFFIX)).toBe(true)
  })

  it('treats book assets as blank clean plates instead of rendered title art', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'book-1',
      assetKind: 'prop',
      assetName: '《示例小说》书封',
      description: '一本深色硬壳书，封面中央有抽象海浪纹理，边缘有银色压纹',
      semanticType: 'book',
      styleText: '电影感棚拍',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(spec.templateKind).toBe('book_clean_plate')
    expect(spec.identityLocks).not.toContain('《示例小说》书封')
    expect(prompt).toContain('资产名称只是内部标签，不得画入图像')
    expect(prompt).toContain('禁止书名、作者名、可读字母')
    expect(prompt.endsWith(PROP_PROMPT_SUFFIX)).toBe(true)
  })

  it('keeps location spatial slots and negative constraints in the compiled prompt', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'location-image-1',
      assetKind: 'location',
      assetName: '雨夜街道',
      description: '潮湿反光的老街，青石路面，街灯昏黄',
      styleText: '新国风动画风格',
      availableSlotsRaw: JSON.stringify(['街道左侧靠墙的留白位置']),
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(spec.availableSlots).toEqual(['街道左侧靠墙的留白位置'])
    expect(prompt).toContain('可站位置：')
    expect(prompt).toContain('街道左侧靠墙的留白位置')
    expect(prompt).toContain('禁止项：禁止文字、水印')
    expect(prompt.trim().endsWith('。')).toBe(true)
  })

  it('builds stable hashes for asset image generation snapshots', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'prop-1',
      assetKind: 'prop',
      assetName: '深海潜艇',
      description: '暗铜金属潜艇',
      styleText: '电影 CG',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })
    const first = buildAssetImageGenerationSnapshot({
      targetType: 'LocationImage',
      targetId: 'prop-render-1',
      modelKey: 'image::asset',
      promptTemplateId: ASSET_PROMPT_TEMPLATE_ID,
      referenceImages: ['style-ref.png'],
      promptSpec: spec,
      compiledPrompt: prompt,
      assetVersionHash: 'asset-version',
    })
    const second = buildAssetImageGenerationSnapshot({
      targetType: 'LocationImage',
      targetId: 'prop-render-1',
      modelKey: 'image::asset',
      promptTemplateId: ASSET_PROMPT_TEMPLATE_ID,
      referenceImages: ['style-ref.png'],
      promptSpec: spec,
      compiledPrompt: prompt,
      assetVersionHash: 'asset-version',
    })

    expect(second.promptHash).toBe(first.promptHash)
    expect(second.specHash).toBe(first.specHash)
    expect(second.inputHash).toBe(first.inputHash)
  })
})

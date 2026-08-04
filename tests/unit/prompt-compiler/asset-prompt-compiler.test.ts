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

  it('emits an unstructured source once as a fallback visual feature', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'appearance-2',
      assetKind: 'character',
      assetName: '尼摩船长',
      description: '中年男性，深色船长制服，银灰鬓角，神情冷峻',
      styleText: '真人电影感，35mm 镜头，低调硬光',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(prompt).toContain('视觉特征：中年男性，深色船长制服，银灰鬓角，神情冷峻')
    expect(prompt).not.toContain('形体轮廓：')
    expect(prompt).not.toContain('材质纹理：')
    expect(prompt).not.toContain('颜色与关键部件：')
    expect(prompt.match(/中年男性/g)).toHaveLength(1)
    expect(spec.sourceEvidence).toEqual(['中年男性，深色船长制服，银灰鬓角，神情冷峻'])
  })

  it('compiles generic prop prompts as isolated reference sheets', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'prop-1',
      assetKind: 'prop',
      assetName: '黄铜钥匙',
      description: '旧黄铜材质，方形齿纹，顶部有圆形孔洞，表面有磨损痕迹',
      extractedFacts: {
        silhouetteLocks: ['细长钥匙轮廓'],
        costumeOrMaterialLocks: ['旧黄铜材质，表面有磨损痕迹'],
        colorLocks: ['暗金色'],
        keyPartLocks: ['方形齿纹', '顶部有圆形孔洞'],
      },
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

  it('uses a single-object contract for non-directional props without a character turnaround', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'prop-amorphous-1',
      assetKind: 'prop',
      assetName: '抽象飞行道具',
      description: '蓬松流动的云雾形飞行道具，是核心标志性道具',
      semanticType: 'symbol',
      extractedFacts: {
        silhouetteLocks: ['蓬松流动的云雾轮廓'],
        costumeOrMaterialLocks: ['轻盈云雾材质'],
        physicalForm: 'amorphous',
        orientation: 'non_directional',
      },
      styleText: '传统二维手绘动画',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(spec.templateKind).toBe('prop_single_reference')
    expect(spec.renderContract).toMatchObject({
      subjectPolicy: 'object_only',
      physicalForm: 'amorphous',
      requiresTurnaround: false,
    })
    expect(prompt).toContain('单一道具完整居中展示')
    expect(prompt).toContain('不使用角色转面、正侧背多视图')
    expect(prompt).not.toContain(PROP_PROMPT_SUFFIX)
    expect(prompt).not.toContain('语义类型：symbol')
  })

  it('prioritizes profile visual locks and excludes narrative relations from the final prompt', () => {
    const spec = buildAssetPromptSpec({
      assetId: 'appearance-tang-seng',
      assetKind: 'character',
      assetName: '唐僧',
      description: '唐僧与孙悟空在流沙河边争论取经路线。',
      profileData: {
        identity_locks: ['青年僧人，温和坚定的气质'],
        silhouette_locks: ['清瘦修长体态，光头，长脸'],
        costume_locks: ['朴素僧袍，外披锦襕袈裟'],
        color_locks: ['米白僧袍，朱红袈裟边饰'],
        primary_identifier: '九环锡杖与佛珠',
      },
      styleText: '新国风电影感',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(spec.shapeAndSilhouette).toEqual(['清瘦修长体态，光头，长脸'])
    expect(spec.materialAndTexture).toEqual(['朴素僧袍，外披锦襕袈裟'])
    expect(spec.colorPalette).toEqual(['米白僧袍，朱红袈裟边饰'])
    expect(spec.keyParts).toEqual(['九环锡杖与佛珠'])
    expect(prompt).toContain('青年僧人，温和坚定的气质')
    expect(prompt).toContain('清瘦修长体态，光头，长脸')
    expect(prompt).toContain('九环锡杖与佛珠')
    expect(prompt).not.toContain('孙悟空在流沙河边')
  })

  it('does not leak a raw JSON source into the compiled prompt', () => {
    const rawDescription = JSON.stringify({
      id: '4be4c9ba-70d9-4c2e-9a10-7a83a36ff891',
      task_status: 'completed',
      description: '磨损黄铜钥匙',
    })
    const spec = buildAssetPromptSpec({
      assetId: 'prop-json-source',
      assetKind: 'prop',
      assetName: '黄铜钥匙',
      description: rawDescription,
      styleText: '电影感棚拍',
      locale: 'zh',
    })
    const prompt = compileAssetImagePrompt({ spec, locale: 'zh' })

    expect(spec.visualContract.validationIssues).toContain('NON_RENDERABLE_SOURCE_DESCRIPTION')
    expect(prompt).not.toContain('task_status')
    expect(prompt).not.toContain('4be4c9ba-70d9-4c2e-9a10-7a83a36ff891')
    expect(prompt).not.toContain(rawDescription)
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
    expect(prompt).toContain('书本干净底图，只展示一本实体书或空白封面表面')
    expect(prompt).not.toContain(PROP_PROMPT_SUFFIX)
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

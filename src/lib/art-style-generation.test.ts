import { describe, expect, it } from 'vitest'
import { resolveArtStyleForGeneration } from './art-style-generation'

describe('resolveArtStyleForGeneration', () => {
  it('resolves preset style prompt and reference image', () => {
    const result = resolveArtStyleForGeneration({
      artStyleMode: 'preset',
      artStyle: 'paper-cut-3d',
      artStyleReferenceEnabled: true,
      locale: 'zh',
    })

    expect(result.source).toBe('preset')
    expect(result.prompt).toContain('纸雕')
    expect(result.referenceImage).toBe('/art-styles/paper-cut-3d.jpg')
    expect(result.referenceInstruction).toContain('参考图 1')
  })

  it('resolves custom style prompt and storage reference image', () => {
    const result = resolveArtStyleForGeneration({
      artStyleMode: 'custom',
      artStyle: 'paper-cut-3d',
      artStylePrompt: '粗颗粒复古动画风格',
      customArtStyleReferenceImage: 'images/custom-style.jpg',
      artStyleReferenceEnabled: true,
      locale: 'zh',
    })

    expect(result.source).toBe('custom')
    expect(result.prompt).toBe('粗颗粒复古动画风格')
    expect(result.referenceImage).toBe('images/custom-style.jpg')
    expect(result.referenceInstruction).toContain('参考图 1')
  })

  it('keeps custom prompt but disables custom reference image instruction when reference is off', () => {
    const result = resolveArtStyleForGeneration({
      artStyleMode: 'custom',
      artStylePrompt: '低饱和黑白漫画风格',
      customArtStyleReferenceImage: 'images/custom-style.jpg',
      artStyleReferenceEnabled: false,
      locale: 'zh',
    })

    expect(result.prompt).toBe('低饱和黑白漫画风格')
    expect(result.referenceImage).toBe('images/custom-style.jpg')
    expect(result.referenceEnabled).toBe(false)
    expect(result.referenceInstruction).toBe('')
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ART_STYLES,
  DEFAULT_ART_STYLE,
  DEFAULT_VIDEO_RATIO,
  appendArtStyleReferenceImage,
  getArtStylePrompt,
  getArtStyleReferenceInstruction,
  isArtStyleValue,
  prependStyleReferenceImage,
} from './constants'

describe('creation defaults', () => {
  it('uses landscape 16:9 and Shanghai Animation Film Studio style', () => {
    expect(DEFAULT_VIDEO_RATIO).toBe('16:9')
    expect(DEFAULT_ART_STYLE).toBe('classic-shanghai-animation')
    expect(isArtStyleValue(DEFAULT_ART_STYLE)).toBe(true)
  })
})

describe('ART_STYLES registry', () => {
  it('has unique values and non-empty prompts', () => {
    const values = ART_STYLES.map((style) => style.value)
    expect(new Set(values).size).toBe(values.length)

    for (const style of ART_STYLES) {
      expect(style.promptZh.trim().length).toBeGreaterThan(0)
      expect(style.promptEn.trim().length).toBeGreaterThan(0)
      expect(isArtStyleValue(style.value)).toBe(true)
    }
  })

  it('keeps style asset references under public/art-styles', () => {
    for (const style of ART_STYLES) {
      for (const source of [style.previewImage, style.referenceImage]) {
        if (!source) continue
        expect(source.startsWith('/art-styles/')).toBe(true)
        const filename = source.replace('/art-styles/', '')
        const filePath = path.join(process.cwd(), 'public', 'art-styles', filename)
        expect(fs.existsSync(filePath), `${style.value} asset missing: ${source}`).toBe(true)
      }
    }
  })

  it('places style reference image before semantic references', () => {
    const references = appendArtStyleReferenceImage(['images/character.png'], 'paper-cut-3d')
    expect(references).toEqual(['/art-styles/paper-cut-3d.jpg', 'images/character.png'])
  })

  it('does not append style reference image when disabled', () => {
    const references = appendArtStyleReferenceImage(['images/character.png'], 'paper-cut-3d', false)
    expect(references).toEqual(['images/character.png'])
  })

  it('keeps a single style reference image when semantic references already contain it', () => {
    const references = appendArtStyleReferenceImage([
      'images/character.png',
      '/art-styles/paper-cut-3d.jpg',
    ], 'paper-cut-3d')
    expect(references).toEqual(['/art-styles/paper-cut-3d.jpg', 'images/character.png'])
  })

  it('places custom style reference image before semantic references', () => {
    const references = prependStyleReferenceImage(['images/character.png'], 'images/custom-style.png')
    expect(references).toEqual(['images/custom-style.png', 'images/character.png'])
  })

  it('returns style reference instruction only when a valid style image is enabled', () => {
    expect(getArtStyleReferenceInstruction('paper-cut-3d', true, 'zh')).toContain('视觉风格参考图')
    expect(getArtStyleReferenceInstruction('paper-cut-3d', true, 'en')).toContain('visual style reference')
    expect(getArtStyleReferenceInstruction('paper-cut-3d', false, 'zh')).toBe('')
    expect(getArtStyleReferenceInstruction('unknown-style', true, 'zh')).toBe('')
  })

  it('returns localized prompt text', () => {
    expect(getArtStylePrompt('american-comic', 'zh')).toContain('美式漫画')
    expect(getArtStylePrompt('american-comic', 'en')).toContain('American comic')
  })
})

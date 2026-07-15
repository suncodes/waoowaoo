import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ART_STYLES, appendArtStyleReferenceImage, getArtStylePrompt, isArtStyleValue } from './constants'

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

  it('appends style reference image after semantic references', () => {
    const references = appendArtStyleReferenceImage(['images/character.png'], 'paper-cut-3d')
    expect(references).toEqual(['images/character.png', '/art-styles/paper-cut-3d.jpg'])
  })

  it('returns localized prompt text', () => {
    expect(getArtStylePrompt('american-comic', 'zh')).toContain('美式漫画')
    expect(getArtStylePrompt('american-comic', 'en')).toContain('American comic')
  })
})

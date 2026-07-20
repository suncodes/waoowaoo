import { describe, expect, it } from 'vitest'
import { isLikelyBookTitleInput, resolveBookGuideSeed } from '@/lib/book-guide/seed'

describe('book guide seed', () => {
  it('detects a short classic title input', () => {
    const seed = resolveBookGuideSeed('《海底两万里》')

    expect(seed).toEqual(expect.objectContaining({
      title: '海底两万里',
      sourceMode: 'model_knowledge',
      isClassicCandidate: true,
    }))
  })

  it('does not treat long source text as a book title', () => {
    const text = '第一章\n这是一个较长的正文段落，用来表示用户已经提供了可处理的来源材料。\n第二章\n这里继续展开具体内容。'

    expect(isLikelyBookTitleInput(text)).toBe(false)
    expect(resolveBookGuideSeed(text)).toBeNull()
  })
})

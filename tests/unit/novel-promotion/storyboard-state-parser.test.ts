import { describe, expect, it } from 'vitest'
import { parsePanelCharacters } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardState'

describe('storyboard state parser', () => {
  it('reads legacy string-array panel characters', () => {
    expect(parsePanelCharacters(JSON.stringify(['角色甲', '角色乙']))).toEqual([
      { name: '角色甲', appearance: '' },
      { name: '角色乙', appearance: '' },
    ])
  })

  it('reads object-array panel characters with appearance fallback', () => {
    expect(parsePanelCharacters(JSON.stringify([
      { name: '角色甲', changeReason: '雨夜形象', slot: '画面左侧' },
    ]))).toEqual([
      { name: '角色甲', appearance: '雨夜形象', slot: '画面左侧' },
    ])
  })
})

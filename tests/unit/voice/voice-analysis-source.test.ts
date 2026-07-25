import { describe, expect, it } from 'vitest'
import { resolveVoiceAnalysisSource } from '@/lib/voice/voice-analysis-source'

describe('resolveVoiceAnalysisSource', () => {
  it('prefers approved guide narration over original novel text', () => {
    const source = resolveVoiceAnalysisSource({
      contentPlan: {
        planType: 'guide',
        segments: [
          { title: '开场', narration: '这是最终导读成稿。' },
          { title: '转折', narration: '第二段继续解释主题。' },
        ],
      },
      novelText: '这是原始小说文本，不应优先用于配音分析。',
    })

    expect(source.sourceType).toBe('guide_content_plan')
    expect(source.text).toContain('这是最终导读成稿。')
    expect(source.text).not.toContain('这是原始小说文本')
    expect(source.unitCount).toBe(2)
  })

  it('uses clip screenplay before narrative outline and novel text', () => {
    const source = resolveVoiceAnalysisSource({
      contentPlan: {
        planType: 'narrative',
        beats: [{ title: '节拍', summary: '这里只是剧情节拍。' }],
      },
      clips: [
        {
          screenplay: JSON.stringify([
            { type: 'voiceover', text: '这是剧本旁白。' },
            { type: 'dialogue', speaker: '主角', text: '这是角色台词。' },
          ]),
        },
      ],
      novelText: '原文',
    })

    expect(source.sourceType).toBe('clips')
    expect(source.text).toContain('这是剧本旁白。')
    expect(source.text).toContain('这是角色台词。')
    expect(source.text).not.toContain('这里只是剧情节拍。')
  })

  it('falls back to storyboard text before original novel text', () => {
    const source = resolveVoiceAnalysisSource({
      storyboards: [
        {
          panels: [
            { panelIndex: 1, srtSegment: '第二镜旁白。' },
            { panelIndex: 0, srtSegment: '第一镜旁白。' },
          ],
        },
      ],
      novelText: '原文',
    })

    expect(source.sourceType).toBe('storyboards')
    expect(source.text).toBe('第一镜旁白。\n\n第二镜旁白。')
  })

  it('uses novel text only as the final fallback', () => {
    const source = resolveVoiceAnalysisSource({ novelText: '只有原文。' })

    expect(source.sourceType).toBe('novel_text')
    expect(source.text).toBe('只有原文。')
  })
})

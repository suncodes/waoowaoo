import { describe, expect, it } from 'vitest'
import { parseScreenplayPayload } from '@/lib/workers/handlers/screenplay-convert-helpers'

describe('screenplay convert helpers', () => {
  it('keeps professional voiceover and visual beat fields from screenplay JSON', () => {
    const payload = parseScreenplayPayload(JSON.stringify({
      promotion_voiceover: {
        opening_line: '她以为门后是答案。',
        core_promise: '看清这次选择的代价',
        voice_intent: '反差推进',
        source_boundary: '不新增原文外事实',
        lines: [{
          role: 'opening_question',
          text: '她以为门后是答案。',
          source: 'interpretation',
          visualBeat: '门前停顿',
        }],
      },
      emotion_curve: ['疑问', '压力'],
      visual_beats: [{
        id: 'visual_1',
        purpose: '建立悬念',
        subject: '旧门',
        actionState: '门保持关闭',
        sourceText: '她停在门前。',
      }],
      scenes: [{ scene_number: 1, description: '她停在门前。' }],
    }))

    expect(payload.promotion_voiceover).toMatchObject({
      opening_line: '她以为门后是答案。',
      source_boundary: '不新增原文外事实',
    })
    expect(payload.emotion_curve).toEqual(['疑问', '压力'])
    expect(payload.visual_beats).toEqual([expect.objectContaining({ id: 'visual_1', subject: '旧门' })])
  })

  it('adds conservative fallback fields for legacy screenplay JSON', () => {
    const payload = parseScreenplayPayload(JSON.stringify({
      scenes: [{
        scene_number: 1,
        description: '雨夜街口。',
        content: [{ type: 'action', text: '主角停下脚步。' }],
      }],
    }))

    expect(payload.promotion_voiceover).toMatchObject({
      opening_line: '雨夜街口。 主角停下脚步。',
      source_boundary: '不得新增原文没有的事件、对话、角色反应或事实判断。',
    })
    expect(payload.visual_beats).toEqual([
      expect.objectContaining({
        id: 'visual_1',
        purpose: '将当前场景转化为单一可执行画面',
      }),
    ])
  })
})

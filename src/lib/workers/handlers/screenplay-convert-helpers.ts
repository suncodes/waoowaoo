import { safeParseJsonObject } from '@/lib/json-repair'

export type AnyObj = Record<string, unknown>

export function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): AnyObj | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyObj
    : null
}

function optionalText(value: unknown): string | undefined {
  const text = readText(value).trim()
  return text ? text : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = optionalText(item)
    return text ? [text] : []
  })
}

function compactText(value: unknown, maxLength = 160): string {
  const text = readText(value).replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function readSceneText(scene: unknown): string {
  const record = asRecord(scene)
  if (!record) return ''
  const content = Array.isArray(record.content)
    ? record.content.flatMap((item) => {
        const contentItem = asRecord(item)
        if (!contentItem) return []
        return [
          readText(contentItem.text),
          readText(contentItem.lines),
        ].filter(Boolean)
      }).join(' ')
    : ''
  return compactText([
    readText(record.description),
    content,
  ].filter(Boolean).join(' '))
}

function normalizeVoiceoverLines(value: unknown): AnyObj[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index): AnyObj[] => {
    const record = asRecord(item)
    if (!record) return []
    const text = optionalText(record.text)
    if (!text) return []
    return [{
      role: optionalText(record.role) || (index === 0 ? 'opening_question' : 'setup'),
      text,
      source: optionalText(record.source) || 'original',
      visualBeat: optionalText(record.visualBeat) || '',
    }]
  })
}

function normalizePromotionVoiceover(value: unknown, scenes: unknown[]): AnyObj {
  const record = asRecord(value) || {}
  const fallbackText = scenes.map(readSceneText).find(Boolean) || ''
  const parsedLines = normalizeVoiceoverLines(record.lines)
  const lines = parsedLines.length > 0
    ? parsedLines
    : fallbackText
      ? [{
          role: 'setup',
          text: fallbackText,
          source: 'original',
          visualBeat: fallbackText,
        }]
      : []
  return {
    opening_line: optionalText(record.opening_line) || lines[0]?.text || fallbackText,
    core_promise: optionalText(record.core_promise) || '',
    voice_intent: optionalText(record.voice_intent) || '保留原文事实，只优化为更适合短视频配音的表达节奏。',
    source_boundary: optionalText(record.source_boundary) || '不得新增原文没有的事件、对话、角色反应或事实判断。',
    lines,
  }
}

function normalizeVisualBeats(value: unknown, scenes: unknown[]): AnyObj[] {
  if (Array.isArray(value)) {
    const beats = value.flatMap((item, index): AnyObj[] => {
      const record = asRecord(item)
      if (!record) return []
      const purpose = optionalText(record.purpose)
      const subject = optionalText(record.subject)
      const actionState = optionalText(record.actionState)
      if (!purpose && !subject && !actionState) return []
      return [{
        id: optionalText(record.id) || `visual_${index + 1}`,
        purpose: purpose || '承载当前原文信息',
        subject: subject || '当前片段主体',
        actionState: actionState || '原文明确描述的静态或单一动作状态',
        sourceText: optionalText(record.sourceText) || '',
      }]
    })
    if (beats.length > 0) return beats
  }
  return scenes.flatMap((scene, index): AnyObj[] => {
    const text = readSceneText(scene)
    if (!text) return []
    return [{
      id: `visual_${index + 1}`,
      purpose: '将当前场景转化为单一可执行画面',
      subject: text,
      actionState: text,
      sourceText: text,
    }]
  })
}

function normalizeScreenplayPayload(parsed: AnyObj): AnyObj {
  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : []
  return {
    ...parsed,
    scenes,
    promotion_voiceover: normalizePromotionVoiceover(parsed.promotion_voiceover, scenes),
    emotion_curve: stringArray(parsed.emotion_curve),
    visual_beats: normalizeVisualBeats(parsed.visual_beats, scenes),
  }
}

export function parseScreenplayPayload(responseText: string): AnyObj {
  const parsed = safeParseJsonObject(responseText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI returned invalid screenplay JSON object')
  }
  return normalizeScreenplayPayload(parsed as AnyObj)
}


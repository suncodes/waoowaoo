export type BookGuideSourceMode = 'model_knowledge' | 'verified_source' | 'user_source'

export interface BookGuideSeed {
  title: string
  author?: string
  aliases: string[]
  language?: string
  isClassicCandidate: boolean
  confidence: number
  sourceMode: BookGuideSourceMode
  summaryBasis: string
  risks: string[]
}

const CJK_BOOK_TITLE_PATTERN = /^《([^《》\r\n]{1,80})》$/
const LATIN_BOOK_TITLE_PATTERN = /^["“]?([A-Za-z0-9][A-Za-z0-9\s:'’.,!?()-]{1,100})["”]?$/
const LONG_SOURCE_MIN_LENGTH = 120
const LONG_SOURCE_LINE_THRESHOLD = 3

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripBookTitleMarks(value: string): string {
  const cjk = value.match(CJK_BOOK_TITLE_PATTERN)
  if (cjk?.[1]) return cjk[1].trim()
  return value.replace(/^["“]/, '').replace(/["”]$/, '').trim()
}

function hasLongSourceShape(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed.length >= LONG_SOURCE_MIN_LENGTH) return true
  const nonEmptyLineCount = trimmed.split(/\r?\n/).filter((line) => line.trim()).length
  return nonEmptyLineCount >= LONG_SOURCE_LINE_THRESHOLD
}

export function isLikelyBookTitleInput(input: string): boolean {
  const trimmed = normalizeSpace(input)
  if (!trimmed || hasLongSourceShape(input)) return false
  if (CJK_BOOK_TITLE_PATTERN.test(trimmed)) return true
  if (LATIN_BOOK_TITLE_PATTERN.test(trimmed)) return trimmed.split(' ').length <= 8
  return /^[\p{Script=Han}A-Za-z0-9\s:'’·.-]{2,80}$/u.test(trimmed)
}

export function resolveBookGuideSeed(input: string): BookGuideSeed | null {
  if (!isLikelyBookTitleInput(input)) return null
  const title = stripBookTitleMarks(normalizeSpace(input))
  if (!title) return null

  return {
    title,
    aliases: title === input.trim() ? [] : [input.trim()],
    isClassicCandidate: true,
    confidence: 0.66,
    sourceMode: 'model_knowledge',
    summaryBasis: '用户仅提供书名；系统将要求模型基于通用文学常识生成可编辑导读框架草稿。',
    risks: [
      '未接入外部资料校验',
      '不得生成逐字原文引用',
      '章节与细节需要用户确认',
    ],
  }
}

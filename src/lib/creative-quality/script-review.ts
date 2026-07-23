import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  type QualityReviewContract,
  type QualityReviewDimension,
} from '@/lib/creative-quality/contracts'

export interface ScriptReviewClipInput {
  id: string
  episodeId: string
  content?: string | null
  summary?: string | null
  screenplay?: string | null
}

export interface ScriptReviewVoiceLineInput {
  id: string
  episodeId: string
  lineIndex: number
  speaker?: string | null
  content: string
  matchedPanelId?: string | null
}

export interface ScriptReviewIssue {
  dimension: 'structure' | 'source' | 'voice' | 'visualization' | 'stability'
  severity: 'warning' | 'critical'
  targetType: 'episode' | 'clip' | 'voice_line'
  targetId: string
  message: string
}

export type ScriptReviewResult = QualityReviewContract & {
  targetType: 'script'
  reviewKind: 'script_draft'
  clipCount: number
  screenplayCount: number
  voiceLineCount: number
  issues: ScriptReviewIssue[]
  reviewedAt: string
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function readJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function collectText(value: unknown, limit = 30): string[] {
  const output: string[] = []
  const visit = (current: unknown) => {
    if (output.length >= limit) return
    if (typeof current === 'string' && current.trim()) {
      output.push(current.trim())
      return
    }
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (current && typeof current === 'object') {
      Object.values(current as Record<string, unknown>).forEach(visit)
    }
  }
  visit(value)
  return output
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, '')
}

function issue(params: ScriptReviewIssue): ScriptReviewIssue {
  return params
}

function reviewScreenplays(
  episodeId: string,
  clips: ScriptReviewClipInput[],
): { issues: ScriptReviewIssue[]; screenplayCount: number } {
  const issues: ScriptReviewIssue[] = []
  let screenplayCount = 0
  if (clips.length === 0) {
    issues.push(issue({
      dimension: 'structure',
      severity: 'critical',
      targetType: 'episode',
      targetId: episodeId,
      message: '缺少用于剧本转换的 clip',
    }))
    return { issues, screenplayCount }
  }

  for (const clip of clips) {
    if (!hasText(clip.screenplay)) {
      issues.push(issue({
        dimension: 'structure',
        severity: 'critical',
        targetType: 'clip',
        targetId: clip.id,
        message: 'clip 缺少 screenplay JSON',
      }))
      continue
    }
    screenplayCount += 1
    const screenplay = readJsonObject(clip.screenplay!)
    if (!screenplay) {
      issues.push(issue({
        dimension: 'structure',
        severity: 'critical',
        targetType: 'clip',
        targetId: clip.id,
        message: 'screenplay 不是合法 JSON 对象',
      }))
      continue
    }
    const scenes = Array.isArray(screenplay.scenes) ? screenplay.scenes : []
    const textUnits = collectText(screenplay)
    if (scenes.length === 0 && textUnits.length < 4) {
      issues.push(issue({
        dimension: 'structure',
        severity: 'warning',
        targetType: 'clip',
        targetId: clip.id,
        message: 'screenplay 缺少 scenes 或足够的可执行文本单元',
      }))
    }
    if (hasText(clip.content) && !hasText(screenplay.original_text) && !hasText(screenplay.source_text)) {
      issues.push(issue({
        dimension: 'source',
        severity: 'warning',
        targetType: 'clip',
        targetId: clip.id,
        message: 'screenplay 缺少原文或来源文本引用',
      }))
    }
    const visualText = textUnits.join('\n')
    if (!/(景|镜头|画面|场景|动作|表情|看到|站|走|看|光|门|窗|voice|scene|shot|camera|action)/i.test(visualText)) {
      issues.push(issue({
        dimension: 'visualization',
        severity: 'warning',
        targetType: 'clip',
        targetId: clip.id,
        message: 'screenplay 可视化线索偏弱，后续分镜可能只能复述文字',
      }))
    }
  }
  return { issues, screenplayCount }
}

function sentenceRisk(content: string): string | null {
  const compact = normalized(content)
  if (compact.length > 90) return '单条口播过长，建议拆成更短句'
  if (compact.length < 4) return '单条口播过短，信息量不足'
  if (compact.length > 45 && !/[，。！？；,.!?;]/.test(content)) return '长句缺少自然停顿'
  return null
}

function reviewVoiceLines(
  episodeId: string,
  voiceLines: ScriptReviewVoiceLineInput[],
): ScriptReviewIssue[] {
  const issues: ScriptReviewIssue[] = []
  if (voiceLines.length === 0) {
    issues.push(issue({
      dimension: 'voice',
      severity: 'critical',
      targetType: 'episode',
      targetId: episodeId,
      message: '缺少可配音文稿 voiceLines',
    }))
    return issues
  }

  const seen = new Map<string, string>()
  for (const line of voiceLines) {
    const content = stringValue(line.content)
    const risk = sentenceRisk(content)
    if (risk) {
      issues.push(issue({
        dimension: 'voice',
        severity: content.length > 90 ? 'critical' : 'warning',
        targetType: 'voice_line',
        targetId: line.id,
        message: risk,
      }))
    }
    const key = normalized(content)
    const existing = seen.get(key)
    if (key && existing) {
      issues.push(issue({
        dimension: 'stability',
        severity: 'warning',
        targetType: 'voice_line',
        targetId: line.id,
        message: `口播内容与 ${existing} 重复`,
      }))
    }
    if (key) seen.set(key, line.id)
    if (!hasText(line.matchedPanelId)) {
      issues.push(issue({
        dimension: 'visualization',
        severity: 'warning',
        targetType: 'voice_line',
        targetId: line.id,
        message: '口播行尚未匹配分镜，画面承接风险较高',
      }))
    }
  }
  return issues
}

function uniqueIssues(issues: ScriptReviewIssue[]): ScriptReviewIssue[] {
  const seen = new Set<string>()
  return issues.filter((item) => {
    const key = `${item.dimension}:${item.severity}:${item.targetType}:${item.targetId}:${item.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dimension(name: ScriptReviewIssue['dimension'], issues: ScriptReviewIssue[], penalty: number): QualityReviewDimension {
  const matched = issues.filter((item) => item.dimension === name)
  const critical = matched.filter((item) => item.severity === 'critical').length
  return {
    name,
    score: Math.max(0, 100 - matched.length * penalty - critical * penalty),
    issues: matched.map((item) => `${item.targetId}: ${item.message}`),
  }
}

function statusFrom(score: number, issues: ScriptReviewIssue[]): ScriptReviewResult['status'] {
  if (issues.some((item) => item.severity === 'critical')) return 'human_required'
  if (score >= 82) return 'passed'
  if (score >= 65) return 'repairable'
  return 'human_required'
}

export function reviewScriptDraftQuality(params: {
  episodeId: string
  clips: ScriptReviewClipInput[]
  voiceLines: ScriptReviewVoiceLineInput[]
  reviewedAt?: string
}): ScriptReviewResult {
  const screenplayReview = reviewScreenplays(params.episodeId, params.clips)
  const issues = uniqueIssues([
    ...screenplayReview.issues,
    ...reviewVoiceLines(params.episodeId, params.voiceLines),
  ])
  const dimensions = [
    dimension('structure', issues, 18),
    dimension('source', issues, 12),
    dimension('voice', issues, 14),
    dimension('visualization', issues, 10),
    dimension('stability', issues, 10),
  ]
  const score = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const status = statusFrom(score, issues)
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    targetId: params.episodeId,
    targetType: 'script',
    reviewKind: 'script_draft',
    specVersion: 'script-draft-review.v1',
    score,
    confidence: params.clips.length > 0 || params.voiceLines.length > 0 ? 0.82 : 0.65,
    status,
    dimensions,
    criticalIssues: issues.filter((item) => item.severity === 'critical').map((item) => item.message),
    route: status === 'passed' ? 'NONE' : 'SCRIPT_REVISE',
    evidence: issues.map((item) => `${item.targetId}: ${item.message}`),
    clipCount: params.clips.length,
    screenplayCount: screenplayReview.screenplayCount,
    voiceLineCount: params.voiceLines.length,
    issues,
    reviewedAt: params.reviewedAt || new Date().toISOString(),
  }
}

import { stripWorkspaceArtifactMeta } from '@/lib/creation-workspace/artifact-state'

type JsonRecord = Record<string, unknown>

export interface VoiceAnalysisClipLike {
  content?: string | null
  screenplay?: string | null
  summary?: string | null
}

export interface VoiceAnalysisPanelLike {
  panelIndex?: number | null
  srtSegment?: string | null
  onScreenText?: string | null
  description?: string | null
}

export interface VoiceAnalysisStoryboardLike {
  panels?: VoiceAnalysisPanelLike[] | null
}

export interface VoiceAnalysisSourceInput {
  contentPlan?: unknown
  clips?: VoiceAnalysisClipLike[] | null
  storyboards?: VoiceAnalysisStoryboardLike[] | null
  novelText?: string | null
}

export interface VoiceAnalysisSource {
  text: string
  sourceType: 'guide_content_plan' | 'clips' | 'narrative_content_plan' | 'storyboards' | 'novel_text'
  unitCount: number
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function compactLines(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).join('\n\n').trim()
}

function readableJsonText(value: unknown): string {
  if (typeof value === 'string') {
    const raw = value.trim()
    if (!raw) return ''
    try {
      return readableJsonText(JSON.parse(raw))
    } catch {
      return raw
    }
  }
  if (Array.isArray(value)) {
    return compactLines(value.map(readableJsonText))
  }
  const record = asRecord(value)
  if (!record) return ''
  const direct = [
    text(record.voiceover),
    text(record.voiceOver),
    text(record.narration),
    text(record.dialogue),
    text(record.line),
    text(record.text),
    text(record.content),
    text(record.action),
    text(record.description),
  ].filter(Boolean)
  const nested = Object.entries(record)
    .filter(([key]) => ![
      'id',
      'type',
      'speaker',
      'character',
      'characters',
      'location',
      'props',
      'duration',
      'start',
      'end',
    ].includes(key))
    .map(([, child]) => readableJsonText(child))
    .filter(Boolean)
  return compactLines([...direct, ...nested])
}

function buildGuideContentPlanSource(contentPlan: unknown): VoiceAnalysisSource | null {
  const plan = asRecord(stripWorkspaceArtifactMeta(contentPlan))
  if (plan?.planType !== 'guide' || !Array.isArray(plan.segments)) return null
  const lines = plan.segments.flatMap((item, index) => {
    const segment = asRecord(item)
    const narration = text(segment?.narration)
    if (!narration) return []
    const title = text(segment?.title) || `段落 ${index + 1}`
    return [`【${title}】\n${narration}`]
  })
  const source = compactLines(lines)
  return source ? { text: source, sourceType: 'guide_content_plan', unitCount: lines.length } : null
}

function buildNarrativeContentPlanSource(contentPlan: unknown): VoiceAnalysisSource | null {
  const plan = asRecord(stripWorkspaceArtifactMeta(contentPlan))
  if (plan?.planType !== 'narrative' || !Array.isArray(plan.beats)) return null
  const lines = plan.beats.flatMap((item, index) => {
    const beat = asRecord(item)
    const summary = text(beat?.summary) || text(beat?.purpose)
    if (!summary) return []
    const title = text(beat?.title) || `节拍 ${index + 1}`
    return [`【${title}】\n${summary}`]
  })
  const source = compactLines(lines)
  return source ? { text: source, sourceType: 'narrative_content_plan', unitCount: lines.length } : null
}

function buildClipSource(clips: VoiceAnalysisClipLike[] | null | undefined): VoiceAnalysisSource | null {
  const lines = (clips || []).flatMap((clip, index) => {
    const body = readableJsonText(clip.screenplay) || text(clip.content) || text(clip.summary)
    return body ? [`【片段 ${index + 1}】\n${body}`] : []
  })
  const source = compactLines(lines)
  return source ? { text: source, sourceType: 'clips', unitCount: lines.length } : null
}

function buildStoryboardSource(storyboards: VoiceAnalysisStoryboardLike[] | null | undefined): VoiceAnalysisSource | null {
  const lines: string[] = []
  for (const storyboard of storyboards || []) {
    const panels = [...(storyboard.panels || [])].sort((left, right) => (left.panelIndex ?? 0) - (right.panelIndex ?? 0))
    for (const panel of panels) {
      const body = text(panel.srtSegment) || text(panel.onScreenText) || text(panel.description)
      if (body) lines.push(body)
    }
  }
  const source = compactLines(lines)
  return source ? { text: source, sourceType: 'storyboards', unitCount: lines.length } : null
}

export function resolveVoiceAnalysisSource(input: VoiceAnalysisSourceInput): VoiceAnalysisSource {
  const source =
    buildGuideContentPlanSource(input.contentPlan)
    || buildClipSource(input.clips)
    || buildNarrativeContentPlanSource(input.contentPlan)
    || buildStoryboardSource(input.storyboards)
    || null
  if (source) return source

  const fallback = text(input.novelText)
  if (fallback) return { text: fallback, sourceType: 'novel_text', unitCount: 1 }
  throw new Error('No script text to analyze')
}

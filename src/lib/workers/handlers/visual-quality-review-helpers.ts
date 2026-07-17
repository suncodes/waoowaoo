import type {
  ImageQualityReviewResult,
  ImageTargetSpec,
  VisualQualityIssue,
  VisualTechnicalCheck,
} from '@/lib/visual-quality'

type PanelForQuality = {
  id: string
  description: string | null
  imagePrompt: string | null
  shotType: string | null
  cameraMove: string | null
  location: string | null
  characters: string | null
  props: string | null
  visualType: string | null
  renderMode: string | null
  onScreenText: string | null
  linkedToNextPanel: boolean
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item.trim()]
      if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        return [((item as { name: string }).name).trim()].filter(Boolean)
      }
      return []
    })
  } catch {
    return []
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function buildPanelImageTargetSpec(params: {
  panel: PanelForQuality
  aspectRatio: string
  artStyle: string
  productionBible: unknown
}): ImageTargetSpec {
  const bible = asRecord(params.productionBible)
  const visualStyle = typeof bible.visualStyle === 'string' ? bible.visualStyle : params.artStyle
  return {
    schemaVersion: 1,
    targetType: 'panel',
    targetId: params.panel.id,
    intent: params.panel.imagePrompt || params.panel.description || '',
    aspectRatio: params.aspectRatio,
    visualType: params.panel.visualType || 'illustration',
    renderMode: params.panel.renderMode || 'generated_image',
    shotType: params.panel.shotType || '',
    cameraMove: params.panel.cameraMove || '',
    location: params.panel.location || '',
    characters: parseStringArray(params.panel.characters),
    props: parseStringArray(params.panel.props),
    requiredText: params.panel.onScreenText || '',
    styleBaseline: visualStyle || params.artStyle,
    continuityRules: readStringArray(bible.continuityRules),
    forbiddenPatterns: readStringArray(bible.forbiddenPatterns),
    riskLevel: params.panel.linkedToNextPanel || params.panel.onScreenText ? 'high' : 'medium',
  }
}

export function readCandidateUrls(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function toReviewIssue(issue: VisualTechnicalCheck['issues'][number]): VisualQualityIssue {
  return {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    evidence: 'deterministic image inspection',
    repairHint: issue.code === 'ASPECT_RATIO_MISMATCH'
      ? 'regenerate with the target aspect ratio'
      : 'regenerate a readable candidate',
  }
}

export function mergeTechnicalChecks(
  review: ImageQualityReviewResult,
  checks: VisualTechnicalCheck[],
): ImageQualityReviewResult {
  const candidates = checks.map((check) => {
    const modelCandidate = review.candidates.find((item) => item.candidateIndex === check.candidateIndex)
    const technicalIssues = check.issues.map(toReviewIssue)
    const issues = [...(modelCandidate?.issues || []), ...technicalIssues]
    return {
      candidateIndex: check.candidateIndex,
      score: modelCandidate?.score ?? 0,
      confidence: modelCandidate?.confidence ?? 0.5,
      passed: modelCandidate?.passed === true && issues.length === 0,
      strengths: modelCandidate?.strengths || [],
      issues,
    }
  })
  const requested = review.selectedCandidateIndex === null
    ? null
    : candidates.find((item) => item.candidateIndex === review.selectedCandidateIndex) || null
  const selected = requested || [...candidates].sort((left, right) => right.score - left.score)[0] || null
  const issueCodes = Array.from(new Set(candidates.flatMap(
    (candidate) => candidate.issues.map((issue) => issue.code),
  )))
  const status = selected?.passed
    ? 'passed'
    : review.status === 'human_required' ? 'human_required' : 'repairable'
  return {
    ...review,
    status,
    selectedCandidateIndex: selected?.candidateIndex ?? null,
    score: selected?.score ?? review.score,
    confidence: selected?.confidence ?? review.confidence,
    candidates,
    issueCodes,
  }
}

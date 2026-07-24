import {
  VISUAL_REVIEW_PASS_MIN_SCORE,
  type ImageQualityReviewResult,
  type ImageTargetSpec,
  type VisualQualityIssue,
  type VisualTechnicalCheck,
} from '@/lib/visual-quality'
import {
  CHARACTER_ASSET_IMAGE_RATIO,
  LOCATION_IMAGE_RATIO,
  PROP_IMAGE_RATIO,
} from '@/lib/constants'
import {
  appendPanelTextPolicyForbiddenPatterns,
  resolvePanelTextPolicy,
} from '@/lib/visual-production/text-policy'
import {
  bindingPlanPromptGuidance,
  resolvePanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'

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
  sourceAnchor?: unknown
  photographyRules?: unknown
}

type CharacterAppearanceForQuality = {
  id: string
  changeReason: string | null
  description: string | null
  descriptions?: string | null
  character: {
    name: string
    introduction?: string | null
  }
}

type LocationImageForQuality = {
  id: string
  description: string | null
  availableSlots?: string | null
  location: {
    name: string
    summary?: string | null
    assetKind?: string | null
  }
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

function readFirstDescription(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return fallback
    const first = parsed.find((item) => typeof item === 'string' && item.trim())
    return typeof first === 'string' ? first.trim() : fallback
  } catch {
    return fallback
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function buildBindingQualityRules(bindingPlan: ReturnType<typeof resolvePanelAssetBindingPlan>): {
  continuityRules: string[]
  forbiddenPatterns: string[]
  forceHighRisk: boolean
} {
  const continuityRules: string[] = []
  const forbiddenPatterns: string[] = []
  let forceHighRisk = false
  for (const binding of bindingPlan.bindings) {
    if (binding.role === 'primary_identity') {
      forceHighRisk = true
      continuityRules.push(`${binding.name} 是主身份锁定资产，候选图必须匹配参考图的脸型/轮廓/服装/关键颜色。`)
    }
    if (binding.role === 'supporting_identity') {
      continuityRules.push(`${binding.name} 是可见辅助角色，出现时必须匹配参考图身份且不能抢主主体。`)
    }
    if (binding.role === 'prop_detail') {
      forceHighRisk = true
      continuityRules.push(`${binding.name} 是道具细节锁定资产，候选图必须匹配参考图的形体比例、材质、关键部件和颜色。`)
    }
    if (binding.role === 'cover_motif') {
      forceHighRisk = true
      continuityRules.push('书封/封面资产只用于无字底图或核心 motif，候选图不得生成书名、作者名、字母、数字、伪文字、徽标或条形码。')
      forbiddenPatterns.push('书名、作者名、可读文字、伪文字、字母、数字、徽标、条形码')
    }
    if (binding.role === 'environment') {
      continuityRules.push(`${binding.name} 是场景参考，候选图应延续空间结构、光色和材质，不应把场景当作贴图背景。`)
    }
  }
  if (bindingPlan.complexity.riskFlags.includes('text_prone_visual_type')) {
    forceHighRisk = true
    forbiddenPatterns.push('任何未要求的可读文字、字幕、标题、标签、水印或标志')
  }
  if (
    bindingPlan.complexity.riskFlags.includes('too_many_action_beats')
    || bindingPlan.complexity.riskFlags.includes('long_single_image_duration')
    || bindingPlan.complexity.recommendedAction === 'split'
  ) {
    forceHighRisk = true
    continuityRules.push('复杂镜头只能评审为单一关键帧；如果候选图包含多阶段动作、多场景、分屏或混剪，应判为 COMPOSITION_ERROR 或 SUBJECT_MISMATCH。')
    forbiddenPatterns.push('多阶段动作、多个时空、多场景同框、拼贴、分屏、混剪')
  }
  return {
    continuityRules,
    forbiddenPatterns,
    forceHighRisk,
  }
}

export function buildPanelImageTargetSpec(params: {
  panel: PanelForQuality
  aspectRatio: string
  artStyle: string
  productionBible: unknown
}): ImageTargetSpec {
  const bible = asRecord(params.productionBible)
  const visualStyle = typeof bible.visualStyle === 'string' ? bible.visualStyle : params.artStyle
  const textPolicy = resolvePanelTextPolicy({
    renderMode: params.panel.renderMode,
    onScreenText: params.panel.onScreenText,
  })
  const bindingPlan = resolvePanelAssetBindingPlan(params.panel)
  const referenceInstructions = bindingPlanPromptGuidance(bindingPlan)
  const bindingQualityRules = buildBindingQualityRules(bindingPlan)
  const boundCharacters = bindingPlan.bindings.filter((item) => item.kind === 'character').map((item) => item.name)
  const boundProps = bindingPlan.bindings.filter((item) => item.kind === 'prop').map((item) => item.name)
  const boundLocation = bindingPlan.bindings.find((item) => item.kind === 'location')?.name || params.panel.location || ''
  const riskLevel = params.panel.linkedToNextPanel
    || textPolicy.imageTextPolicy === 'safe_area_only'
    || bindingQualityRules.forceHighRisk
    || bindingPlan.complexity.level === 'high'
    ? 'high'
    : bindingPlan.complexity.level === 'medium' ? 'medium' : 'medium'
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
    location: boundLocation,
    characters: boundCharacters.length > 0 ? boundCharacters : parseStringArray(params.panel.characters),
    props: boundProps.length > 0 ? boundProps : parseStringArray(params.panel.props),
    requiredText: textPolicy.requiredImageText,
    styleBaseline: visualStyle || params.artStyle,
    continuityRules: [
      ...readStringArray(bible.continuityRules),
      ...referenceInstructions,
      ...bindingQualityRules.continuityRules,
      `Binding complexity: ${bindingPlan.complexity.level}; recommended action: ${bindingPlan.complexity.recommendedAction}.`,
      textPolicy.reviewHint,
    ],
    forbiddenPatterns: appendPanelTextPolicyForbiddenPatterns(
      [
        ...readStringArray(bible.forbiddenPatterns),
        ...bindingQualityRules.forbiddenPatterns,
      ],
      textPolicy,
    ),
    riskLevel,
    referenceInstructions,
    bindingPlan,
  }
}

export function buildCharacterAssetTargetSpec(params: {
  appearance: CharacterAppearanceForQuality
  artStyle: string
}): ImageTargetSpec {
  const intent = readFirstDescription(
    params.appearance.descriptions,
    params.appearance.description || params.appearance.character.introduction || params.appearance.character.name,
  )
  return {
    schemaVersion: 1,
    targetType: 'character',
    targetId: params.appearance.id,
    intent,
    aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
    visualType: 'character',
    renderMode: 'generated_image',
    shotType: '',
    cameraMove: '',
    location: '',
    characters: [params.appearance.character.name],
    props: [],
    requiredText: '',
    styleBaseline: params.artStyle,
    continuityRules: [
      `${params.appearance.character.name} must match the character description.`,
      params.appearance.changeReason ? `Appearance variant: ${params.appearance.changeReason}.` : '',
    ].filter(Boolean),
    forbiddenPatterns: [],
    riskLevel: 'medium',
  }
}

export function buildLocationAssetTargetSpec(params: {
  image: LocationImageForQuality
  artStyle: string
}): ImageTargetSpec {
  const isProp = params.image.location.assetKind === 'prop'
  return {
    schemaVersion: 1,
    targetType: isProp ? 'prop' : 'location',
    targetId: params.image.id,
    intent: params.image.description || params.image.location.summary || params.image.location.name,
    aspectRatio: isProp ? PROP_IMAGE_RATIO : LOCATION_IMAGE_RATIO,
    visualType: isProp ? 'prop' : 'location',
    renderMode: 'generated_image',
    shotType: '',
    cameraMove: '',
    location: isProp ? '' : params.image.location.name,
    characters: [],
    props: isProp ? [params.image.location.name] : [],
    requiredText: '',
    styleBaseline: params.artStyle,
    continuityRules: [
      `${params.image.location.name} must match the asset description.`,
      params.image.availableSlots ? `Available slots: ${params.image.availableSlots}.` : '',
    ].filter(Boolean),
    forbiddenPatterns: [],
    riskLevel: isProp ? 'low' : 'medium',
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
      passed: modelCandidate?.passed === true
        && (modelCandidate?.score ?? 0) >= VISUAL_REVIEW_PASS_MIN_SCORE
        && issues.length === 0,
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

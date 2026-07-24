import {
  readPanelShotSpec,
  resolvePanelVisualBindings,
  type PanelAssetBinding,
  type PanelForVisualBindings,
  type PanelVisualBindings,
  type SuppressedPanelAssetBinding,
} from './bindings'

export type BindingPlanWarningSeverity = 'info' | 'warning' | 'critical'

export interface BindingPlanWarning {
  code:
    | 'ASSET_SUPPRESSED'
    | 'NO_REFERENCE_ASSET'
    | 'HIGH_COMPLEXITY_SHOT'
    | 'TEXT_PRONE_SHOT'
    | 'REFERENCE_LIMIT_EXCEEDED'
    | 'BOOK_COVER_MOTIF'
    | 'COMPARISON_REFERENCE'
  severity: BindingPlanWarningSeverity
  message: string
  assetId?: string | null
}

export interface PanelShotComplexity {
  score: number
  level: 'low' | 'medium' | 'high'
  recommendedAction: 'generate' | 'simplify' | 'split' | 'composite'
  riskFlags: string[]
}

export interface PanelAssetBindingPlan {
  schemaVersion: 1
  primarySubject: string
  visualType: string
  renderMode: string
  bindings: PanelAssetBinding[]
  suppressed: SuppressedPanelAssetBinding[]
  warnings: BindingPlanWarning[]
  complexity: PanelShotComplexity
  usedShotSpec: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function readStoredBindingPlan(value: unknown): PanelAssetBindingPlan | null {
  const rules = asRecord(parseJson(value))
  const plan = asRecord(rules.assetBindingPlan)
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.bindings)) return null
  return plan as unknown as PanelAssetBindingPlan
}

function readShotText(panel: PanelForVisualBindings): string {
  const shotSpec = readPanelShotSpec(panel.photographyRules)
  return JSON.stringify({
    visualType: panel.visualType,
    renderMode: panel.renderMode,
    description: panel.description,
    imagePrompt: panel.imagePrompt,
    characters: panel.characters,
    location: panel.location,
    props: panel.props,
    shotSpec,
  }).toLowerCase()
}

function looksTextProne(text: string, visualType: string, renderMode: string): boolean {
  return visualType === 'book_cover'
    || visualType === 'quote_card'
    || renderMode === 'text_card'
    || /(书名|标题|封面|字幕|文字|年份|title|caption|cover)/iu.test(text)
}

function computeShotComplexity(
  panel: PanelForVisualBindings,
  bindings: PanelAssetBinding[],
): PanelShotComplexity {
  const text = readShotText(panel)
  const visualType = typeof panel.visualType === 'string' ? panel.visualType : ''
  const renderMode = typeof panel.renderMode === 'string' ? panel.renderMode : ''
  const characterCount = bindings.filter((item) => item.kind === 'character').length
  const hasEnvironment = bindings.some((item) => item.kind === 'location')
  const propCount = bindings.filter((item) => item.kind === 'prop').length
  const strongAction = /(落水|掉入|追逐|打斗|战斗|爆炸|飞溅|奔跑|拥挤|群像|多人|三人|并排|对比|split|comparison|crowd|fight|fall)/iu.test(text)
  const textProne = looksTextProne(text, visualType, renderMode)
  let score = 0
  const riskFlags: string[] = []

  if (characterCount >= 3) {
    score += 35
    riskFlags.push('multi_character_identity')
  } else if (characterCount === 2) {
    score += 18
    riskFlags.push('two_character_identity')
  }
  if (strongAction) {
    score += 25
    riskFlags.push('strong_action_or_comparison')
  }
  if (hasEnvironment && characterCount > 0) {
    score += 12
    riskFlags.push('character_environment_composite')
  }
  if (propCount > 0 && characterCount > 0) {
    score += 10
    riskFlags.push('character_prop_composite')
  }
  if (textProne) {
    score += 18
    riskFlags.push('text_prone_visual_type')
  }
  if (bindings.length > 3) {
    score += 12
    riskFlags.push('many_reference_assets')
  }

  const boundedScore = Math.min(100, score)
  const level = boundedScore >= 60 ? 'high' : boundedScore >= 35 ? 'medium' : 'low'
  const recommendedAction = level === 'high'
    ? (characterCount >= 3 || strongAction ? 'split' : 'simplify')
    : textProne && renderMode === 'text_card' ? 'composite' : 'generate'
  return {
    score: boundedScore,
    level,
    recommendedAction,
    riskFlags: Array.from(new Set(riskFlags)),
  }
}

function buildWarnings(params: {
  bindings: PanelAssetBinding[]
  suppressed: SuppressedPanelAssetBinding[]
  complexity: PanelShotComplexity
}): BindingPlanWarning[] {
  const warnings: BindingPlanWarning[] = []
  for (const asset of params.suppressed) {
    warnings.push({
      code: 'ASSET_SUPPRESSED',
      severity: 'warning',
      message: `${asset.name} was removed from visual references because it does not match the shot subject or visual type.`,
      assetId: asset.id,
    })
  }
  if (params.bindings.length === 0) {
    warnings.push({
      code: 'NO_REFERENCE_ASSET',
      severity: 'info',
      message: 'No locked visual asset is bound to this panel; generation will rely on the text prompt and style only.',
    })
  }
  if (params.complexity.level === 'high') {
    warnings.push({
      code: 'HIGH_COMPLEXITY_SHOT',
      severity: 'warning',
      message: `Shot complexity is high; recommended action is ${params.complexity.recommendedAction}.`,
    })
  }
  if (params.complexity.riskFlags.includes('text_prone_visual_type')) {
    warnings.push({
      code: 'TEXT_PRONE_SHOT',
      severity: 'warning',
      message: 'This visual type often causes accidental text; keep image text-free and reserve clean overlay space.',
    })
  }
  for (const binding of params.bindings) {
    if (binding.role === 'cover_motif') {
      warnings.push({
        code: 'BOOK_COVER_MOTIF',
        severity: 'info',
        message: `${binding.name} is used as a cover motif, not as a full scene to copy.`,
        assetId: binding.id,
      })
    }
    if (binding.role === 'comparison_prop') {
      warnings.push({
        code: 'COMPARISON_REFERENCE',
        severity: 'info',
        message: `${binding.name} is used as a comparison/reference prop; adapt it without forcing the whole shot to match it.`,
        assetId: binding.id,
      })
    }
  }
  return warnings
}

export function resolvePanelAssetBindingPlan(panel: PanelForVisualBindings): PanelAssetBindingPlan {
  const stored = readStoredBindingPlan(panel.photographyRules)
  if (stored) return stored
  const bindings = resolvePanelVisualBindings(panel)
  const complexity = computeShotComplexity(panel, bindings.visibleAssets)
  return {
    schemaVersion: 1,
    primarySubject: bindings.primarySubject,
    visualType: bindings.visualType,
    renderMode: bindings.renderMode,
    bindings: bindings.visibleAssets,
    suppressed: bindings.suppressedAssets,
    warnings: buildWarnings({
      bindings: bindings.visibleAssets,
      suppressed: bindings.suppressedAssets,
      complexity,
    }),
    complexity,
    usedShotSpec: bindings.usedShotSpec,
  }
}

export function panelVisualBindingsFromPlan(plan: PanelAssetBindingPlan): PanelVisualBindings {
  return {
    primarySubject: plan.primarySubject,
    visualType: plan.visualType,
    renderMode: plan.renderMode,
    visibleAssets: plan.bindings,
    suppressedAssets: plan.suppressed,
    usedShotSpec: plan.usedShotSpec,
  }
}

export function bindingPlanPromptGuidance(plan: PanelAssetBindingPlan): string[] {
  const lines = plan.bindings.map((binding) => {
    if (binding.role === 'primary_identity') return `${binding.name}: primary identity, must match the reference image.`
    if (binding.role === 'supporting_identity') return `${binding.name}: supporting visible identity, keep consistent but do not steal focus.`
    if (binding.role === 'environment') return `${binding.name}: environment reference, adapt layout, lighting and atmosphere.`
    if (binding.role === 'cover_motif') return `${binding.name}: cover motif only, use the core shape/detail on the book cover without copying its full scene.`
    if (binding.role === 'comparison_prop') return `${binding.name}: comparison prop, adapt shape/color as a secondary reference.`
    if (binding.role === 'prop_detail') return `${binding.name}: prop detail, lock the object shape and key visual traits.`
    return `${binding.name}: style-only reference, avoid copying subject identity.`
  })
  if (plan.complexity.level !== 'low') {
    lines.push(`Shot complexity: ${plan.complexity.level}; prefer one clear key frame and do not pack multiple beats into one image.`)
  }
  return lines
}

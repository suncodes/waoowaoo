import type { SourceAnchor } from '@/lib/content-planning'
import type { VideoProfile } from '@/lib/video-profile'
import type {
  DirectorTreatment,
  ProductionBible,
  RenderMode,
  ShotBudget,
  ShotFunction,
  ShotFunctionMixItem,
  ShotPlan,
  ShotPromptBlueprint,
  ShotRhythmPoint,
  ShotSpec,
  SingleImageFeasibility,
  ShotContinuity,
  VisualLicense,
  VisualPlanMentionWarning,
  VisualPlanResult,
  VisualAssetRef,
  VisualType,
  VisualUnit,
  VisualUnitSpeech,
} from './types'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`VISUAL_PLAN_INVALID: ${field} is required`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readShotFunction(value: unknown, fallback: ShotFunction): ShotFunction {
  if (
    value === 'hook' ||
    value === 'setup' ||
    value === 'reaction' ||
    value === 'evidence' ||
    value === 'transition' ||
    value === 'payoff' ||
    value === 'breath' ||
    value === 'cta'
  ) {
    return value
  }
  return fallback
}

function inferShotFunction(fallback: JsonRecord): ShotFunction {
  if (fallback.panelNumber === 1) return 'hook'
  const visualType = fallback.visualType
  if (visualType === 'diagram' || visualType === 'book_cover' || visualType === 'quote_card') return 'evidence'
  if (visualType === 'kinetic_text') return 'transition'
  return 'setup'
}

function parseDirectorTreatment(value: unknown): DirectorTreatment {
  if (!isRecord(value)) throw new Error('VISUAL_PLAN_INVALID: directorTreatment is required')
  return {
    schemaVersion: 1,
    narrativeStrategy: requiredString(value.narrativeStrategy, 'directorTreatment.narrativeStrategy'),
    pacing: requiredString(value.pacing, 'directorTreatment.pacing'),
    cameraLanguage: requiredString(value.cameraLanguage, 'directorTreatment.cameraLanguage'),
    transitionStrategy: requiredString(value.transitionStrategy, 'directorTreatment.transitionStrategy'),
    soundStrategy: requiredString(value.soundStrategy, 'directorTreatment.soundStrategy'),
  }
}

function parseProductionBible(value: unknown): ProductionBible {
  if (!isRecord(value)) throw new Error('VISUAL_PLAN_INVALID: productionBible is required')
  return {
    schemaVersion: 1,
    visualStyle: requiredString(value.visualStyle, 'productionBible.visualStyle'),
    lightingBaseline: requiredString(value.lightingBaseline, 'productionBible.lightingBaseline'),
    colorGrade: requiredString(value.colorGrade, 'productionBible.colorGrade'),
    compositionRules: stringArray(value.compositionRules),
    continuityRules: stringArray(value.continuityRules),
    forbiddenPatterns: stringArray(value.forbiddenPatterns),
  }
}

function parseSourceAnchor(value: unknown): SourceAnchor | undefined {
  if (!isRecord(value) || typeof value.label !== 'string' || !value.label.trim()) return undefined
  const quote = optionalString(value.quote)
  const startText = optionalString(value.startText)
  const endText = optionalString(value.endText)
  const chapter = optionalString(value.chapter)
  const visualAssetIds = stringArray(value.visualAssetIds)
  return {
    label: value.label.trim(),
    ...(quote ? { quote } : {}),
    ...(startText ? { startText } : {}),
    ...(endText ? { endText } : {}),
    ...(chapter ? { chapter } : {}),
    ...(visualAssetIds.length > 0 ? { visualAssetIds } : {}),
  }
}

function parseVisibleAssets(value: unknown, fallbackAssets: VisualAssetRef[]): VisualAssetRef[] {
  if (!Array.isArray(value)) return fallbackAssets
  const refs = value.flatMap((item): VisualAssetRef[] => {
    if (!isRecord(item)) return []
    const id = optionalString(item.id)
    const kind = item.kind === 'character' || item.kind === 'location' || item.kind === 'prop'
      ? item.kind
      : null
    const name = optionalString(item.name)
    return id && kind && name ? [{ id, kind, name }] : []
  })
  return refs.length > 0 ? refs : fallbackAssets
}

function parseShotContinuity(value: unknown, fallback: JsonRecord): ShotContinuity {
  const raw = isRecord(value) ? value : {}
  return {
    fromPrevious: optionalString(raw.fromPrevious) || optionalString(fallback.spatialContinuity) || '承接上一镜已建立的空间、主体位置和情绪',
    toNext: optionalString(raw.toNext) || '为下一镜保留清晰的动作或信息方向',
    screenDirection: optionalString(raw.screenDirection) || optionalString(fallback.spatialContinuity) || '保持既定视线和运动方向',
    lightingContinuity: optionalString(raw.lightingContinuity) || optionalString(fallback.sceneLightingBaseline) || '遵循 productionBible 的光色连续性',
  }
}

function parseSingleImageFeasibility(value: unknown, fallback: JsonRecord): SingleImageFeasibility {
  const raw = isRecord(value) ? value : {}
  const status = raw.status === 'needs_split'
    || raw.status === 'text_only'
    || raw.status === 'composite_only'
    ? raw.status
    : 'feasible'
  return {
    status,
    reason: optionalString(raw.reason) || optionalString(fallback.description) || '单一时空、单一构图和单一主要视觉事件',
    riskFlags: stringArray(raw.riskFlags),
  }
}

function parseShotPromptBlueprint(value: unknown): ShotPromptBlueprint | undefined {
  if (!isRecord(value)) return undefined
  const blueprint: ShotPromptBlueprint = {
    subject: stringArray(value.subject),
    environment: stringArray(value.environment),
    action: stringArray(value.action),
    camera: stringArray(value.camera),
    lighting: stringArray(value.lighting),
    style: stringArray(value.style),
    negative: stringArray(value.negative),
  }
  return Object.values(blueprint).some((items) => items.length > 0) ? blueprint : undefined
}

function parseShotSpec(value: unknown, fallback: JsonRecord, assetRefs: VisualAssetRef[]): ShotSpec {
  const raw = isRecord(value) ? value : {}
  const shotFunction = readShotFunction(raw.shotFunction, inferShotFunction(fallback))
  const visibleAssets = parseVisibleAssets(raw.visibleAssets, assetRefs)
  const promptBlueprint = parseShotPromptBlueprint(raw.promptBlueprint)
  const primarySubject = optionalString(raw.primarySubject)
    || visibleAssets.find((asset) => asset.kind === 'character')?.name
    || visibleAssets[0]?.name
    || optionalString(fallback.description)
    || '当前镜头主体'
  return {
    narrativeIntent: optionalString(raw.narrativeIntent) || requiredString(fallback.description, 'visualUnit.description'),
    shotFunction,
    primarySubject,
    visibleAssets,
    subjectIdentity: stringArray(raw.subjectIdentity),
    startState: optionalString(raw.startState) || 'stable opening state',
    actionBeats: stringArray(raw.actionBeats),
    endState: optionalString(raw.endState) || 'stable closing state',
    continuity: parseShotContinuity(raw.continuity, raw),
    singleImageFeasibility: parseSingleImageFeasibility(raw.singleImageFeasibility, fallback),
    spatialContinuity: optionalString(raw.spatialContinuity) || 'preserve established screen direction',
    camera: optionalString(raw.camera) || optionalString(fallback.cameraMove) || 'locked camera',
    sceneLightingBaseline: optionalString(raw.sceneLightingBaseline) || 'follow production bible',
    colorGrade: optionalString(raw.colorGrade) || 'follow production bible',
    dialogueAudio: optionalString(raw.dialogueAudio) || '',
    constraints: stringArray(raw.constraints),
    durationIntent: optionalString(raw.durationIntent) || `${numberInRange(fallback.durationSec, 5, 1, 60)} seconds`,
    ...(promptBlueprint ? { promptBlueprint } : {}),
  }
}

function parseVisualType(value: unknown): VisualType {
  const allowed = new Set<VisualType>([
    'character_action',
    'environment',
    'book_cover',
    'quote_card',
    'diagram',
    'illustration',
    'kinetic_text',
  ])
  return typeof value === 'string' && allowed.has(value as VisualType)
    ? value as VisualType
    : 'illustration'
}

function parseRenderMode(value: unknown): RenderMode {
  return value === 'text_card' || value === 'composite' ? value : 'generated_image'
}

function parseVisualLicense(value: unknown, visualType: VisualType, renderMode: RenderMode): VisualLicense {
  if (
    value === 'literal'
    || value === 'illustrative'
    || value === 'metaphor'
    || value === 'transition'
    || value === 'text_card'
  ) {
    return value
  }
  if (renderMode === 'text_card' || visualType === 'quote_card' || visualType === 'kinetic_text') return 'text_card'
  if (visualType === 'diagram') return 'illustrative'
  if (visualType === 'book_cover') return 'literal'
  return 'illustrative'
}

function parseAssetRefs(
  value: unknown,
  unitIndex: number,
  availableAssets: ReadonlyMap<string, VisualAssetRef>,
): VisualAssetRef[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item, refIndex) => {
    if (!isRecord(item)) {
      throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${unitIndex}.assetRefs.${refIndex} must be object`)
    }
    const id = requiredString(item.id, `visualUnits.${unitIndex}.assetRefs.${refIndex}.id`)
    if (seen.has(id)) return []
    seen.add(id)
    const available = availableAssets.get(id)
    if (!available && availableAssets.size > 0) {
      throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${unitIndex}.assetRefs.${refIndex}.id does not exist`)
    }
    const kind = requiredString(item.kind, `visualUnits.${unitIndex}.assetRefs.${refIndex}.kind`)
    const name = requiredString(item.name, `visualUnits.${unitIndex}.assetRefs.${refIndex}.name`)
    if (!available) {
      if (kind !== 'character' && kind !== 'location' && kind !== 'prop') {
        throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${unitIndex}.assetRefs.${refIndex}.kind is invalid`)
      }
      return [{ id, kind, name }]
    }
    if (kind !== available.kind || name !== available.name) {
      throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${unitIndex}.assetRefs.${refIndex} must exactly match available assets`)
    }
    return [available]
  })
}

function parseVisualUnitSpeech(value: unknown, unitIndex: number): VisualUnitSpeech | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) {
    throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${unitIndex}.speech must be object or null`)
  }
  const speaker = requiredString(value.speaker, `visualUnits.${unitIndex}.speech.speaker`)
  const content = requiredString(value.content, `visualUnits.${unitIndex}.speech.content`)
  const rawEmotionStrength = value.emotionStrength ?? value.emotion_strength
  const emotionStrength = typeof rawEmotionStrength === 'number' && Number.isFinite(rawEmotionStrength)
    ? Math.min(1, Math.max(0.1, rawEmotionStrength))
    : undefined
  return {
    speaker,
    content,
    ...(emotionStrength !== undefined ? { emotionStrength } : {}),
  }
}

function mentionsAsset(unit: VisualUnit, asset: VisualAssetRef): boolean {
  const text = JSON.stringify({
    description: unit.description,
    imagePrompt: unit.imagePrompt,
    videoPrompt: unit.videoPrompt,
    primarySubject: unit.shotSpec.primarySubject,
    subjectIdentity: unit.shotSpec.subjectIdentity,
    visibleAssets: unit.shotSpec.visibleAssets,
  }).toLowerCase()
  return text.includes(asset.name.toLowerCase())
}

function parseVisualUnits(
  value: unknown,
  allowedClipIds: ReadonlySet<string>,
  availableAssets: ReadonlyMap<string, VisualAssetRef>,
): { units: VisualUnit[]; mentionWarnings: VisualPlanMentionWarning[] } {
  if (!Array.isArray(value)) return { units: [], mentionWarnings: [] }
  const mentionWarnings: VisualPlanMentionWarning[] = []
  const units = value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${index} must be object`)
    const clipId = requiredString(item.clipId, `visualUnits.${index}.clipId`)
    if (!allowedClipIds.has(clipId)) {
      throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${index}.clipId does not exist`)
    }
    const onScreenText = optionalString(item.onScreenText)
    const sourceAnchor = parseSourceAnchor(item.sourceAnchor)
    const assetRefs = parseAssetRefs(item.assetRefs, index, availableAssets)
    if (item.speech_lines !== undefined || item.speechLines !== undefined) {
      throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${index} must use one speech object instead of speech_lines`)
    }
    const speech = parseVisualUnitSpeech(item.speech, index)
    const visualType = parseVisualType(item.visualType)
    const renderMode = parseRenderMode(item.renderMode)
    const continuityGroupId = optionalString(item.continuityGroupId)
    const unit: VisualUnit = {
      id: optionalString(item.id) || `visual_${index + 1}`,
      clipId,
      panelNumber: Math.round(numberInRange(item.panelNumber, index + 1, 1, 999)),
      visualType,
      renderMode,
      visualLicense: parseVisualLicense(item.visualLicense, visualType, renderMode),
      ...(continuityGroupId ? { continuityGroupId } : {}),
      shotType: optionalString(item.shotType) || 'medium shot',
      cameraMove: optionalString(item.cameraMove) || 'locked camera',
      description: requiredString(item.description, `visualUnits.${index}.description`),
      imagePrompt: requiredString(item.imagePrompt, `visualUnits.${index}.imagePrompt`),
      videoPrompt: requiredString(item.videoPrompt, `visualUnits.${index}.videoPrompt`),
      durationSec: numberInRange(item.durationSec, 5, 1, 60),
      ...(onScreenText ? { onScreenText } : {}),
      ...(sourceAnchor ? { sourceAnchor } : {}),
      shotSpec: parseShotSpec(item.shotSpec, item, assetRefs),
      assetRefs,
      speech,
    }
    const referencedAssetIds = new Set(unit.assetRefs?.map((asset) => asset.id) || [])
    for (const asset of availableAssets.values()) {
      if (mentionsAsset(unit, asset) && !referencedAssetIds.has(asset.id)) {
        mentionWarnings.push({
          unitIndex: index,
          unitId: unit.id,
          assetId: asset.id,
          assetKind: asset.kind,
          assetName: asset.name,
        })
      }
    }
    return unit
  })
  return { units, mentionWarnings }
}

function parseShotBudget(value: unknown, visualUnits: VisualUnit[]): ShotBudget {
  const raw = isRecord(value) ? value : {}
  const totalDuration = visualUnits.reduce((sum, unit) => sum + unit.durationSec, 0)
  const totalShots = Math.round(numberInRange(raw.totalShots, visualUnits.length, 1, 999))
  const averageDurationSec = numberInRange(
    raw.averageDurationSec,
    totalShots > 0 ? totalDuration / totalShots : 0,
    0,
    600,
  )
  const functionCounts = countShotFunctions(visualUnits)
  return {
    totalShots,
    averageDurationSec,
    hookShots: Math.round(numberInRange(raw.hookShots, functionCounts.get('hook') || 0, 0, 999)),
    setupShots: Math.round(numberInRange(raw.setupShots, functionCounts.get('setup') || 0, 0, 999)),
    evidenceShots: Math.round(numberInRange(raw.evidenceShots, functionCounts.get('evidence') || 0, 0, 999)),
    payoffShots: Math.round(numberInRange(raw.payoffShots, functionCounts.get('payoff') || 0, 0, 999)),
    breathShots: Math.round(numberInRange(raw.breathShots, functionCounts.get('breath') || 0, 0, 999)),
  }
}

function countShotFunctions(visualUnits: VisualUnit[]): Map<ShotFunction, number> {
  const counts = new Map<ShotFunction, number>()
  for (const unit of visualUnits) {
    counts.set(unit.shotSpec.shotFunction, (counts.get(unit.shotSpec.shotFunction) || 0) + 1)
  }
  return counts
}

function parseRhythmCurve(value: unknown, visualUnits: VisualUnit[]): ShotRhythmPoint[] {
  if (Array.isArray(value)) {
    const points = value.flatMap((item, index): ShotRhythmPoint[] => {
      if (!isRecord(item)) return []
      const shotFunction = item.shotFunction === 'mixed'
        ? 'mixed'
        : readShotFunction(item.shotFunction, 'setup')
      return [{
        label: optionalString(item.label) || `rhythm_${index + 1}`,
        shotFunction,
        intensity: numberInRange(item.intensity, 0.5, 0, 1),
        intent: optionalString(item.intent) || '镜头节奏节点',
      }]
    })
    if (points.length > 0) return points
  }
  return visualUnits.map((unit, index) => ({
    label: unit.id || `visual_${index + 1}`,
    shotFunction: unit.shotSpec.shotFunction,
    intensity: unit.shotSpec.shotFunction === 'hook' || unit.shotSpec.shotFunction === 'payoff' ? 0.8 : 0.5,
    intent: unit.shotSpec.narrativeIntent,
  }))
}

function parseFunctionMix(value: unknown, visualUnits: VisualUnit[]): ShotFunctionMixItem[] {
  if (Array.isArray(value)) {
    const items = value.flatMap((item): ShotFunctionMixItem[] => {
      if (!isRecord(item)) return []
      return [{
        shotFunction: readShotFunction(item.shotFunction, 'setup'),
        count: Math.round(numberInRange(item.count, 0, 0, 999)),
      }]
    }).filter((item) => item.count > 0)
    if (items.length > 0) return items
  }
  return Array.from(countShotFunctions(visualUnits).entries())
    .map(([shotFunction, count]) => ({ shotFunction, count }))
}

function parseShotPlan(
  value: unknown,
  profile: VideoProfile,
  visualUnits: VisualUnit[],
): ShotPlan {
  const raw = isRecord(value) ? value : {}
  return {
    schemaVersion: 1,
    summary: requiredString(raw.summary, 'shotPlan.summary'),
    totalEstimatedDurationSec: numberInRange(
      raw.totalEstimatedDurationSec,
      profile.targetDurationSec,
      1,
      3600,
    ),
    shotBudget: parseShotBudget(raw.shotBudget, visualUnits),
    rhythmCurve: parseRhythmCurve(raw.rhythmCurve, visualUnits),
    functionMix: parseFunctionMix(raw.functionMix, visualUnits),
    continuityChecks: stringArray(raw.continuityChecks),
  }
}

export function parseVisualPlanResult(
  value: unknown,
  profile: VideoProfile,
  clipIds: string[],
  assets: VisualAssetRef[] = [],
): VisualPlanResult {
  if (!isRecord(value)) throw new Error('VISUAL_PLAN_INVALID: response must be object')
  const shotPlan = isRecord(value.shotPlan) ? value.shotPlan : {}
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
  const { units: visualUnits, mentionWarnings } = parseVisualUnits(value.visualUnits, new Set(clipIds), assetMap)
  if (profile.contentDomain === 'book' && visualUnits.length === 0) {
    throw new Error('VISUAL_PLAN_INVALID: book guide requires visualUnits')
  }
  const coveredClipIds = new Set(visualUnits.map((unit) => unit.clipId))
  const missingClipIds = clipIds.filter((clipId) => !coveredClipIds.has(clipId))
  if (missingClipIds.length > 0) {
    throw new Error(`VISUAL_PLAN_INVALID: visualUnits missing clipIds: ${missingClipIds.join(',')}`)
  }
  return {
    directorTreatment: parseDirectorTreatment(value.directorTreatment),
    productionBible: parseProductionBible(value.productionBible),
    shotPlan: parseShotPlan(shotPlan, profile, visualUnits),
    visualUnits,
    ...(mentionWarnings.length > 0 ? { warnings: mentionWarnings } : {}),
  }
}

export * from './types'
export * from './visual-beat-plan'
export * from './storyboard-slot-plan'
export * from './storyboard-auto-repair'

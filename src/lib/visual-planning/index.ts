import type { SourceAnchor } from '@/lib/content-planning'
import type { VideoProfile } from '@/lib/video-profile'
import type {
  DirectorTreatment,
  ProductionBible,
  RenderMode,
  ShotSpec,
  VisualPlanResult,
  VisualType,
  VisualUnit,
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

function parseShotSpec(value: unknown, fallback: JsonRecord): ShotSpec {
  const raw = isRecord(value) ? value : {}
  return {
    narrativeIntent: optionalString(raw.narrativeIntent) || requiredString(fallback.description, 'visualUnit.description'),
    subjectIdentity: stringArray(raw.subjectIdentity),
    startState: optionalString(raw.startState) || 'stable opening state',
    actionBeats: stringArray(raw.actionBeats),
    endState: optionalString(raw.endState) || 'stable closing state',
    spatialContinuity: optionalString(raw.spatialContinuity) || 'preserve established screen direction',
    camera: optionalString(raw.camera) || optionalString(fallback.cameraMove) || 'locked camera',
    sceneLightingBaseline: optionalString(raw.sceneLightingBaseline) || 'follow production bible',
    colorGrade: optionalString(raw.colorGrade) || 'follow production bible',
    dialogueAudio: optionalString(raw.dialogueAudio) || '',
    constraints: stringArray(raw.constraints),
    durationIntent: optionalString(raw.durationIntent) || `${numberInRange(fallback.durationSec, 5, 1, 60)} seconds`,
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

function parseVisualUnits(value: unknown, allowedClipIds: ReadonlySet<string>): VisualUnit[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${index} must be object`)
    const clipId = requiredString(item.clipId, `visualUnits.${index}.clipId`)
    if (!allowedClipIds.has(clipId)) {
      throw new Error(`VISUAL_PLAN_INVALID: visualUnits.${index}.clipId does not exist`)
    }
    const onScreenText = optionalString(item.onScreenText)
    const sourceAnchor = parseSourceAnchor(item.sourceAnchor)
    return {
      id: optionalString(item.id) || `visual_${index + 1}`,
      clipId,
      panelNumber: Math.round(numberInRange(item.panelNumber, index + 1, 1, 999)),
      visualType: parseVisualType(item.visualType),
      renderMode: parseRenderMode(item.renderMode),
      shotType: optionalString(item.shotType) || 'medium shot',
      cameraMove: optionalString(item.cameraMove) || 'locked camera',
      description: requiredString(item.description, `visualUnits.${index}.description`),
      imagePrompt: requiredString(item.imagePrompt, `visualUnits.${index}.imagePrompt`),
      videoPrompt: requiredString(item.videoPrompt, `visualUnits.${index}.videoPrompt`),
      durationSec: numberInRange(item.durationSec, 5, 1, 60),
      ...(onScreenText ? { onScreenText } : {}),
      ...(sourceAnchor ? { sourceAnchor } : {}),
      shotSpec: parseShotSpec(item.shotSpec, item),
    }
  })
}

export function parseVisualPlanResult(
  value: unknown,
  profile: VideoProfile,
  clipIds: string[],
): VisualPlanResult {
  if (!isRecord(value)) throw new Error('VISUAL_PLAN_INVALID: response must be object')
  const shotPlan = isRecord(value.shotPlan) ? value.shotPlan : {}
  const visualUnits = parseVisualUnits(value.visualUnits, new Set(clipIds))
  if (profile.contentDomain === 'book' && visualUnits.length === 0) {
    throw new Error('VISUAL_PLAN_INVALID: book guide requires visualUnits')
  }
  return {
    directorTreatment: parseDirectorTreatment(value.directorTreatment),
    productionBible: parseProductionBible(value.productionBible),
    shotPlan: {
      schemaVersion: 1,
      summary: requiredString(shotPlan.summary, 'shotPlan.summary'),
      totalEstimatedDurationSec: numberInRange(
        shotPlan.totalEstimatedDurationSec,
        profile.targetDurationSec,
        1,
        3600,
      ),
      continuityChecks: stringArray(shotPlan.continuityChecks),
    },
    visualUnits,
  }
}

export * from './types'

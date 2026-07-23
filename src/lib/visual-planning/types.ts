import type { SourceAnchor } from '@/lib/content-planning'

export type VisualType =
  | 'character_action'
  | 'environment'
  | 'book_cover'
  | 'quote_card'
  | 'diagram'
  | 'illustration'
  | 'kinetic_text'

export type RenderMode = 'generated_image' | 'text_card' | 'composite'

export type ShotFunction =
  | 'hook'
  | 'setup'
  | 'reaction'
  | 'evidence'
  | 'transition'
  | 'payoff'
  | 'breath'
  | 'cta'

export interface DirectorTreatment {
  schemaVersion: 1
  narrativeStrategy: string
  pacing: string
  cameraLanguage: string
  transitionStrategy: string
  soundStrategy: string
}

export interface ProductionBible {
  schemaVersion: 1
  visualStyle: string
  lightingBaseline: string
  colorGrade: string
  compositionRules: string[]
  continuityRules: string[]
  forbiddenPatterns: string[]
}

export interface VisualAssetRef {
  id: string
  kind: 'character' | 'location' | 'prop'
  name: string
}

export interface ShotContinuity {
  fromPrevious: string
  toNext: string
  screenDirection: string
  lightingContinuity: string
}

export interface SingleImageFeasibility {
  status: 'feasible' | 'needs_split' | 'text_only' | 'composite_only'
  reason: string
  riskFlags: string[]
}

export interface ShotSpec {
  narrativeIntent: string
  shotFunction: ShotFunction
  primarySubject: string
  visibleAssets: VisualAssetRef[]
  subjectIdentity: string[]
  startState: string
  actionBeats: string[]
  endState: string
  continuity: ShotContinuity
  singleImageFeasibility: SingleImageFeasibility
  spatialContinuity: string
  camera: string
  sceneLightingBaseline: string
  colorGrade: string
  dialogueAudio: string
  constraints: string[]
  durationIntent: string
}

export interface VisualUnit {
  id: string
  clipId: string
  panelNumber: number
  visualType: VisualType
  renderMode: RenderMode
  shotType: string
  cameraMove: string
  description: string
  imagePrompt: string
  videoPrompt: string
  durationSec: number
  onScreenText?: string
  sourceAnchor?: SourceAnchor
  shotSpec: ShotSpec
  assetRefs?: VisualAssetRef[]
}

export interface ShotBudget {
  totalShots: number
  averageDurationSec: number
  hookShots: number
  setupShots: number
  evidenceShots: number
  payoffShots: number
  breathShots: number
}

export interface ShotRhythmPoint {
  label: string
  shotFunction: ShotFunction | 'mixed'
  intensity: number
  intent: string
}

export interface ShotFunctionMixItem {
  shotFunction: ShotFunction
  count: number
}

export interface ShotPlan {
  schemaVersion: 1
  summary: string
  totalEstimatedDurationSec: number
  shotBudget: ShotBudget
  rhythmCurve: ShotRhythmPoint[]
  functionMix: ShotFunctionMixItem[]
  continuityChecks: string[]
}

export interface VisualPlanResult {
  directorTreatment: DirectorTreatment
  productionBible: ProductionBible
  shotPlan: ShotPlan
  visualUnits: VisualUnit[]
}

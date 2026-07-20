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

export interface ShotSpec {
  narrativeIntent: string
  subjectIdentity: string[]
  startState: string
  actionBeats: string[]
  endState: string
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
  assetRefs?: Array<{
    id: string
    kind: 'character' | 'location' | 'prop'
    name: string
  }>
}

export interface VisualPlanResult {
  directorTreatment: DirectorTreatment
  productionBible: ProductionBible
  shotPlan: {
    schemaVersion: 1
    summary: string
    totalEstimatedDurationSec: number
    continuityChecks: string[]
  }
  visualUnits: VisualUnit[]
}

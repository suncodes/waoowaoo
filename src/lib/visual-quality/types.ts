import type { AssetRenderContract } from '@/lib/assets/asset-render-contract'

export type VisualQualityIssueCode =
  | 'EMPTY_IMAGE'
  | 'UNREADABLE_IMAGE'
  | 'ASPECT_RATIO_MISMATCH'
  | 'DUPLICATE_CANDIDATE'
  | 'SUBJECT_MISMATCH'
  | 'CHARACTER_INCONSISTENT'
  | 'PROP_INCONSISTENT'
  | 'SCENE_INCONSISTENT'
  | 'COMPOSITION_ERROR'
  | 'TEXT_ERROR'
  | 'ANATOMY_ERROR'
  | 'STYLE_MISMATCH'
  | 'CONTINUITY_ERROR'
  | 'TEMPLATE_MISMATCH'
  | 'LOW_TECHNICAL_QUALITY'

export interface ImageTargetSpec {
  schemaVersion: 1
  targetType: 'panel' | 'character' | 'location' | 'prop' | 'frame_pair'
  targetId: string
  intent: string
  aspectRatio: string
  visualType: string
  renderMode: string
  renderPurpose?: 'reference_sheet' | 'single_reference' | 'variant' | 'repair'
  templateKind?: string
  shotType: string
  cameraMove: string
  location: string
  characters: string[]
  props: string[]
  requiredText: string
  styleBaseline: string
  continuityRules: string[]
  forbiddenPatterns: string[]
  riskLevel: 'low' | 'medium' | 'high'
  referenceInstructions?: string[]
  bindingPlan?: unknown
  assetRenderContract?: AssetRenderContract
}

export interface VisualQualityIssue {
  code: VisualQualityIssueCode
  severity: 'minor' | 'major' | 'critical'
  message: string
  evidence: string
  repairHint: string
}

export interface PromptPatch {
  preserve: string[]
  add: string[]
  remove: string[]
  negative: string[]
  rationale: string
}

export interface CandidateQualityReview {
  candidateIndex: number
  score: number
  confidence: number
  passed: boolean
  strengths: string[]
  issues: VisualQualityIssue[]
}

export interface ImageQualityReviewResult {
  schemaVersion: 1
  versionHash: string
  status: 'passed' | 'repairable' | 'human_required'
  selectedCandidateIndex: number | null
  score: number
  confidence: number
  candidates: CandidateQualityReview[]
  issueCodes: VisualQualityIssueCode[]
  promptPatch: PromptPatch
  summary: string
}

export type RepairAction = 'approve' | 'select_candidate' | 'edit' | 'regenerate' | 'human_required'

export interface RepairDecision {
  action: RepairAction
  candidateIndex: number | null
  reason: string
  promptPatch: PromptPatch
}

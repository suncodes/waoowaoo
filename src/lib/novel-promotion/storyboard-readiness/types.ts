export type StoryboardReadinessStatus =
  | 'ready'
  | 'needs_fix'
  | 'fix_pending_confirm'
  | 'fix_applying'
  | 'blocked'
  | 'risk_accepted'

export type StoryboardReadinessIssueKind =
  | 'speech_plan_missing'
  | 'speech_plan_invalid'
  | 'speech_too_long'
  | 'line_too_long'
  | 'asset_backfill_required'
  | 'manual_reference_required'
  | 'complex_panel_split_required'
  | 'binding_warning'

export type StoryboardReadinessIssueSeverity = 'info' | 'warning' | 'blocking'

export interface StoryboardReadinessIssue {
  id: string
  kind: StoryboardReadinessIssueKind
  severity: StoryboardReadinessIssueSeverity
  panelId?: string | null
  panelNumber?: number | null
  voiceLineId?: string | null
  title: string
  message: string
  autoFixable: boolean
  metadata?: Record<string, unknown>
}

export type StoryboardAutoFixActionType =
  | 'rebuild_speech_plans'
  | 'rewrite_delivery_line'
  | 'backfill_assets'
  | 'refresh_binding_plan'
  | 'split_panel_required'
  | 'accept_no_reference_risk'

export interface StoryboardAutoFixAction {
  id: string
  type: StoryboardAutoFixActionType
  panelId?: string | null
  voiceLineId?: string | null
  title: string
  reason: string
  before?: string | null
  after?: string | null
  autoApply: boolean
  metadata?: Record<string, unknown>
}

export interface StoryboardAutoFixPlan {
  schemaVersion: 1
  id: string
  episodeId: string
  status: 'draft' | 'waiting_user_confirm' | 'applying' | 'applied' | 'risk_accepted'
  createdAt: string
  updatedAt: string
  issues: StoryboardReadinessIssue[]
  actions: StoryboardAutoFixAction[]
  summary: StoryboardReadinessSummary
}

export interface StoryboardReadinessSummary {
  totalPanels: number
  speechWarnings: number
  speechBlocking: number
  missingAssets: number
  manualReferences: number
  complexPanels: number
  bindingWarnings: number
  autoFixableIssues: number
  blockingIssues: number
}

export interface StoryboardReadinessResult {
  episodeId: string
  status: StoryboardReadinessStatus
  summary: StoryboardReadinessSummary
  issues: StoryboardReadinessIssue[]
  fixPlan: StoryboardAutoFixPlan | null
  message: string
}

export interface StoryboardAutoFixApplyResult {
  episodeId: string
  status: StoryboardReadinessStatus
  appliedActionIds: string[]
  skippedActionIds: string[]
  readiness: StoryboardReadinessResult
}

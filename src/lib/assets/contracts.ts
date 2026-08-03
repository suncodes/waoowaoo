import type { MediaRef } from '@/types/project'

export type AssetScope = 'global' | 'project'

export type AssetKind = 'character' | 'location' | 'prop' | 'voice'

export type AssetFamily = 'visual' | 'audio'

export type AssetTaskError = {
  code: string
  message: string
}

export type AssetTaskState = {
  isRunning: boolean
  phase?: 'idle' | 'queued' | 'processing' | 'completed' | 'failed'
  taskType?: string | null
  progress?: number | null
  stage?: string | null
  stageLabel?: string | null
  attempt?: number | null
  maxAttempts?: number | null
  updatedAt?: string | null
  lastError: AssetTaskError | null
}

export type AssetCapabilityMap = {
  canGenerate: boolean
  canSelectRender: boolean
  canRevertRender: boolean
  canModifyRender: boolean
  canUploadRender: boolean
  canBindVoice: boolean
  canCopyFromGlobal: boolean
}

export type AssetTaskRef = {
  targetType: string
  targetId: string
  types: string[]
}

export type AssetBackfillSummary = {
  sourcePanelIds: string[]
  reason: string | null
}

export type AssetCandidateGroupSummary = {
  id: string
  origin: 'initial' | 'repair'
  attempt: number
  action: 'edit' | 'regenerate' | null
  candidateUrls: string[]
  sourceCandidateUrl: string | null
  createdAt: string
}

export type AssetPromptSnapshotReference = {
  artifactId: string
  promptHash: string
  inputHash: string
  preparationHash: string | null
  createdAt: string
}

export type AssetRenderSummary = {
  id: string
  index: number
  imageUrl: string | null
  media: MediaRef | null
  isSelected: boolean
  previousImageUrl: string | null
  previousMedia: MediaRef | null
  taskRefs: AssetTaskRef[]
  promptSnapshot?: AssetPromptSnapshotReference | null
  taskState: AssetTaskState
}

export type AssetVariantSummary = {
  id: string
  index: number
  label: string
  description: string | null
  selectionState: {
    selectedRenderIndex: number | null
  }
  renders: AssetRenderSummary[]
  taskRefs: AssetTaskRef[]
  taskState: AssetTaskState
}

export type BaseAssetSummary = {
  id: string
  scope: AssetScope
  kind: AssetKind
  family: AssetFamily
  name: string
  folderId: string | null
  capabilities: AssetCapabilityMap
  candidateGroups?: AssetCandidateGroupSummary[]
  backfill?: AssetBackfillSummary | null
  taskRefs: AssetTaskRef[]
  taskState: AssetTaskState
}

export type CharacterAssetSummary = BaseAssetSummary & {
  kind: 'character'
  family: 'visual'
  variants: AssetVariantSummary[]
  introduction: string | null
  profileData: string | null
  profileConfirmed: boolean | null
  profileTaskRefs: AssetTaskRef[]
  profileTaskState: AssetTaskState
  voice: {
    voiceType: 'custom' | 'qwen-designed' | 'uploaded' | null
    voiceId: string | null
    customVoiceUrl: string | null
    media: MediaRef | null
  }
}

export type LocationAssetSummary = BaseAssetSummary & {
  kind: 'location'
  family: 'visual'
  variants: AssetVariantSummary[]
  summary: string | null
  selectedVariantId: string | null
}

export type PropAssetSummary = BaseAssetSummary & {
  kind: 'prop'
  family: 'visual'
  variants: AssetVariantSummary[]
  summary: string | null
  selectedVariantId: string | null
}

export type VoiceAssetSummary = BaseAssetSummary & {
  kind: 'voice'
  family: 'audio'
  voiceMeta: {
    description: string | null
    voiceId: string | null
    voiceType: string
    customVoiceUrl: string | null
    media: MediaRef | null
    voicePrompt: string | null
    gender: string | null
    language: string
  }
}

export type VisualAssetSummary = CharacterAssetSummary | LocationAssetSummary | PropAssetSummary

export type AssetSummary =
  | CharacterAssetSummary
  | LocationAssetSummary
  | PropAssetSummary
  | VoiceAssetSummary

export type AssetQueryInput = {
  scope: AssetScope
  projectId?: string | null
  folderId?: string | null
  kind?: AssetKind | null
}

export type ReadAssetsResponse = {
  assets: AssetSummary[]
}

export function createIdleTaskState(): AssetTaskState {
  return {
    isRunning: false,
    phase: 'idle',
    taskType: null,
    progress: null,
    stage: null,
    stageLabel: null,
    attempt: null,
    maxAttempts: null,
    updatedAt: null,
    lastError: null,
  }
}

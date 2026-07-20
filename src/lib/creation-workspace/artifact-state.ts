import type { CreationStageId } from './stages'

export const WORKSPACE_ARTIFACT_META_KEY = '_workspace'

export type WorkspaceArtifactStatus = 'draft' | 'needs_review' | 'approved' | 'stale'
export type WorkspaceArtifactAuthor = 'ai' | 'user'
export type ContentUnitKind = 'guide_segment' | 'script_clip'
export type AssetRequirementStatus = 'not_started' | 'needs_review' | 'approved' | 'stale'

export interface WorkspaceImpactSummary {
  sourceUnitIds: string[]
  affectedStageIds: CreationStageId[]
  storyboardCount: number
  panelCount: number
  videoCount: number
  createdAt: string
}

export interface ContentUnitSnapshot {
  unitId: string
  kind: ContentUnitKind
  revision: number
  createdAt: string
  author: WorkspaceArtifactAuthor
  value: unknown
  review?: unknown
}

export interface ContentUnitArtifactState {
  locked: boolean
  revision: number
  previous?: ContentUnitSnapshot
  candidate?: ContentUnitSnapshot
}

export interface AssetRequirementArtifactState {
  status: AssetRequirementStatus
  analyzedRevision: number | null
  analyzedAt: string | null
  approvedAt: string | null
  assetIds: string[]
}

export interface ContentArtifactMeta {
  schemaVersion: 1
  status: WorkspaceArtifactStatus
  revision: number
  approvedRevision: number | null
  updatedAt: string
  updatedBy: WorkspaceArtifactAuthor
  units: Record<string, ContentUnitArtifactState>
  assetRequirements: AssetRequirementArtifactState
  latestImpact: WorkspaceImpactSummary | null
  downstream: {
    visualDesign: boolean
    storyboard: boolean
    production: boolean
  }
}

export type VisualAnchorKind = 'character' | 'location' | 'prop'
export type VisualAnchorSemanticKind = VisualAnchorKind | 'vehicle' | 'book_cover' | 'diagram'

export interface VisualAnchor {
  id: string
  assetId: string
  assetKind: VisualAnchorKind
  semanticKind: VisualAnchorSemanticKind
  name: string
  description: string
  importance: 'core' | 'supporting'
  sourceUnitIds: string[]
}

export interface StoredVisualPlan {
  shotPlan: unknown
  visualUnits: unknown[]
}

export interface VisualArtifactMeta {
  schemaVersion: 1
  status: WorkspaceArtifactStatus
  revision: number
  approvedRevision: number | null
  updatedAt: string
  updatedBy: WorkspaceArtifactAuthor
  anchors: VisualAnchor[]
  plan: StoredVisualPlan | null
  latestImpact: WorkspaceImpactSummary | null
  downstream: {
    storyboard: boolean
    production: boolean
  }
}

type JsonRecord = Record<string, unknown>

export function asWorkspaceRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

export function cloneWorkspaceValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function stripWorkspaceArtifactMeta<T>(value: T): T {
  const record = asWorkspaceRecord(value)
  if (!record) return value
  const next = cloneWorkspaceValue(record)
  delete next[WORKSPACE_ARTIFACT_META_KEY]
  return next as T
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readStatus(value: unknown, fallback: WorkspaceArtifactStatus): WorkspaceArtifactStatus {
  return value === 'draft' || value === 'needs_review' || value === 'approved' || value === 'stale'
    ? value
    : fallback
}

function readAuthor(value: unknown): WorkspaceArtifactAuthor {
  return value === 'user' ? 'user' : 'ai'
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function readSnapshot(value: unknown): ContentUnitSnapshot | undefined {
  const record = asWorkspaceRecord(value)
  if (!record) return undefined
  const unitId = readString(record.unitId).trim()
  const kind = record.kind === 'script_clip' ? 'script_clip' : 'guide_segment'
  if (!unitId || record.value === undefined) return undefined
  return {
    unitId,
    kind,
    revision: Math.max(1, Math.round(readNumber(record.revision, 1))),
    createdAt: readString(record.createdAt) || new Date(0).toISOString(),
    author: readAuthor(record.author),
    value: cloneWorkspaceValue(record.value),
    ...(record.review !== undefined ? { review: cloneWorkspaceValue(record.review) } : {}),
  }
}

function readUnitStates(value: unknown): Record<string, ContentUnitArtifactState> {
  const record = asWorkspaceRecord(value)
  if (!record) return {}
  const result: Record<string, ContentUnitArtifactState> = {}
  for (const [unitId, rawState] of Object.entries(record)) {
    const state = asWorkspaceRecord(rawState)
    if (!state) continue
    const previous = readSnapshot(state.previous)
    const candidate = readSnapshot(state.candidate)
    result[unitId] = {
      locked: state.locked === true,
      revision: Math.max(0, Math.round(readNumber(state.revision, 0))),
      ...(previous ? { previous } : {}),
      ...(candidate ? { candidate } : {}),
    }
  }
  return result
}

function readAssetRequirementStatus(value: unknown): AssetRequirementStatus {
  return value === 'needs_review' || value === 'approved' || value === 'stale'
    ? value
    : 'not_started'
}

function readAssetRequirements(value: unknown): AssetRequirementArtifactState {
  const record = asWorkspaceRecord(value)
  return {
    status: readAssetRequirementStatus(record?.status),
    analyzedRevision: typeof record?.analyzedRevision === 'number'
      ? Math.max(1, Math.round(record.analyzedRevision))
      : null,
    analyzedAt: readString(record?.analyzedAt) || null,
    approvedAt: readString(record?.approvedAt) || null,
    assetIds: [...new Set(readStringArray(record?.assetIds))],
  }
}

function readImpact(value: unknown): WorkspaceImpactSummary | null {
  const record = asWorkspaceRecord(value)
  if (!record) return null
  return {
    sourceUnitIds: readStringArray(record.sourceUnitIds),
    affectedStageIds: readStringArray(record.affectedStageIds)
      .filter((item): item is CreationStageId => (
        item === 'setup'
        || item === 'content'
        || item === 'visual-design'
        || item === 'storyboard-preview'
        || item === 'production'
        || item === 'edit'
      )),
    storyboardCount: Math.max(0, Math.round(readNumber(record.storyboardCount, 0))),
    panelCount: Math.max(0, Math.round(readNumber(record.panelCount, 0))),
    videoCount: Math.max(0, Math.round(readNumber(record.videoCount, 0))),
    createdAt: readString(record.createdAt) || new Date(0).toISOString(),
  }
}

export function createContentArtifactMeta(now: string, author: WorkspaceArtifactAuthor = 'ai'): ContentArtifactMeta {
  return {
    schemaVersion: 1,
    status: 'needs_review',
    revision: 1,
    approvedRevision: null,
    updatedAt: now,
    updatedBy: author,
    units: {},
    assetRequirements: {
      status: 'not_started',
      analyzedRevision: null,
      analyzedAt: null,
      approvedAt: null,
      assetIds: [],
    },
    latestImpact: null,
    downstream: {
      visualDesign: false,
      storyboard: false,
      production: false,
    },
  }
}

export function readContentArtifactMeta(value: unknown): ContentArtifactMeta | null {
  const plan = asWorkspaceRecord(value)
  const meta = asWorkspaceRecord(plan?.[WORKSPACE_ARTIFACT_META_KEY])
  if (!meta) return null
  const downstream = asWorkspaceRecord(meta.downstream)
  return {
    schemaVersion: 1,
    status: readStatus(meta.status, 'needs_review'),
    revision: Math.max(1, Math.round(readNumber(meta.revision, 1))),
    approvedRevision: typeof meta.approvedRevision === 'number'
      ? Math.max(1, Math.round(meta.approvedRevision))
      : null,
    updatedAt: readString(meta.updatedAt) || new Date(0).toISOString(),
    updatedBy: readAuthor(meta.updatedBy),
    units: readUnitStates(meta.units),
    assetRequirements: readAssetRequirements(meta.assetRequirements),
    latestImpact: readImpact(meta.latestImpact),
    downstream: {
      visualDesign: downstream?.visualDesign === true,
      storyboard: downstream?.storyboard === true,
      production: downstream?.production === true,
    },
  }
}

export function withContentArtifactMeta<T>(value: T, meta: ContentArtifactMeta): T {
  const plan = asWorkspaceRecord(value)
  if (!plan) return value
  return {
    ...cloneWorkspaceValue(plan),
    [WORKSPACE_ARTIFACT_META_KEY]: cloneWorkspaceValue(meta),
  } as T
}

function readVisualAnchor(value: unknown): VisualAnchor | null {
  const record = asWorkspaceRecord(value)
  if (!record) return null
  const assetId = readString(record.assetId).trim()
  const name = readString(record.name).trim()
  const assetKind = record.assetKind === 'character' || record.assetKind === 'prop'
    ? record.assetKind
    : 'location'
  const allowedSemanticKinds = new Set<VisualAnchorSemanticKind>([
    'character',
    'location',
    'prop',
    'vehicle',
    'book_cover',
    'diagram',
  ])
  const semanticKind = typeof record.semanticKind === 'string'
    && allowedSemanticKinds.has(record.semanticKind as VisualAnchorSemanticKind)
    ? record.semanticKind as VisualAnchorSemanticKind
    : assetKind
  if (!assetId || !name) return null
  return {
    id: readString(record.id).trim() || `${assetKind}:${assetId}`,
    assetId,
    assetKind,
    semanticKind,
    name,
    description: readString(record.description),
    importance: record.importance === 'supporting' ? 'supporting' : 'core',
    sourceUnitIds: readStringArray(record.sourceUnitIds),
  }
}

export function createVisualArtifactMeta(now: string, author: WorkspaceArtifactAuthor = 'ai'): VisualArtifactMeta {
  return {
    schemaVersion: 1,
    status: 'needs_review',
    revision: 1,
    approvedRevision: null,
    updatedAt: now,
    updatedBy: author,
    anchors: [],
    plan: null,
    latestImpact: null,
    downstream: {
      storyboard: false,
      production: false,
    },
  }
}

export function readVisualArtifactMeta(value: unknown): VisualArtifactMeta | null {
  const bible = asWorkspaceRecord(value)
  const meta = asWorkspaceRecord(bible?.[WORKSPACE_ARTIFACT_META_KEY])
  if (!meta) return null
  const downstream = asWorkspaceRecord(meta.downstream)
  const plan = asWorkspaceRecord(meta.plan)
  return {
    schemaVersion: 1,
    status: readStatus(meta.status, 'needs_review'),
    revision: Math.max(1, Math.round(readNumber(meta.revision, 1))),
    approvedRevision: typeof meta.approvedRevision === 'number'
      ? Math.max(1, Math.round(meta.approvedRevision))
      : null,
    updatedAt: readString(meta.updatedAt) || new Date(0).toISOString(),
    updatedBy: readAuthor(meta.updatedBy),
    anchors: (Array.isArray(meta.anchors) ? meta.anchors : [])
      .map(readVisualAnchor)
      .filter((item): item is VisualAnchor => !!item),
    plan: plan
      ? {
          shotPlan: cloneWorkspaceValue(plan.shotPlan),
          visualUnits: Array.isArray(plan.visualUnits) ? cloneWorkspaceValue(plan.visualUnits) : [],
        }
      : null,
    latestImpact: readImpact(meta.latestImpact),
    downstream: {
      storyboard: downstream?.storyboard === true,
      production: downstream?.production === true,
    },
  }
}

export function withVisualArtifactMeta<T>(value: T, meta: VisualArtifactMeta): T {
  const bible = asWorkspaceRecord(value) || {}
  return {
    ...cloneWorkspaceValue(bible),
    [WORKSPACE_ARTIFACT_META_KEY]: cloneWorkspaceValue(meta),
  } as T
}

export function createUnitSnapshot(params: {
  unitId: string
  kind: ContentUnitKind
  revision: number
  author: WorkspaceArtifactAuthor
  value: unknown
  review?: unknown
  now: string
}): ContentUnitSnapshot {
  return {
    unitId: params.unitId,
    kind: params.kind,
    revision: params.revision,
    createdAt: params.now,
    author: params.author,
    value: cloneWorkspaceValue(params.value),
    ...(params.review !== undefined ? { review: cloneWorkspaceValue(params.review) } : {}),
  }
}

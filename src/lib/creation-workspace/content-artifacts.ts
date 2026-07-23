import type { ContentPlan, GuideContentPlan, GuideSegment } from '@/lib/content-planning'
import type { AssetBibleItem } from '@/lib/assets/asset-bible'
import type { AssetBibleReviewResult } from '@/lib/assets/asset-bible-review'
import {
  cloneWorkspaceValue,
  createContentArtifactMeta,
  createUnitSnapshot,
  readContentArtifactMeta,
  withContentArtifactMeta,
  type ContentArtifactMeta,
  type ContentUnitArtifactState,
  type ContentUnitKind,
  type WorkspaceArtifactAuthor,
  type WorkspaceImpactSummary,
} from './artifact-state'

function isGuidePlan(value: ContentPlan | unknown): value is GuideContentPlan {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { planType?: unknown }).planType === 'guide'
    && Array.isArray((value as { segments?: unknown }).segments)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function segmentMap(plan: ContentPlan | unknown): Map<string, GuideSegment> {
  if (!isGuidePlan(plan)) return new Map()
  return new Map(plan.segments.map((segment) => [segment.id, segment]))
}

function ensureUnitState(
  meta: ContentArtifactMeta,
  unitId: string,
): ContentUnitArtifactState {
  return meta.units[unitId] || { locked: false, revision: 0 }
}

function invalidateAssetRequirements(meta: ContentArtifactMeta) {
  if (meta.assetRequirements.status === 'not_started') return
  meta.assetRequirements = {
    ...meta.assetRequirements,
    status: 'stale',
    approvedAt: null,
  }
}

function preserveLockedGuideSegments(
  existingPlan: ContentPlan | unknown,
  generatedPlan: ContentPlan,
  meta: ContentArtifactMeta,
): ContentPlan {
  if (!isGuidePlan(existingPlan) || !isGuidePlan(generatedPlan)) return generatedPlan
  const next = cloneWorkspaceValue(generatedPlan)
  const existingOutline = new Map(existingPlan.outline.map((item) => [item.id, item]))
  const outlineIds = new Set(next.outline.map((item) => item.id))

  for (let oldIndex = 0; oldIndex < existingPlan.segments.length; oldIndex += 1) {
    const previous = existingPlan.segments[oldIndex]
    if (!meta.units[previous.id]?.locked) continue
    if (!outlineIds.has(previous.outlineId)) {
      const outlineItem = existingOutline.get(previous.outlineId)
      if (outlineItem) {
        next.outline.push(cloneWorkspaceValue(outlineItem))
        outlineIds.add(previous.outlineId)
      }
    }
    const targetIndex = next.segments.findIndex((segment) => (
      segment.id === previous.id || segment.title === previous.title
    ))
    if (targetIndex >= 0) {
      next.segments[targetIndex] = cloneWorkspaceValue(previous)
    } else {
      next.segments.splice(Math.min(oldIndex, next.segments.length), 0, cloneWorkspaceValue(previous))
    }
  }
  return next
}

export function prepareGeneratedContentPlan(params: {
  existingPlan: unknown
  generatedPlan: ContentPlan
  now: string
}): ContentPlan {
  const existingMeta = readContentArtifactMeta(params.existingPlan)
  const meta = existingMeta
    ? cloneWorkspaceValue(existingMeta)
    : createContentArtifactMeta(params.now, 'ai')
  const generatedPlan = preserveLockedGuideSegments(params.existingPlan, params.generatedPlan, meta)
  const previousSegments = segmentMap(params.existingPlan)
  const nextSegments = segmentMap(generatedPlan)
  const revision = existingMeta ? existingMeta.revision + 1 : 1

  for (const [unitId, nextSegment] of nextSegments) {
    const currentState = ensureUnitState(meta, unitId)
    const previousSegment = previousSegments.get(unitId)
    if (previousSegment && !sameValue(previousSegment, nextSegment) && !currentState.locked) {
      currentState.previous = createUnitSnapshot({
        unitId,
        kind: 'guide_segment',
        revision: currentState.revision || meta.revision,
        author: meta.updatedBy,
        value: previousSegment,
        now: params.now,
      })
      currentState.revision += 1
    }
    currentState.candidate = undefined
    meta.units[unitId] = currentState
  }

  meta.status = 'needs_review'
  meta.revision = revision
  meta.updatedAt = params.now
  meta.updatedBy = 'ai'
  if (existingMeta) invalidateAssetRequirements(meta)
  meta.latestImpact = existingMeta
    ? {
        sourceUnitIds: [...nextSegments.keys()],
        affectedStageIds: ['visual-design', 'storyboard-preview', 'production'],
        storyboardCount: 0,
        panelCount: 0,
        videoCount: 0,
        createdAt: params.now,
      }
    : null
  meta.downstream = {
    visualDesign: !!existingMeta,
    storyboard: !!existingMeta,
    production: !!existingMeta,
  }
  return withContentArtifactMeta(generatedPlan, meta)
}

export function prepareEditedContentPlan(params: {
  existingPlan: unknown
  nextPlan: ContentPlan
  changedUnitIds: string[]
  impact: WorkspaceImpactSummary
  now: string
  author?: WorkspaceArtifactAuthor
  kind?: ContentUnitKind
}): ContentPlan {
  const meta = cloneWorkspaceValue(
    readContentArtifactMeta(params.existingPlan) || createContentArtifactMeta(params.now, 'user'),
  )
  const previousSegments = segmentMap(params.existingPlan)
  const nextSegments = segmentMap(params.nextPlan)
  const author = params.author || 'user'
  const kind = params.kind || 'guide_segment'

  for (const unitId of new Set(params.changedUnitIds)) {
    const currentState = ensureUnitState(meta, unitId)
    if (currentState.locked) throw new Error(`CONTENT_UNIT_LOCKED:${unitId}`)
    const previousValue = previousSegments.get(unitId)
    if (previousValue) {
      currentState.previous = createUnitSnapshot({
        unitId,
        kind,
        revision: currentState.revision || meta.revision,
        author: meta.updatedBy,
        value: previousValue,
        now: params.now,
      })
    }
    currentState.revision += 1
    currentState.candidate = undefined
    meta.units[unitId] = currentState
  }

  for (const [unitId] of nextSegments) {
    meta.units[unitId] ||= { locked: false, revision: 0 }
  }
  meta.status = 'needs_review'
  meta.revision += 1
  meta.updatedAt = params.now
  meta.updatedBy = author
  invalidateAssetRequirements(meta)
  meta.latestImpact = cloneWorkspaceValue(params.impact)
  meta.downstream = {
    visualDesign: true,
    storyboard: true,
    production: true,
  }
  return withContentArtifactMeta(params.nextPlan, meta)
}

export function markExternalContentUnitEdited(params: {
  contentPlan: unknown
  unitId: string
  kind: ContentUnitKind
  previousValue: unknown
  impact: WorkspaceImpactSummary
  now: string
  author?: WorkspaceArtifactAuthor
}): unknown {
  const meta = cloneWorkspaceValue(
    readContentArtifactMeta(params.contentPlan) || createContentArtifactMeta(params.now, 'user'),
  )
  const state = ensureUnitState(meta, params.unitId)
  if (state.locked) throw new Error(`CONTENT_UNIT_LOCKED:${params.unitId}`)
  state.previous = createUnitSnapshot({
    unitId: params.unitId,
    kind: params.kind,
    revision: state.revision || meta.revision,
    author: meta.updatedBy,
    value: params.previousValue,
    now: params.now,
  })
  state.revision += 1
  state.candidate = undefined
  meta.units[params.unitId] = state
  meta.status = 'needs_review'
  meta.revision += 1
  meta.updatedAt = params.now
  meta.updatedBy = params.author || 'user'
  invalidateAssetRequirements(meta)
  meta.latestImpact = cloneWorkspaceValue(params.impact)
  meta.downstream = {
    visualDesign: true,
    storyboard: true,
    production: true,
  }
  return withContentArtifactMeta(params.contentPlan, meta)
}

export function setContentUnitLock(params: {
  contentPlan: unknown
  unitId: string
  locked: boolean
  now: string
}): unknown {
  const meta = cloneWorkspaceValue(
    readContentArtifactMeta(params.contentPlan) || createContentArtifactMeta(params.now, 'user'),
  )
  const state = ensureUnitState(meta, params.unitId)
  state.locked = params.locked
  meta.units[params.unitId] = state
  meta.updatedAt = params.now
  meta.updatedBy = 'user'
  return withContentArtifactMeta(params.contentPlan, meta)
}

export function approveContentArtifact(contentPlan: unknown, now: string): unknown {
  const meta = cloneWorkspaceValue(
    readContentArtifactMeta(contentPlan) || createContentArtifactMeta(now, 'user'),
  )
  const pendingCandidate = Object.values(meta.units).some((state) => !!state.candidate)
  if (pendingCandidate) throw new Error('CONTENT_CANDIDATE_PENDING')
  meta.status = 'approved'
  meta.approvedRevision = meta.revision
  meta.updatedAt = now
  meta.updatedBy = 'user'
  return withContentArtifactMeta(contentPlan, meta)
}

export function readReusableApprovedContentPlanState(contentPlan: unknown): {
  revision: number
  approvedRevision: number
  updatedAt: string
  assetRequirementStatus: ContentArtifactMeta['assetRequirements']['status']
  unitCount: number
  lockedUnitCount: number
} | null {
  const meta = readContentArtifactMeta(contentPlan)
  const approvedRevision = meta?.approvedRevision
  if (!meta || meta.status !== 'approved' || approvedRevision === null || approvedRevision !== meta.revision) return null
  return {
    revision: meta.revision,
    approvedRevision,
    updatedAt: meta.updatedAt,
    assetRequirementStatus: meta.assetRequirements.status,
    unitCount: Object.keys(meta.units).length,
    lockedUnitCount: Object.values(meta.units).filter((state) => state.locked).length,
  }
}

export function readReusableApprovedAssetRequirementsState(contentPlan: unknown): {
  contentRevision: number
  analyzedRevision: number
  approvedAt: string | null
  assetIds: string[]
  assetBible: AssetBibleItem[]
  review: AssetBibleReviewResult | null
} | null {
  const meta = readContentArtifactMeta(contentPlan)
  if (!meta) return null
  const requirements = meta.assetRequirements
  if (
    requirements.status !== 'approved'
    || requirements.analyzedRevision === null
    || requirements.analyzedRevision !== meta.revision
  ) {
    return null
  }
  return {
    contentRevision: meta.revision,
    analyzedRevision: requirements.analyzedRevision,
    approvedAt: requirements.approvedAt,
    assetIds: cloneWorkspaceValue(requirements.assetIds),
    assetBible: cloneWorkspaceValue(requirements.assetBible),
    review: requirements.review ? cloneWorkspaceValue(requirements.review) : null,
  }
}

export function markContentAssetRequirementsAnalyzed(params: {
  contentPlan: unknown
  assetIds: string[]
  assetBible?: AssetBibleItem[]
  review?: AssetBibleReviewResult
  now: string
}): unknown {
  const meta = cloneWorkspaceValue(
    readContentArtifactMeta(params.contentPlan) || createContentArtifactMeta(params.now, 'ai'),
  )
  meta.assetRequirements = {
    status: 'needs_review',
    analyzedRevision: meta.revision,
    analyzedAt: params.now,
    approvedAt: null,
    assetIds: [...new Set(params.assetIds.filter(Boolean))],
    assetBible: cloneWorkspaceValue(params.assetBible || []),
    review: params.review ? cloneWorkspaceValue(params.review) : null,
  }
  meta.updatedAt = params.now
  meta.updatedBy = 'ai'
  return withContentArtifactMeta(params.contentPlan, meta)
}

export function approveContentAssetRequirements(contentPlan: unknown, now: string): unknown {
  const meta = readContentArtifactMeta(contentPlan)
  if (!meta || meta.status !== 'approved') throw new Error('CONTENT_NOT_APPROVED')
  if (meta.assetRequirements.status !== 'needs_review') {
    throw new Error('ASSET_REQUIREMENTS_NOT_READY')
  }
  if (meta.assetRequirements.analyzedRevision !== meta.revision) {
    throw new Error('ASSET_REQUIREMENTS_STALE')
  }
  const next = cloneWorkspaceValue(meta)
  next.assetRequirements.status = 'approved'
  next.assetRequirements.approvedAt = now
  next.updatedAt = now
  next.updatedBy = 'user'
  return withContentArtifactMeta(contentPlan, next)
}

export function storeContentUnitCandidate(params: {
  contentPlan: unknown
  unitId: string
  kind: ContentUnitKind
  value: unknown
  review?: unknown
  now: string
}): unknown {
  const meta = cloneWorkspaceValue(
    readContentArtifactMeta(params.contentPlan) || createContentArtifactMeta(params.now, 'ai'),
  )
  const state = ensureUnitState(meta, params.unitId)
  if (state.locked) throw new Error(`CONTENT_UNIT_LOCKED:${params.unitId}`)
  state.candidate = createUnitSnapshot({
    unitId: params.unitId,
    kind: params.kind,
    revision: Math.max(1, state.revision + 1),
    author: 'ai',
    value: params.value,
    review: params.review,
    now: params.now,
  })
  meta.units[params.unitId] = state
  meta.status = 'needs_review'
  meta.updatedAt = params.now
  meta.updatedBy = 'ai'
  return withContentArtifactMeta(params.contentPlan, meta)
}

export function clearContentUnitCandidate(contentPlan: unknown, unitId: string, now: string): unknown {
  const meta = readContentArtifactMeta(contentPlan)
  if (!meta?.units[unitId]?.candidate) return contentPlan
  const next = cloneWorkspaceValue(meta)
  delete next.units[unitId].candidate
  next.updatedAt = now
  next.updatedBy = 'user'
  return withContentArtifactMeta(contentPlan, next)
}

export function readGuideSegment(contentPlan: unknown, unitId: string): GuideSegment | null {
  if (!isGuidePlan(contentPlan)) return null
  return contentPlan.segments.find((segment) => segment.id === unitId) || null
}

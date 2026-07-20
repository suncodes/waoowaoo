import { describe, expect, it } from 'vitest'
import {
  createContentArtifactMeta,
  readContentArtifactMeta,
  withContentArtifactMeta,
} from '@/lib/creation-workspace/artifact-state'
import {
  approveContentAssetRequirements,
  markContentAssetRequirementsAnalyzed,
  markExternalContentUnitEdited,
} from '@/lib/creation-workspace/content-artifacts'

function approvedContentPlan() {
  const meta = createContentArtifactMeta('2026-07-20T00:00:00.000Z', 'user')
  meta.status = 'approved'
  meta.approvedRevision = meta.revision
  return withContentArtifactMeta({
    planType: 'guide',
    title: 'Guide',
    thesis: 'Thesis',
    recommendationAngle: 'Angle',
    outline: [],
    segments: [],
  }, meta)
}

describe('content asset requirement state', () => {
  it('persists an analyzed empty result and allows explicit approval', () => {
    const analyzed = markContentAssetRequirementsAnalyzed({
      contentPlan: approvedContentPlan(),
      assetIds: [],
      now: '2026-07-20T01:00:00.000Z',
    })
    expect(readContentArtifactMeta(analyzed)?.assetRequirements).toEqual({
      status: 'needs_review',
      analyzedRevision: 1,
      analyzedAt: '2026-07-20T01:00:00.000Z',
      approvedAt: null,
      assetIds: [],
    })

    const approved = approveContentAssetRequirements(analyzed, '2026-07-20T01:05:00.000Z')
    expect(readContentArtifactMeta(approved)?.assetRequirements.status).toBe('approved')
    expect(readContentArtifactMeta(approved)?.assetRequirements.approvedAt).toBe('2026-07-20T01:05:00.000Z')
  })

  it('marks the analyzed requirements stale after the content changes', () => {
    const approved = approveContentAssetRequirements(markContentAssetRequirementsAnalyzed({
      contentPlan: approvedContentPlan(),
      assetIds: ['asset-nautilus'],
      now: '2026-07-20T01:00:00.000Z',
    }), '2026-07-20T01:05:00.000Z')

    const edited = markExternalContentUnitEdited({
      contentPlan: approved,
      unitId: 'segment-1',
      kind: 'guide_segment',
      previousValue: { narration: 'before' },
      impact: {
        sourceUnitIds: ['segment-1'],
        affectedStageIds: ['visual-design', 'storyboard-preview', 'production'],
        storyboardCount: 1,
        panelCount: 3,
        videoCount: 1,
        createdAt: '2026-07-20T02:00:00.000Z',
      },
      now: '2026-07-20T02:00:00.000Z',
    })

    const meta = readContentArtifactMeta(edited)
    expect(meta?.status).toBe('needs_review')
    expect(meta?.assetRequirements.status).toBe('stale')
    expect(meta?.assetRequirements.assetIds).toEqual(['asset-nautilus'])
  })
})

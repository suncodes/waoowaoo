import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { compareDiagnosticQualityArchives } from '@/lib/diagnostics/quality-diff'

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n')
}

async function archive(params: {
  promptHash: string
  assetIds: string[]
  assetBibleReuseCount: number
  contentScore: number
  contentPlanReuseCount: number
  scriptScore: number
  storyboardScore: number
  promptQualityScore: number
  visualScore: number
  visualPlanReuseCount: number
  roughCutScore: number
  pickupCount: number
  repairBefore: number
  repairAfter: number
}): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({
    schemaVersion: 7,
    counts: {
      pickupItems: params.pickupCount,
      assetBibleReuses: params.assetBibleReuseCount,
      contentPlanReuses: params.contentPlanReuseCount,
      visualPlanReuses: params.visualPlanReuseCount,
    },
  }))
  zip.file('quality/quality-index.json', JSON.stringify({}))
  zip.file('quality/asset-bible.jsonl', jsonl(params.assetIds.map((assetId) => ({
    id: assetId,
    canonicalName: assetId === 'asset-1' ? '尼摩船长' : '鹦鹉螺号潜水艇',
  }))))
  zip.file('quality/asset-bible-reviews.jsonl', jsonl([{ score: 82 }]))
  zip.file('quality/asset-bible-reuse.jsonl', jsonl(Array.from({ length: params.assetBibleReuseCount }, (_, index) => ({
    refId: `episode-${index + 1}`,
    payload: { reason: 'approved_asset_requirements_reused' },
  }))))
  zip.file('quality/content-quality-reviews.jsonl', jsonl([{ payload: { review: { score: params.contentScore } } }]))
  zip.file('quality/content-plan-reuse.jsonl', jsonl(Array.from({ length: params.contentPlanReuseCount }, (_, index) => ({
    refId: `episode-${index + 1}`,
    payload: { reason: 'approved_content_plan_reused' },
  }))))
  zip.file('quality/script-reviews.jsonl', jsonl([{ score: params.scriptScore }]))
  zip.file('quality/storyboard-quality-reviews.jsonl', jsonl([{ payload: { review: { score: params.storyboardScore } } }]))
  zip.file('quality/prompt-snapshots.jsonl', jsonl([{
    refId: 'panel-1',
    versionHash: params.promptHash,
    payload: { targetId: 'panel-1', promptHash: params.promptHash },
  }]))
  zip.file('quality/prompt-quality-reviews.jsonl', jsonl([{ score: params.promptQualityScore }]))
  zip.file('quality/visual-quality-reviews.jsonl', jsonl([{ payload: { review: { score: params.visualScore } } }]))
  zip.file('quality/visual-plan-reuse.jsonl', jsonl(Array.from({ length: params.visualPlanReuseCount }, (_, index) => ({
    refId: `episode-${index + 1}`,
    payload: { reason: 'approved_visual_plan_reused' },
  }))))
  zip.file('quality/visual-auto-repairs.jsonl', jsonl([{ refId: 'panel-1' }]))
  zip.file('quality/visual-repair-lineage.jsonl', jsonl([{
    targetId: 'panel-1',
    scoreBefore: params.repairBefore,
    scoreAfter: params.repairAfter,
    accepted: true,
  }]))
  zip.file('quality/rough-cut-reviews.jsonl', jsonl([{ score: params.roughCutScore }]))
  zip.file('quality/pickup-list.jsonl', jsonl(Array.from({ length: params.pickupCount }, (_, index) => ({
    id: `pickup-${index + 1}`,
  }))))
  return await zip.generateAsync({ type: 'nodebuffer' })
}

describe('diagnostic quality diff', () => {
  it('compares quality files across two diagnostic archives', async () => {
    const comparison = await compareDiagnosticQualityArchives({
      left: await archive({
        promptHash: 'prompt-old',
        assetIds: ['asset-1'],
        assetBibleReuseCount: 0,
        contentScore: 72,
        contentPlanReuseCount: 0,
        scriptScore: 74,
        storyboardScore: 76,
        promptQualityScore: 65,
        visualScore: 70,
        visualPlanReuseCount: 0,
        roughCutScore: 68,
        pickupCount: 5,
        repairBefore: 50,
        repairAfter: 70,
      }),
      right: await archive({
        promptHash: 'prompt-new',
        assetIds: ['asset-1', 'asset-2'],
        assetBibleReuseCount: 1,
        contentScore: 85,
        contentPlanReuseCount: 1,
        scriptScore: 89,
        storyboardScore: 88,
        promptQualityScore: 93,
        visualScore: 91,
        visualPlanReuseCount: 1,
        roughCutScore: 84,
        pickupCount: 2,
        repairBefore: 60,
        repairAfter: 90,
      }),
    })

    expect(comparison.deltas.assetBibleCount).toBe(1)
    expect(comparison.deltas.assetBibleReuseCount).toBe(1)
    expect(comparison.deltas.contentPlanReuseCount).toBe(1)
    expect(comparison.scoreAverages.contentQualityReview.delta).toBe(13)
    expect(comparison.scoreAverages.scriptReview.delta).toBe(15)
    expect(comparison.scoreAverages.storyboardQualityReview.delta).toBe(12)
    expect(comparison.scoreAverages.promptQualityReview.delta).toBe(28)
    expect(comparison.scoreAverages.visualQualityReview.delta).toBe(21)
    expect(comparison.deltas.visualPlanReuseCount).toBe(1)
    expect(comparison.scoreAverages.roughCutReview.delta).toBe(16)
    expect(comparison.scoreAverages.repairImprovement.delta).toBe(10)
    expect(comparison.deltas.pickupItemCount).toBe(-3)
    expect(comparison.promptHashChanges.changedTargets).toEqual([{
      targetId: 'panel-1',
      leftHash: 'prompt-old',
      rightHash: 'prompt-new',
    }])
    expect(comparison.assetBibleChanges.addedAssetIds).toEqual(['asset-2'])
    expect(comparison.findings).toEqual(expect.arrayContaining([
      expect.stringContaining('storyboard_review 平均分变化 12'),
      expect.stringContaining('content_quality_review 平均分变化 13'),
      expect.stringContaining('script_review 平均分变化 15'),
      expect.stringContaining('prompt_quality_review 平均分变化 28'),
      expect.stringContaining('rough_cut_review 平均分变化 16'),
      expect.stringContaining('assetBibleReuses 变化'),
      expect.stringContaining('contentPlanReuses 变化'),
      expect.stringContaining('visualPlanReuses 变化'),
      expect.stringContaining('pickupItems 变化 -3'),
      expect.stringContaining('compiled prompt hash'),
    ]))
  })
})

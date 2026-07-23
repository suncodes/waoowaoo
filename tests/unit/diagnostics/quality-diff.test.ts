import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { compareDiagnosticQualityArchives } from '@/lib/diagnostics/quality-diff'

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n')
}

async function archive(params: {
  promptHash: string
  assetIds: string[]
  contentScore: number
  storyboardScore: number
  visualScore: number
  repairBefore: number
  repairAfter: number
}): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({ schemaVersion: 3 }))
  zip.file('quality/quality-index.json', JSON.stringify({}))
  zip.file('quality/asset-bible.jsonl', jsonl(params.assetIds.map((assetId) => ({
    id: assetId,
    canonicalName: assetId === 'asset-1' ? '尼摩船长' : '鹦鹉螺号潜水艇',
  }))))
  zip.file('quality/asset-bible-reviews.jsonl', jsonl([{ score: 82 }]))
  zip.file('quality/content-quality-reviews.jsonl', jsonl([{ payload: { review: { score: params.contentScore } } }]))
  zip.file('quality/storyboard-quality-reviews.jsonl', jsonl([{ payload: { review: { score: params.storyboardScore } } }]))
  zip.file('quality/prompt-snapshots.jsonl', jsonl([{
    refId: 'panel-1',
    versionHash: params.promptHash,
    payload: { targetId: 'panel-1', promptHash: params.promptHash },
  }]))
  zip.file('quality/visual-quality-reviews.jsonl', jsonl([{ payload: { review: { score: params.visualScore } } }]))
  zip.file('quality/visual-auto-repairs.jsonl', jsonl([{ refId: 'panel-1' }]))
  zip.file('quality/visual-repair-lineage.jsonl', jsonl([{
    targetId: 'panel-1',
    scoreBefore: params.repairBefore,
    scoreAfter: params.repairAfter,
    accepted: true,
  }]))
  return await zip.generateAsync({ type: 'nodebuffer' })
}

describe('diagnostic quality diff', () => {
  it('compares quality files across two diagnostic archives', async () => {
    const comparison = await compareDiagnosticQualityArchives({
      left: await archive({
        promptHash: 'prompt-old',
        assetIds: ['asset-1'],
        contentScore: 72,
        storyboardScore: 76,
        visualScore: 70,
        repairBefore: 50,
        repairAfter: 70,
      }),
      right: await archive({
        promptHash: 'prompt-new',
        assetIds: ['asset-1', 'asset-2'],
        contentScore: 85,
        storyboardScore: 88,
        visualScore: 91,
        repairBefore: 60,
        repairAfter: 90,
      }),
    })

    expect(comparison.deltas.assetBibleCount).toBe(1)
    expect(comparison.scoreAverages.contentQualityReview.delta).toBe(13)
    expect(comparison.scoreAverages.storyboardQualityReview.delta).toBe(12)
    expect(comparison.scoreAverages.visualQualityReview.delta).toBe(21)
    expect(comparison.scoreAverages.repairImprovement.delta).toBe(10)
    expect(comparison.promptHashChanges.changedTargets).toEqual([{
      targetId: 'panel-1',
      leftHash: 'prompt-old',
      rightHash: 'prompt-new',
    }])
    expect(comparison.assetBibleChanges.addedAssetIds).toEqual(['asset-2'])
    expect(comparison.findings).toEqual(expect.arrayContaining([
      expect.stringContaining('storyboard_review 平均分变化 12'),
      expect.stringContaining('content_quality_review 平均分变化 13'),
      expect.stringContaining('compiled prompt hash'),
    ]))
  })
})

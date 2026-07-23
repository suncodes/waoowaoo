import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  compareDiagnosticQualityArchives,
  type DiagnosticQualityComparison,
} from '../src/lib/diagnostics/quality-diff'

function parseArgs(argv: string[]) {
  const json = argv.includes('--json')
  const positional = argv.filter((item) => item !== '--json')
  return {
    json,
    leftPath: positional[0],
    rightPath: positional[1],
  }
}

function countLine(
  label: string,
  delta: { left: number | null; right: number | null; delta: number | null } | undefined,
): string {
  if (!delta) return `${label}: n/a`
  return `${label}: ${delta.left ?? 'n/a'} -> ${delta.right ?? 'n/a'} (${delta.delta === null ? 'n/a' : delta.delta >= 0 ? `+${delta.delta}` : delta.delta})`
}

function scoreLine(
  label: string,
  score: { left: number | null; right: number | null; delta: number | null },
): string {
  return countLine(label, score)
}

function formatReport(comparison: DiagnosticQualityComparison): string {
  const lines = [
    '# Diagnostic Quality Diff',
    '',
    '## Score Averages',
    scoreLine('contentQualityReview', comparison.scoreAverages.contentQualityReview),
    scoreLine('scriptReview', comparison.scoreAverages.scriptReview),
    scoreLine('assetBibleReview', comparison.scoreAverages.assetBibleReview),
    scoreLine('storyboardQualityReview', comparison.scoreAverages.storyboardQualityReview),
    scoreLine('promptQualityReview', comparison.scoreAverages.promptQualityReview),
    scoreLine('visualQualityReview', comparison.scoreAverages.visualQualityReview),
    scoreLine('roughCutReview', comparison.scoreAverages.roughCutReview),
    scoreLine('repairImprovement', comparison.scoreAverages.repairImprovement),
    '',
    '## Count Deltas',
    countLine('tasks', comparison.manifestCountDeltas.tasks),
    countLine('runs', comparison.manifestCountDeltas.runs),
    countLine('modelInvocations', comparison.manifestCountDeltas.modelInvocations),
    countLine('assetBibleReuses', comparison.manifestCountDeltas.assetBibleReuses),
    countLine('contentPlanReuses', comparison.manifestCountDeltas.contentPlanReuses),
    countLine('visualPlanReuses', comparison.manifestCountDeltas.visualPlanReuses),
    countLine('promptSnapshots', comparison.manifestCountDeltas.promptSnapshots),
    countLine('promptQualityReviews', comparison.manifestCountDeltas.promptQualityReviews),
    countLine('visualQualityReviews', comparison.manifestCountDeltas.visualQualityReviews),
    countLine('visualAutoRepairs', comparison.manifestCountDeltas.visualAutoRepairs),
    countLine('pickupItems', comparison.manifestCountDeltas.pickupItems),
    '',
    '## Prompt / Asset Changes',
    `promptHashChangedTargets: ${comparison.promptHashChanges.changedTargets.length}`,
    `promptHashAddedTargets: ${comparison.promptHashChanges.addedTargets.length}`,
    `promptHashRemovedTargets: ${comparison.promptHashChanges.removedTargets.length}`,
    `assetAdded: ${comparison.assetBibleChanges.addedAssetIds.length}`,
    `assetRemoved: ${comparison.assetBibleChanges.removedAssetIds.length}`,
    `assetRenamed: ${comparison.assetBibleChanges.renamedAssets.length}`,
    '',
    '## Findings',
    ...(comparison.findings.length > 0 ? comparison.findings.map((item) => `- ${item}`) : ['- no findings']),
  ]
  const missingFiles = [...new Set([...comparison.left.missingFiles, ...comparison.right.missingFiles])]
  if (missingFiles.length > 0) {
    lines.push('', '## Missing Quality Files', ...missingFiles.map((item) => `- ${item}`))
  }
  return lines.join('\n')
}

async function main() {
  const { leftPath, rightPath, json } = parseArgs(process.argv.slice(2))
  if (!leftPath || !rightPath) {
    console.error('Usage: npx tsx scripts/diagnostic-quality-diff.ts [--json] <left.zip> <right.zip>')
    process.exitCode = 1
    return
  }

  const [left, right] = await Promise.all([
    readFile(path.resolve(process.cwd(), leftPath)),
    readFile(path.resolve(process.cwd(), rightPath)),
  ])
  const comparison = await compareDiagnosticQualityArchives({ left, right })
  console.log(json ? JSON.stringify(comparison, null, 2) : formatReport(comparison))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

import JSZip from 'jszip'

type JsonRecord = Record<string, unknown>

export interface DiagnosticQualityArchiveSummary {
  manifest: JsonRecord | null
  qualityIndex: JsonRecord | null
  missingFiles: string[]
  assetBible: JsonRecord[]
  assetBibleReviews: JsonRecord[]
  contentQualityReviews: JsonRecord[]
  storyboardQualityReviews: JsonRecord[]
  promptSnapshots: JsonRecord[]
  visualQualityReviews: JsonRecord[]
  visualAutoRepairs: JsonRecord[]
  visualRepairLineage: JsonRecord[]
}

export interface DiagnosticQualityComparison {
  left: DiagnosticQualityArchiveSummary
  right: DiagnosticQualityArchiveSummary
  manifestCountDeltas: Record<string, { left: number | null; right: number | null; delta: number | null }>
  deltas: {
    assetBibleCount: number
    assetBibleReviewCount: number
    contentQualityReviewCount: number
    storyboardQualityReviewCount: number
    promptSnapshotCount: number
    visualQualityReviewCount: number
    visualAutoRepairCount: number
    acceptedRepairCount: number
  }
  scoreAverages: {
    assetBibleReview: { left: number | null; right: number | null; delta: number | null }
    contentQualityReview: { left: number | null; right: number | null; delta: number | null }
    storyboardQualityReview: { left: number | null; right: number | null; delta: number | null }
    visualQualityReview: { left: number | null; right: number | null; delta: number | null }
    repairImprovement: { left: number | null; right: number | null; delta: number | null }
  }
  promptHashChanges: {
    changedTargets: Array<{ targetId: string; leftHash: string; rightHash: string }>
    addedTargets: string[]
    removedTargets: string[]
  }
  assetBibleChanges: {
    addedAssetIds: string[]
    removedAssetIds: string[]
    renamedAssets: Array<{ assetId: string; leftName: string; rightName: string }>
  }
  findings: string[]
}

const QUALITY_FILES = {
  assetBible: 'quality/asset-bible.jsonl',
  assetBibleReviews: 'quality/asset-bible-reviews.jsonl',
  contentQualityReviews: 'quality/content-quality-reviews.jsonl',
  storyboardQualityReviews: 'quality/storyboard-quality-reviews.jsonl',
  promptSnapshots: 'quality/prompt-snapshots.jsonl',
  visualQualityReviews: 'quality/visual-quality-reviews.jsonl',
  visualAutoRepairs: 'quality/visual-auto-repairs.jsonl',
  visualRepairLineage: 'quality/visual-repair-lineage.jsonl',
} as const

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

async function readText(zip: JSZip, filePath: string): Promise<string | null> {
  const file = zip.file(filePath)
  return file ? await file.async('string') : null
}

async function readJson(zip: JSZip, filePath: string): Promise<JsonRecord | null> {
  const text = await readText(zip, filePath)
  if (!text?.trim()) return null
  return asRecord(JSON.parse(text))
}

function parseJsonLines(text: string | null): JsonRecord[] {
  if (!text?.trim()) return []
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => asRecord(JSON.parse(line)))
}

async function readJsonLines(zip: JSZip, filePath: string, missingFiles: string[]): Promise<JsonRecord[]> {
  const text = await readText(zip, filePath)
  if (text === null) {
    missingFiles.push(filePath)
    return []
  }
  return parseJsonLines(text)
}

function reviewScore(record: JsonRecord): number | null {
  const payload = asRecord(record.payload)
  const nestedReview = asRecord(payload.review)
  return readNumber(nestedReview.score) ?? readNumber(record.score)
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null)
  if (valid.length === 0) return null
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10
}

function delta(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : Math.round((right - left) * 10) / 10
}

function averagePair(left: number | null, right: number | null) {
  return { left, right, delta: delta(left, right) }
}

function promptTargetId(record: JsonRecord): string {
  const payload = asRecord(record.payload)
  return readString(payload.targetId) || readString(record.refId) || readString(record.id)
}

function promptHash(record: JsonRecord): string {
  const payload = asRecord(record.payload)
  return readString(payload.promptHash) || readString(record.versionHash)
}

function mapPromptHashes(records: JsonRecord[]): Map<string, string> {
  const output = new Map<string, string>()
  for (const record of records) {
    const targetId = promptTargetId(record)
    const hash = promptHash(record)
    if (targetId && hash) output.set(targetId, hash)
  }
  return output
}

function mapAssetNames(records: JsonRecord[]): Map<string, string> {
  const output = new Map<string, string>()
  for (const record of records) {
    const id = readString(record.id) || readString(record.assetId)
    const name = readString(record.canonicalName) || readString(record.name)
    if (id && name) output.set(id, name)
  }
  return output
}

function acceptedRepairCount(records: JsonRecord[]): number {
  return records.filter((record) => record.accepted === true).length
}

function repairImprovementAverage(records: JsonRecord[]): number | null {
  return average(records.map((record) => {
    const before = readNumber(record.scoreBefore)
    const after = readNumber(record.scoreAfter)
    return before === null || after === null ? null : after - before
  }))
}

function manifestCount(summary: DiagnosticQualityArchiveSummary, key: string): number | null {
  const counts = asRecord(summary.manifest?.counts)
  return readNumber(counts[key])
}

function diffManifestCounts(left: DiagnosticQualityArchiveSummary, right: DiagnosticQualityArchiveSummary) {
  const keys = [
    'tasks',
    'runs',
    'mediaReferences',
    'mediaIncluded',
    'mediaOmitted',
    'timelineEvents',
    'modelInvocations',
    'artifacts',
    'assetBibleRecords',
    'contentQualityReviews',
    'storyboardQualityReviews',
    'promptSnapshots',
    'visualQualityReviews',
    'visualAutoRepairs',
  ]
  return Object.fromEntries(keys.map((key) => {
    const leftValue = manifestCount(left, key)
    const rightValue = manifestCount(right, key)
    return [key, { left: leftValue, right: rightValue, delta: delta(leftValue, rightValue) }]
  }))
}

function countDelta(left: unknown[], right: unknown[]): number {
  return right.length - left.length
}

function diffPromptHashes(left: JsonRecord[], right: JsonRecord[]): DiagnosticQualityComparison['promptHashChanges'] {
  const leftMap = mapPromptHashes(left)
  const rightMap = mapPromptHashes(right)
  const changedTargets: Array<{ targetId: string; leftHash: string; rightHash: string }> = []
  const addedTargets: string[] = []
  const removedTargets: string[] = []
  for (const [targetId, rightHash] of rightMap) {
    const leftHash = leftMap.get(targetId)
    if (!leftHash) addedTargets.push(targetId)
    else if (leftHash !== rightHash) changedTargets.push({ targetId, leftHash, rightHash })
  }
  for (const targetId of leftMap.keys()) {
    if (!rightMap.has(targetId)) removedTargets.push(targetId)
  }
  return { changedTargets, addedTargets, removedTargets }
}

function diffAssetBible(left: JsonRecord[], right: JsonRecord[]): DiagnosticQualityComparison['assetBibleChanges'] {
  const leftMap = mapAssetNames(left)
  const rightMap = mapAssetNames(right)
  const addedAssetIds: string[] = []
  const removedAssetIds: string[] = []
  const renamedAssets: Array<{ assetId: string; leftName: string; rightName: string }> = []
  for (const [assetId, rightName] of rightMap) {
    const leftName = leftMap.get(assetId)
    if (!leftName) addedAssetIds.push(assetId)
    else if (leftName !== rightName) renamedAssets.push({ assetId, leftName, rightName })
  }
  for (const assetId of leftMap.keys()) {
    if (!rightMap.has(assetId)) removedAssetIds.push(assetId)
  }
  return { addedAssetIds, removedAssetIds, renamedAssets }
}

function buildFindings(params: {
  scoreAverages: DiagnosticQualityComparison['scoreAverages']
  promptHashChanges: DiagnosticQualityComparison['promptHashChanges']
  assetBibleChanges: DiagnosticQualityComparison['assetBibleChanges']
  missingFiles: string[]
  manifestCountDeltas: DiagnosticQualityComparison['manifestCountDeltas']
}): string[] {
  const findings: string[] = []
  const storyboardDelta = params.scoreAverages.storyboardQualityReview.delta
  const contentDelta = params.scoreAverages.contentQualityReview.delta
  const visualDelta = params.scoreAverages.visualQualityReview.delta
  const repairDelta = params.scoreAverages.repairImprovement.delta
  if (contentDelta !== null) findings.push(`content_quality_review 平均分变化 ${contentDelta}`)
  if (storyboardDelta !== null) findings.push(`storyboard_review 平均分变化 ${storyboardDelta}`)
  if (visualDelta !== null) findings.push(`visual_quality_review 平均分变化 ${visualDelta}`)
  if (repairDelta !== null) findings.push(`auto_repair 平均提分变化 ${repairDelta}`)
  if (params.promptHashChanges.changedTargets.length > 0) {
    findings.push(`${params.promptHashChanges.changedTargets.length} 个目标的 compiled prompt hash 发生变化`)
  }
  if (params.assetBibleChanges.addedAssetIds.length > 0 || params.assetBibleChanges.removedAssetIds.length > 0) {
    findings.push(`AssetBible 资产集合变化：新增 ${params.assetBibleChanges.addedAssetIds.length}，移除 ${params.assetBibleChanges.removedAssetIds.length}`)
  }
  const invocationDelta = params.manifestCountDeltas.modelInvocations?.delta
  if (invocationDelta !== null && invocationDelta !== undefined) findings.push(`modelInvocations 变化 ${invocationDelta}`)
  if (params.missingFiles.length > 0) findings.push(`存在缺失质量文件：${params.missingFiles.join(', ')}`)
  return findings
}

export async function summarizeDiagnosticQualityArchive(buffer: Buffer): Promise<DiagnosticQualityArchiveSummary> {
  const zip = await JSZip.loadAsync(buffer)
  const missingFiles: string[] = []
  return {
    manifest: await readJson(zip, 'manifest.json'),
    qualityIndex: await readJson(zip, 'quality/quality-index.json'),
    missingFiles,
    assetBible: await readJsonLines(zip, QUALITY_FILES.assetBible, missingFiles),
    assetBibleReviews: await readJsonLines(zip, QUALITY_FILES.assetBibleReviews, missingFiles),
    contentQualityReviews: await readJsonLines(zip, QUALITY_FILES.contentQualityReviews, missingFiles),
    storyboardQualityReviews: await readJsonLines(zip, QUALITY_FILES.storyboardQualityReviews, missingFiles),
    promptSnapshots: await readJsonLines(zip, QUALITY_FILES.promptSnapshots, missingFiles),
    visualQualityReviews: await readJsonLines(zip, QUALITY_FILES.visualQualityReviews, missingFiles),
    visualAutoRepairs: await readJsonLines(zip, QUALITY_FILES.visualAutoRepairs, missingFiles),
    visualRepairLineage: await readJsonLines(zip, QUALITY_FILES.visualRepairLineage, missingFiles),
  }
}

export async function compareDiagnosticQualityArchives(params: {
  left: Buffer
  right: Buffer
}): Promise<DiagnosticQualityComparison> {
  const [left, right] = await Promise.all([
    summarizeDiagnosticQualityArchive(params.left),
    summarizeDiagnosticQualityArchive(params.right),
  ])
  const scoreAverages = {
    assetBibleReview: averagePair(
      average(left.assetBibleReviews.map(reviewScore)),
      average(right.assetBibleReviews.map(reviewScore)),
    ),
    contentQualityReview: averagePair(
      average(left.contentQualityReviews.map(reviewScore)),
      average(right.contentQualityReviews.map(reviewScore)),
    ),
    storyboardQualityReview: averagePair(
      average(left.storyboardQualityReviews.map(reviewScore)),
      average(right.storyboardQualityReviews.map(reviewScore)),
    ),
    visualQualityReview: averagePair(
      average(left.visualQualityReviews.map(reviewScore)),
      average(right.visualQualityReviews.map(reviewScore)),
    ),
    repairImprovement: averagePair(
      repairImprovementAverage(left.visualRepairLineage),
      repairImprovementAverage(right.visualRepairLineage),
    ),
  }
  const promptHashChanges = diffPromptHashes(left.promptSnapshots, right.promptSnapshots)
  const assetBibleChanges = diffAssetBible(left.assetBible, right.assetBible)
  const missingFiles = [...new Set([...left.missingFiles, ...right.missingFiles])]
  const manifestCountDeltas = diffManifestCounts(left, right)
  return {
    left,
    right,
    manifestCountDeltas,
    deltas: {
      assetBibleCount: countDelta(left.assetBible, right.assetBible),
      assetBibleReviewCount: countDelta(left.assetBibleReviews, right.assetBibleReviews),
      contentQualityReviewCount: countDelta(left.contentQualityReviews, right.contentQualityReviews),
      storyboardQualityReviewCount: countDelta(left.storyboardQualityReviews, right.storyboardQualityReviews),
      promptSnapshotCount: countDelta(left.promptSnapshots, right.promptSnapshots),
      visualQualityReviewCount: countDelta(left.visualQualityReviews, right.visualQualityReviews),
      visualAutoRepairCount: countDelta(left.visualAutoRepairs, right.visualAutoRepairs),
      acceptedRepairCount: acceptedRepairCount(right.visualRepairLineage) - acceptedRepairCount(left.visualRepairLineage),
    },
    scoreAverages,
    promptHashChanges,
    assetBibleChanges,
    findings: buildFindings({
      scoreAverages,
      promptHashChanges,
      assetBibleChanges,
      missingFiles,
      manifestCountDeltas,
    }),
  }
}

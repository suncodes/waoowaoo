import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  type QualityReviewContract,
  type QualityReviewDimension,
} from '@/lib/creative-quality/contracts'
import type { AssetBibleItem } from './asset-bible'

export type AssetBibleReviewResult = QualityReviewContract & {
  targetType: 'asset'
  reviewKind: 'asset_bible'
  assetCount: number
  mustLockCount: number
  reviewedAt: string
}

type IssueSeverity = 'warning' | 'critical'

interface ReviewIssue {
  dimension: string
  severity: IssueSeverity
  assetId: string | null
  message: string
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function hasEvidence(item: AssetBibleItem): boolean {
  return item.evidence.some((entry) => (
    entry.sourceId.trim().length > 0
    && entry.text.trim().length > 0
    && entry.confidence >= 0.5
  ))
}

function issue(dimension: string, severity: IssueSeverity, assetId: string | null, message: string): ReviewIssue {
  return { dimension, severity, assetId, message }
}

function scoreDimension(name: string, issues: ReviewIssue[], penalty: number): QualityReviewDimension {
  const score = Math.max(0, 100 - issues.length * penalty)
  return {
    name,
    score,
    issues: issues.map((item) => item.assetId ? `${item.assetId}: ${item.message}` : item.message),
  }
}

function statusFrom(score: number, issues: ReviewIssue[]): AssetBibleReviewResult['status'] {
  if (issues.some((item) => item.severity === 'critical')) return 'human_required'
  if (issues.length > 0) return 'repairable'
  if (score >= 80) return 'passed'
  if (score >= 65) return 'repairable'
  return 'human_required'
}

export function reviewAssetBible(params: {
  targetId: string
  assetBible: AssetBibleItem[]
  expectedAssetIds?: string[]
  requireUsagePlan?: boolean
  reviewedAt?: string
}): AssetBibleReviewResult {
  const expectedAssetIds = uniqueStrings(params.expectedAssetIds || [])
  const actualAssetIds = new Set(params.assetBible.map((item) => item.id))
  const coverageIssues = expectedAssetIds
    .filter((assetId) => !actualAssetIds.has(assetId))
    .map((assetId) => issue('coverage', 'critical', assetId, '资产需求未进入 AssetBible'))

  const seenNames = new Map<string, string>()
  const dedupeIssues: ReviewIssue[] = []
  for (const item of params.assetBible) {
    const names = uniqueStrings([item.canonicalName, ...item.aliases]).map(normalizeName)
    for (const name of names) {
      if (!name) continue
      const existingId = seenNames.get(name)
      if (existingId && existingId !== item.id) {
        dedupeIssues.push(issue('dedupe', 'critical', item.id, `与 ${existingId} 存在重复名称或别名`))
        break
      }
      seenNames.set(name, item.id)
    }
  }

  const traceabilityIssues = params.assetBible.flatMap((item) => {
    if (item.priority !== 'must_lock') return []
    return hasEvidence(item)
      ? []
      : [issue('traceability', 'critical', item.id, 'must_lock 资产缺少可追溯证据')]
  })

  const visualClarityIssues = params.assetBible.flatMap((item) => {
    if (item.generationNeed === 'no_generation') return []
    const invariants = uniqueStrings(item.visualInvariants)
    if (invariants.length === 0) {
      return [issue('visual_clarity', 'critical', item.id, '需生成资产缺少视觉不变量')]
    }
    const hasSpecificInvariant = invariants.some((value) => value.length >= 8)
    return hasSpecificInvariant
      ? []
      : [issue('visual_clarity', 'warning', item.id, '视觉不变量过短，可能无法稳定锁定形象')]
  })

  const stabilityIssues = params.assetBible.flatMap((item) => {
    const issues: ReviewIssue[] = []
    if (item.priority === 'must_lock' && item.generationNeed === 'no_generation') {
      issues.push(issue('stability', 'critical', item.id, 'must_lock 资产不能标记为 no_generation'))
    }
    if (item.generationNeed !== 'no_generation' && item.forbiddenVariants.length === 0) {
      issues.push(issue('stability', 'warning', item.id, '缺少禁用变体，风格可能覆盖资产身份'))
    }
    if (!item.narrativeFunction.trim()) {
      issues.push(issue('stability', 'warning', item.id, '缺少剧情功能说明'))
    }
    return issues
  })

  const usageIssues = params.requireUsagePlan
    ? params.assetBible.flatMap((item) => (
      item.priority === 'must_lock' && item.usedByPanels.length === 0
        ? [issue('usage_plan', 'warning', item.id, 'must_lock 资产缺少镜头使用计划')]
        : []
    ))
    : []

  const dimensions = [
    scoreDimension('coverage', coverageIssues, 30),
    scoreDimension('dedupe', dedupeIssues, 35),
    scoreDimension('traceability', traceabilityIssues, 30),
    scoreDimension('visual_clarity', visualClarityIssues, 20),
    scoreDimension('stability', stabilityIssues, 15),
    scoreDimension('usage_plan', usageIssues, 12),
  ]
  const score = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const issues = [
    ...coverageIssues,
    ...dedupeIssues,
    ...traceabilityIssues,
    ...visualClarityIssues,
    ...stabilityIssues,
    ...usageIssues,
  ]
  const criticalIssues = issues
    .filter((item) => item.severity === 'critical')
    .map((item) => item.assetId ? `${item.assetId}: ${item.message}` : item.message)
  const status = statusFrom(score, issues)

  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    targetId: params.targetId,
    targetType: 'asset',
    reviewKind: 'asset_bible',
    specVersion: 'asset-bible-review.v1',
    score,
    confidence: params.assetBible.length > 0 ? 0.88 : 0.72,
    status,
    dimensions,
    criticalIssues,
    route: status === 'passed' ? 'NONE' : 'ASSET_REPAIR',
    evidence: issues.map((item) => item.assetId ? `${item.assetId}: ${item.message}` : item.message),
    assetCount: params.assetBible.length,
    mustLockCount: params.assetBible.filter((item) => item.priority === 'must_lock').length,
    reviewedAt: params.reviewedAt || new Date().toISOString(),
  }
}

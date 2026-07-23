import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  type QualityReviewContract,
  type QualityReviewDimension,
} from '@/lib/creative-quality/contracts'
import type { VideoProfile } from '@/lib/video-profile'
import type {
  ContentPlan,
  ContentPlanResult,
  ContentReview,
  ContentReviewIssue,
  ContentRiskFlag,
  GuideContentPlan,
  NarrativeContentPlan,
  SourceLedgerEntry,
} from './types'

export type ContentQualityReviewResult = QualityReviewContract & {
  targetType: 'content'
  reviewKind: 'content_plan'
  planType: ContentPlan['planType']
  unitCount: number
  reviewedAt: string
}

type IssueSeverity = 'warning' | 'critical'

interface ReviewIssue {
  dimension: string
  severity: IssueSeverity
  unitId: string | null
  message: string
}

function issue(dimension: string, severity: IssueSeverity, unitId: string | null, message: string): ReviewIssue {
  return { dimension, severity, unitId, message }
}

function issueText(item: ReviewIssue): string {
  return item.unitId ? `${item.unitId}: ${item.message}` : item.message
}

function scoreDimension(name: string, issues: ReviewIssue[], penalty: number): QualityReviewDimension {
  return {
    name,
    score: Math.max(0, 100 - issues.length * penalty),
    issues: issues.map(issueText),
  }
}

function statusFrom(score: number, issues: ReviewIssue[]): ContentQualityReviewResult['status'] {
  if (issues.some((item) => item.severity === 'critical')) return 'human_required'
  if (score >= 80) return 'passed'
  if (score >= 65) return 'repairable'
  return 'human_required'
}

function text(value: string | undefined): string {
  return (value || '').trim()
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function unitCount(plan: ContentPlan): number {
  return plan.planType === 'guide' ? plan.segments.length : plan.beats.length
}

function totalEstimatedDuration(plan: ContentPlan): number {
  return plan.planType === 'guide'
    ? plan.segments.reduce((sum, segment) => sum + segment.estimatedDurationSec, 0)
    : plan.beats.reduce((sum, beat) => sum + beat.estimatedDurationSec, 0)
}

function riskIssues(riskFlags: ContentRiskFlag[], unitId: string | null): ReviewIssue[] {
  return riskFlags.flatMap((risk): ReviewIssue[] => {
    const severity: IssueSeverity = risk.severity === 'critical' ? 'critical' : 'warning'
    if (risk.code === 'source_gap') return [issue('source', severity, unitId, risk.message)]
    if (risk.code === 'overclaim' || risk.code === 'fact_claim') return [issue('source', severity, unitId, risk.message)]
    if (risk.code === 'visualization_gap') return [issue('visualization', severity, unitId, risk.message)]
    if (risk.code === 'duration_risk') return [issue('pacing', severity, unitId, risk.message)]
    if (risk.code === 'structure_drift') return [issue('structure', severity, unitId, risk.message)]
    return []
  })
}

function reviewSourceLedger(entries: SourceLedgerEntry[], requireAnchors: boolean): ReviewIssue[] {
  if (entries.length === 0) {
    return requireAnchors
      ? [issue('source', 'critical', null, '缺少来源账本')]
      : [issue('source', 'warning', null, '缺少来源账本')]
  }
  return entries.flatMap((entry) => {
    const issues: ReviewIssue[] = []
    if (!text(entry.usage)) issues.push(issue('source', 'warning', entry.id, '来源账本缺少使用说明'))
    if (entry.sourceType === 'model_knowledge' && entry.confidence > 0.7) {
      issues.push(issue('source', 'warning', entry.id, '模型常识来源置信度不应高于 0.7'))
    }
    if (entry.sourceType !== 'model_knowledge' && entry.confidence < 0.6) {
      issues.push(issue('source', 'critical', entry.id, '用户或校验来源置信度过低'))
    }
    issues.push(...riskIssues(entry.riskFlags, entry.id))
    return issues
  })
}

function reviewGuideStructure(plan: GuideContentPlan): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  if (!text(plan.thesis)) issues.push(issue('structure', 'critical', null, '缺少中心判断 thesis'))
  if (!text(plan.recommendationAngle)) issues.push(issue('structure', 'warning', null, '缺少推荐角度'))
  if (plan.outline.length === 0 || plan.segments.length === 0) {
    issues.push(issue('structure', 'critical', null, '导读大纲或段落为空'))
  }
  if (plan.segments.length > 0 && plan.segments[0].estimatedDurationSec > 18) {
    issues.push(issue('hook', 'warning', plan.segments[0].id, '首段时长过长，前 5-12 秒承诺可能不够集中'))
  }
  return issues
}

function reviewNarrativeStructure(plan: NarrativeContentPlan): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  if (!text(plan.logline)) issues.push(issue('structure', 'critical', null, '缺少 logline'))
  if (plan.beats.length === 0) issues.push(issue('structure', 'critical', null, '剧情节拍为空'))
  if (plan.beats.length > 0 && plan.beats[0].estimatedDurationSec > 18) {
    issues.push(issue('hook', 'warning', plan.beats[0].id, '首个节拍时长过长，开场钩子可能不够集中'))
  }
  return issues
}

function reviewVisualization(plan: ContentPlan): ReviewIssue[] {
  if (plan.planType === 'guide') {
    return plan.segments.flatMap((segment) => {
      const issues: ReviewIssue[] = []
      if (text(segment.visualPurpose).length < 6) {
        issues.push(issue('visualization', 'warning', segment.id, 'visualPurpose 过短，画面职责不清'))
      }
      if (segment.visualHints.length === 0) {
        issues.push(issue('visualization', 'warning', segment.id, '缺少 visualHints'))
      }
      issues.push(...riskIssues(segment.riskFlags, segment.id))
      return issues
    })
  }
  return plan.beats.flatMap((beat) => [
    ...(text(beat.summary).length < 10 ? [issue('visualization', 'warning', beat.id, 'summary 过短，难以转成画面')] : []),
    ...riskIssues(beat.riskFlags, beat.id),
  ])
}

function reviewPacing(result: ContentPlanResult, profile: VideoProfile): ReviewIssue[] {
  const plannedDuration = totalEstimatedDuration(result.contentPlan)
  const target = result.creativeBrief.targetDurationSec || profile.targetDurationSec
  if (target <= 0 || plannedDuration <= 0) return []
  const ratio = plannedDuration / target
  if (ratio > 1.35) return [issue('pacing', 'critical', null, `计划时长 ${plannedDuration}s 明显超过目标 ${target}s`)]
  if (ratio > 1.15) return [issue('pacing', 'warning', null, `计划时长 ${plannedDuration}s 高于目标 ${target}s`)]
  if (ratio < 0.4) return [issue('pacing', 'warning', null, `计划时长 ${plannedDuration}s 明显低于目标 ${target}s，内容可能过薄`)]
  return []
}

function reviewRepetition(plan: ContentPlan): ReviewIssue[] {
  const units = plan.planType === 'guide'
    ? plan.segments.map((segment) => ({ id: segment.id, title: segment.title, body: segment.narration, visual: segment.visualPurpose }))
    : plan.beats.map((beat) => ({ id: beat.id, title: beat.title, body: beat.summary, visual: beat.purpose }))
  const issues: ReviewIssue[] = []
  const seenTitles = new Map<string, string>()
  const seenBodies = new Map<string, string>()
  for (const unit of units) {
    const titleKey = normalized(unit.title)
    const bodyKey = normalized(unit.body).slice(0, 80)
    const existingTitle = seenTitles.get(titleKey)
    const existingBody = seenBodies.get(bodyKey)
    if (titleKey && existingTitle) issues.push(issue('stability', 'warning', unit.id, `标题与 ${existingTitle} 重复`))
    if (bodyKey.length >= 20 && existingBody) issues.push(issue('stability', 'warning', unit.id, `内容与 ${existingBody} 高度重复`))
    seenTitles.set(titleKey, unit.id)
    seenBodies.set(bodyKey, unit.id)
  }
  return issues
}

function contentReviewIssueCode(dimension: string): ContentReviewIssue['code'] {
  if (dimension === 'hook') return 'HOOK_WEAK'
  if (dimension === 'source') return 'SOURCE_UNSUPPORTED'
  if (dimension === 'visualization') return 'LOW_VISUALIZATION'
  if (dimension === 'pacing') return 'DURATION_OVERFLOW'
  if (dimension === 'stability') return 'STABILITY_DRIFT'
  return 'STRUCTURE_WEAK'
}

function buildMergedIssues(review: ContentReview, qualityReview: ContentQualityReviewResult): ContentReviewIssue[] {
  if (qualityReview.status === 'passed') return review.issues
  const existing = new Set(review.issues.map((item) => `${item.code}:${item.segmentId || ''}:${item.message}`))
  const additions = qualityReview.dimensions.flatMap((dimension): ContentReviewIssue[] => (
    dimension.issues.slice(0, 3).flatMap((message): ContentReviewIssue[] => {
      const issueItem: ContentReviewIssue = {
        code: contentReviewIssueCode(dimension.name),
        severity: qualityReview.status === 'human_required' || qualityReview.status === 'failed' ? 'blocking' : 'warning',
        message,
      }
      const key = `${issueItem.code}:${issueItem.segmentId || ''}:${issueItem.message}`
      if (existing.has(key)) return []
      existing.add(key)
      return [issueItem]
    })
  )).slice(0, 8)
  return [...review.issues, ...additions]
}

export function mergeContentReviewWithQualityGate(
  review: ContentReview,
  qualityReview: ContentQualityReviewResult,
): ContentReview {
  const issues = buildMergedIssues(review, qualityReview)
  const gateBlocks = qualityReview.status === 'human_required' || qualityReview.status === 'failed'
  const status: ContentReview['status'] = review.status === 'blocked' || gateBlocks
    ? 'blocked'
    : review.status === 'warning' || qualityReview.status === 'repairable'
      ? 'warning'
      : 'approved'
  const revisionInstructions = qualityReview.status === 'passed'
    ? review.revisionInstructions
    : [
        ...review.revisionInstructions,
        ...qualityReview.evidence.slice(0, 5).map((item) => `修正文稿质量问题：${item}`),
      ]
  return {
    ...review,
    status,
    score: Math.min(review.score, qualityReview.score),
    issues,
    revisionInstructions: Array.from(new Set(revisionInstructions)),
  }
}

export function reviewContentPlanQuality(params: {
  targetId: string
  result: ContentPlanResult
  profile: VideoProfile
  reviewedAt?: string
}): ContentQualityReviewResult {
  const plan = params.result.contentPlan
  const structureIssues = plan.planType === 'guide'
    ? reviewGuideStructure(plan)
    : reviewNarrativeStructure(plan)
  const sourceIssues = reviewSourceLedger(plan.sourceLedger, params.profile.sourcePolicy.requireAnchors)
  const hookIssues = structureIssues.filter((item) => item.dimension === 'hook')
  const pureStructureIssues = structureIssues.filter((item) => item.dimension !== 'hook')
  const visualizationIssues = reviewVisualization(plan)
  const pacingIssues = reviewPacing(params.result, params.profile)
  const stabilityIssues = [
    ...reviewRepetition(plan),
    ...riskIssues(plan.riskFlags, null).filter((item) => item.dimension === 'structure'),
  ]
  const dimensions = [
    scoreDimension('structure', pureStructureIssues, 25),
    scoreDimension('hook', hookIssues, 12),
    scoreDimension('source', sourceIssues, 18),
    scoreDimension('visualization', visualizationIssues, 10),
    scoreDimension('pacing', pacingIssues, 16),
    scoreDimension('stability', stabilityIssues, 12),
  ]
  const issues = [
    ...pureStructureIssues,
    ...hookIssues,
    ...sourceIssues,
    ...visualizationIssues,
    ...pacingIssues,
    ...stabilityIssues,
  ]
  const score = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const criticalIssues = issues.filter((item) => item.severity === 'critical').map(issueText)
  const status = statusFrom(score, issues)
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    targetId: params.targetId,
    targetType: 'content',
    reviewKind: 'content_plan',
    specVersion: 'content-plan-quality.v1',
    score,
    confidence: unitCount(plan) > 0 ? 0.84 : 0.68,
    status,
    dimensions,
    criticalIssues,
    route: status === 'passed' ? 'NONE' : 'CONTENT_REVISE',
    evidence: issues.map(issueText),
    planType: plan.planType,
    unitCount: unitCount(plan),
    reviewedAt: params.reviewedAt || new Date().toISOString(),
  }
}

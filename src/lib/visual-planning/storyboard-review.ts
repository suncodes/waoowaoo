import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  type QualityReviewContract,
  type QualityReviewDimension,
} from '@/lib/creative-quality/contracts'
import type { VideoProfile } from '@/lib/video-profile'
import type { VisualPlanResult, VisualUnit } from './types'

export type StoryboardReviewResult = QualityReviewContract & {
  targetType: 'storyboard'
  reviewKind: 'storyboard_plan'
  visualUnitCount: number
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

function statusFrom(score: number, issues: ReviewIssue[]): StoryboardReviewResult['status'] {
  if (issues.some((item) => item.severity === 'critical')) return 'repairable'
  if (score >= 80) return 'passed'
  if (score >= 65) return 'repairable'
  return 'human_required'
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

function sameShotKey(unit: VisualUnit): string {
  return [
    normalized(unit.shotType),
    normalized(unit.visualType),
    normalized(unit.shotSpec.primarySubject),
    normalized(unit.shotSpec.shotFunction),
  ].join('|')
}

function countConsecutiveDuplicates(units: VisualUnit[]): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  for (let index = 1; index < units.length; index += 1) {
    const current = units[index]
    const previous = units[index - 1]
    if (sameShotKey(current) === sameShotKey(previous)) {
      issues.push(issue('diversity', 'warning', current.id, '连续镜头的功能、主体和景别过于接近'))
    }
  }
  return issues
}

function reviewShotFunction(units: VisualUnit[]): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  if (units.length > 0 && units[0].shotSpec.shotFunction !== 'hook') {
    issues.push(issue('shot_function', 'warning', units[0].id, '首镜未承担 hook 功能'))
  }
  for (const unit of units) {
    if (!hasText(unit.shotSpec.narrativeIntent)) {
      issues.push(issue('shot_function', 'critical', unit.id, '缺少镜头叙事目的'))
    }
    if (!hasText(unit.shotSpec.primarySubject)) {
      issues.push(issue('shot_function', 'critical', unit.id, '缺少唯一主视觉主体'))
    }
    if (unit.shotSpec.actionBeats.length > 2 && unit.renderMode === 'generated_image') {
      issues.push(issue('shot_function', 'warning', unit.id, '单张图承载的动作节拍过多'))
    }
  }
  return issues
}

function reviewContinuity(units: VisualUnit[]): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  for (const unit of units) {
    const continuity = unit.shotSpec.continuity
    if (!hasText(continuity.fromPrevious) || !hasText(continuity.toNext)) {
      issues.push(issue('continuity', 'warning', unit.id, '缺少前后镜头衔接说明'))
    }
    if (!hasText(continuity.screenDirection)) {
      issues.push(issue('continuity', 'warning', unit.id, '缺少视线或运动方向约束'))
    }
    if (!hasText(continuity.lightingContinuity)) {
      issues.push(issue('continuity', 'warning', unit.id, '缺少光色连续性约束'))
    }
  }
  return issues
}

function reviewFeasibility(units: VisualUnit[]): ReviewIssue[] {
  return units.flatMap((unit) => {
    const feasibility = unit.shotSpec.singleImageFeasibility
    if (feasibility.status === 'feasible') return []
    const severity: IssueSeverity = unit.renderMode === 'generated_image' ? 'critical' : 'warning'
    return [issue('single_image_feasibility', severity, unit.id, `单图可执行性为 ${feasibility.status}: ${feasibility.reason}`)]
  })
}

function reviewAssetBinding(units: VisualUnit[]): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  for (const unit of units) {
    const assetRefIds = new Set((unit.assetRefs || []).map((asset) => asset.id))
    for (const asset of unit.shotSpec.visibleAssets) {
      if (!assetRefIds.has(asset.id)) {
        issues.push(issue('asset_binding', 'critical', unit.id, `visibleAssets 中的 ${asset.name} 未同步到 assetRefs`))
      }
    }
  }
  return issues
}

function reviewPacing(result: VisualPlanResult, profile: VideoProfile): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  const unitCount = result.visualUnits.length
  if (result.shotPlan.shotBudget.totalShots !== unitCount) {
    issues.push(issue('pacing', 'warning', null, `ShotBudget.totalShots=${result.shotPlan.shotBudget.totalShots} 与 visualUnits=${unitCount} 不一致`))
  }
  const totalDuration = result.visualUnits.reduce((sum, unit) => sum + unit.durationSec, 0)
  const ratio = profile.targetDurationSec > 0 ? totalDuration / profile.targetDurationSec : 1
  if (ratio < 0.65 || ratio > 1.35) {
    issues.push(issue('pacing', 'warning', null, `镜头总时长 ${Math.round(totalDuration)}s 偏离目标 ${profile.targetDurationSec}s`))
  }
  return issues
}

export function reviewVisualPlanStoryboard(params: {
  targetId: string
  result: VisualPlanResult
  profile: VideoProfile
  reviewedAt?: string
}): StoryboardReviewResult {
  const shotFunctionIssues = reviewShotFunction(params.result.visualUnits)
  const continuityIssues = reviewContinuity(params.result.visualUnits)
  const diversityIssues = countConsecutiveDuplicates(params.result.visualUnits)
  const feasibilityIssues = reviewFeasibility(params.result.visualUnits)
  const assetBindingIssues = reviewAssetBinding(params.result.visualUnits)
  const pacingIssues = reviewPacing(params.result, params.profile)
  const dimensions = [
    scoreDimension('shot_function', shotFunctionIssues, 18),
    scoreDimension('continuity', continuityIssues, 8),
    scoreDimension('diversity', diversityIssues, 12),
    scoreDimension('single_image_feasibility', feasibilityIssues, 25),
    scoreDimension('asset_binding', assetBindingIssues, 30),
    scoreDimension('pacing', pacingIssues, 10),
  ]
  const score = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const issues = [
    ...shotFunctionIssues,
    ...continuityIssues,
    ...diversityIssues,
    ...feasibilityIssues,
    ...assetBindingIssues,
    ...pacingIssues,
  ]
  const criticalIssues = issues
    .filter((item) => item.severity === 'critical')
    .map(issueText)
  const status = statusFrom(score, issues)

  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    targetId: params.targetId,
    targetType: 'storyboard',
    reviewKind: 'storyboard_plan',
    specVersion: 'storyboard-review.v1',
    score,
    confidence: params.result.visualUnits.length > 0 ? 0.86 : 0.7,
    status,
    dimensions,
    criticalIssues,
    route: status === 'passed' ? 'NONE' : 'SHOT_REPLAN',
    evidence: issues.map(issueText),
    visualUnitCount: params.result.visualUnits.length,
    reviewedAt: params.reviewedAt || new Date().toISOString(),
  }
}

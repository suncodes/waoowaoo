import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  type QualityReviewContract,
  type QualityReviewDimension,
} from '@/lib/creative-quality/contracts'
import { parseVisualQualityState } from '@/lib/quality-workflow'

export type RoughCutPickupRoute = QualityReviewContract['route']

export interface RoughCutPanelInput {
  id: string
  storyboardId?: string | null
  panelIndex: number
  panelNumber?: number | null
  description?: string | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  lipSyncVideoUrl?: string | null
  duration?: number | null
  candidateImages?: string | null
  visualQualityState?: unknown
}

export interface RoughCutStoryboardInput {
  id: string
  panels?: RoughCutPanelInput[]
}

export interface RoughCutVoiceLineInput {
  id: string
  lineIndex: number
  content: string
  audioUrl?: string | null
  audioMediaId?: string | null
  audioDuration?: number | null
  matchedPanelId?: string | null
  matchedPanelIndex?: number | null
}

export interface RoughCutPromptSnapshotInput {
  artifactType?: string | null
  refId?: string | null
  payload?: unknown
}

export interface RoughCutPickupItem {
  id: string
  severity: 'warning' | 'blocking'
  category:
    | 'assembly'
    | 'visual_quality'
    | 'prompt_trace'
    | 'voice_alignment'
    | 'timing'
  targetType: 'episode' | 'panel' | 'voice_line'
  targetId: string
  panelId?: string
  route: RoughCutPickupRoute
  reason: string
  evidence: string[]
  suggestedAction: string
}

export type RoughCutReviewResult = QualityReviewContract & {
  targetType: 'video'
  reviewKind: 'rough_cut'
  panelCount: number
  voiceLineCount: number
  pickupItems: RoughCutPickupItem[]
  reviewedAt: string
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function panelLabel(panel: RoughCutPanelInput): string {
  return `panel-${panel.panelNumber ?? panel.panelIndex + 1}`
}

function flattenPanels(storyboards: RoughCutStoryboardInput[]): RoughCutPanelInput[] {
  return storyboards
    .flatMap((storyboard) => storyboard.panels || [])
    .sort((a, b) => {
      const numberA = typeof a.panelNumber === 'number' ? a.panelNumber : Number.POSITIVE_INFINITY
      const numberB = typeof b.panelNumber === 'number' ? b.panelNumber : Number.POSITIVE_INFINITY
      if (numberA !== numberB) return numberA - numberB
      return a.panelIndex - b.panelIndex
    })
}

function promptSnapshotTarget(snapshot: RoughCutPromptSnapshotInput): string {
  const payload = snapshot.payload && typeof snapshot.payload === 'object' && !Array.isArray(snapshot.payload)
    ? snapshot.payload as Record<string, unknown>
    : {}
  if (typeof payload.targetId === 'string' && payload.targetId.trim()) return payload.targetId.trim()
  return snapshot.refId?.trim() || ''
}

function buildPromptSnapshotCoverage(snapshots: RoughCutPromptSnapshotInput[]) {
  const image = new Set<string>()
  const video = new Set<string>()
  for (const snapshot of snapshots) {
    const targetId = promptSnapshotTarget(snapshot)
    if (!targetId) continue
    if (snapshot.artifactType === 'prompt.panel_image.snapshot') image.add(targetId)
    if (snapshot.artifactType === 'prompt.panel_video.snapshot') video.add(targetId)
  }
  return { image, video }
}

function addPickup(
  items: RoughCutPickupItem[],
  item: Omit<RoughCutPickupItem, 'id'>,
) {
  const id = `pickup-${items.length + 1}`
  items.push({ id, ...item })
}

function reviewAssembly(episodeId: string, panels: RoughCutPanelInput[], pickups: RoughCutPickupItem[]) {
  if (panels.length === 0) {
    addPickup(pickups, {
      severity: 'blocking',
      category: 'assembly',
      targetType: 'episode',
      targetId: episodeId,
      route: 'SHOT_REPLAN',
      reason: '成片没有可用分镜',
      evidence: ['panelCount=0'],
      suggestedAction: '重新生成或恢复分镜规划。',
    })
    return
  }

  for (const panel of panels) {
    if (!hasText(panel.description) && !hasText(panel.imagePrompt)) {
      addPickup(pickups, {
        severity: 'blocking',
        category: 'assembly',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'SHOT_REPLAN',
        reason: '分镜缺少画面说明和图片意图',
        evidence: [panelLabel(panel)],
        suggestedAction: '补齐镜头目的、主体、动作和场景后再生成。',
      })
    }
    if (!hasText(panel.imageUrl)) {
      addPickup(pickups, {
        severity: 'blocking',
        category: 'assembly',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'REGENERATE',
        reason: '分镜缺少最终图片',
        evidence: [panelLabel(panel)],
        suggestedAction: '先生成或确认该分镜图片。',
      })
    }
    if (!hasText(panel.videoUrl) && !hasText(panel.lipSyncVideoUrl)) {
      addPickup(pickups, {
        severity: 'warning',
        category: 'assembly',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'VIDEO_REGENERATE',
        reason: '分镜缺少视频片段',
        evidence: [panelLabel(panel)],
        suggestedAction: '图片通过后生成该镜头视频。',
      })
    }
  }
}

function reviewVisualQuality(panels: RoughCutPanelInput[], pickups: RoughCutPickupItem[]) {
  for (const panel of panels) {
    const qualityState = parseVisualQualityState(panel.visualQualityState)
    if (!qualityState) {
      addPickup(pickups, {
        severity: 'warning',
        category: 'visual_quality',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'HUMAN_REQUIRED',
        reason: '缺少视觉质量状态',
        evidence: [panelLabel(panel)],
        suggestedAction: '运行视觉质量评审或人工确认该图可用。',
      })
      continue
    }
    if (qualityState.status === 'failed' || qualityState.status === 'human_required') {
      addPickup(pickups, {
        severity: 'blocking',
        category: 'visual_quality',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: qualityState.status === 'failed' ? 'REGENERATE' : 'HUMAN_REQUIRED',
        reason: '视觉质量未通过',
        evidence: [`${panelLabel(panel)} status=${qualityState.status}`],
        suggestedAction: '根据质量评审问题重生成、修复或人工选择候选图。',
      })
    }
    if (qualityState.status === 'approved_with_warnings') {
      addPickup(pickups, {
        severity: 'warning',
        category: 'visual_quality',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'HUMAN_REQUIRED',
        reason: '画面由人工确认但仍保留质量风险',
        evidence: [`${panelLabel(panel)} status=${qualityState.status}`],
        suggestedAction: '最终导出前复核该镜头，必要时重新生成或替换候选图。',
      })
    }
    if (qualityState.mode === 'auto' && (
      qualityState.status === 'pending'
      || qualityState.status === 'reviewing'
      || qualityState.status === 'repairing'
    )) {
      addPickup(pickups, {
        severity: 'warning',
        category: 'visual_quality',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'HUMAN_REQUIRED',
        reason: '视觉质量评审仍在处理中',
        evidence: [`${panelLabel(panel)} status=${qualityState.status}`],
        suggestedAction: '等待评审完成后再进入视频/成片确认。',
      })
    }
  }
}

function reviewPromptTrace(
  panels: RoughCutPanelInput[],
  snapshots: RoughCutPromptSnapshotInput[],
  pickups: RoughCutPickupItem[],
) {
  const coverage = buildPromptSnapshotCoverage(snapshots)
  for (const panel of panels) {
    if (hasText(panel.imageUrl) && !coverage.image.has(panel.id)) {
      addPickup(pickups, {
        severity: 'warning',
        category: 'prompt_trace',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'PROMPT_RECOMPILE',
        reason: '图片已有结果但缺少图片 prompt 快照',
        evidence: [panelLabel(panel)],
        suggestedAction: '重新通过 Prompt Compiler 生成图片，或补齐历史快照。',
      })
    }
    if ((hasText(panel.videoUrl) || hasText(panel.lipSyncVideoUrl)) && !coverage.video.has(panel.id)) {
      addPickup(pickups, {
        severity: 'warning',
        category: 'prompt_trace',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'PROMPT_RECOMPILE',
        reason: '视频已有结果但缺少视频 prompt 快照',
        evidence: [panelLabel(panel)],
        suggestedAction: '重新通过视频 Prompt Compiler 生成，保证成片可追溯。',
      })
    }
  }
}

function reviewVoiceAlignment(
  panels: RoughCutPanelInput[],
  voiceLines: RoughCutVoiceLineInput[],
  pickups: RoughCutPickupItem[],
) {
  const panelIds = new Set(panels.map((panel) => panel.id))
  const matchedPanelIds = new Set<string>()
  for (const line of voiceLines) {
    if (!hasText(line.audioUrl) && !line.audioMediaId) {
      addPickup(pickups, {
        severity: 'warning',
        category: 'voice_alignment',
        targetType: 'voice_line',
        targetId: line.id,
        route: 'VOICE_REGENERATE',
        reason: '配音行缺少音频',
        evidence: [`voiceLine=${line.lineIndex}`],
        suggestedAction: '生成或重新生成该配音行。',
      })
    }
    if (line.matchedPanelId && panelIds.has(line.matchedPanelId)) {
      matchedPanelIds.add(line.matchedPanelId)
    } else {
      addPickup(pickups, {
        severity: 'warning',
        category: 'voice_alignment',
        targetType: 'voice_line',
        targetId: line.id,
        route: 'HUMAN_REQUIRED',
        reason: '配音行没有匹配到有效分镜',
        evidence: [`voiceLine=${line.lineIndex}`, `matchedPanelId=${line.matchedPanelId || 'null'}`],
        suggestedAction: '重新匹配配音和分镜，或调整分镜/旁白切分。',
      })
    }
  }

  if (voiceLines.length > 0) {
    for (const panel of panels) {
      if (!matchedPanelIds.has(panel.id)) {
        addPickup(pickups, {
          severity: 'warning',
          category: 'voice_alignment',
          targetType: 'panel',
          targetId: panel.id,
          panelId: panel.id,
          route: 'HUMAN_REQUIRED',
          reason: '分镜没有匹配配音行',
          evidence: [panelLabel(panel)],
          suggestedAction: '检查旁白切分和 panel 匹配关系。',
        })
      }
    }
  }
}

function reviewTiming(
  panels: RoughCutPanelInput[],
  voiceLines: RoughCutVoiceLineInput[],
  pickups: RoughCutPickupItem[],
) {
  const voiceByPanel = new Map<string, RoughCutVoiceLineInput[]>()
  for (const line of voiceLines) {
    if (!line.matchedPanelId) continue
    const list = voiceByPanel.get(line.matchedPanelId) || []
    list.push(line)
    voiceByPanel.set(line.matchedPanelId, list)
  }

  for (const panel of panels) {
    const durationSec = typeof panel.duration === 'number' && Number.isFinite(panel.duration) ? panel.duration : null
    if (durationSec !== null && (durationSec < 1.5 || durationSec > 15)) {
      addPickup(pickups, {
        severity: 'warning',
        category: 'timing',
        targetType: 'panel',
        targetId: panel.id,
        panelId: panel.id,
        route: 'SHOT_REPLAN',
        reason: '分镜时长超出常规短视频镜头范围',
        evidence: [`${panelLabel(panel)} duration=${durationSec}s`],
        suggestedAction: '重新分配镜头时长或拆分/合并镜头。',
      })
    }
    const lines = voiceByPanel.get(panel.id) || []
    const voiceDurationMs = lines.reduce((sum, line) => sum + (typeof line.audioDuration === 'number' ? line.audioDuration : 0), 0)
    if (durationSec && voiceDurationMs > 0) {
      const voiceSec = voiceDurationMs / 1000
      const ratio = voiceSec / durationSec
      if (ratio > 1.35 || ratio < 0.65) {
        addPickup(pickups, {
          severity: 'warning',
          category: 'timing',
          targetType: 'panel',
          targetId: panel.id,
          panelId: panel.id,
          route: ratio > 1.35 ? 'SHOT_REPLAN' : 'VOICE_REGENERATE',
          reason: '配音时长与镜头时长不匹配',
          evidence: [`${panelLabel(panel)} panel=${durationSec}s voice=${voiceSec.toFixed(1)}s`],
          suggestedAction: '调整镜头时长、旁白切分或语速后重新生成。',
        })
      }
    }
  }
}

function dimension(name: RoughCutPickupItem['category'], pickups: RoughCutPickupItem[], penalty: number): QualityReviewDimension {
  const issues = pickups.filter((item) => item.category === name)
  const blockingCount = issues.filter((item) => item.severity === 'blocking').length
  return {
    name,
    score: Math.max(0, 100 - issues.length * penalty - blockingCount * penalty),
    issues: issues.map((item) => `${item.targetId}: ${item.reason}`),
  }
}

function statusFrom(score: number, pickups: RoughCutPickupItem[]): RoughCutReviewResult['status'] {
  if (pickups.some((item) => item.severity === 'blocking')) return 'human_required'
  if (score >= 85) return 'passed'
  if (score >= 65) return 'repairable'
  return 'human_required'
}

function routeFrom(status: RoughCutReviewResult['status'], pickups: RoughCutPickupItem[]): QualityReviewContract['route'] {
  if (status === 'passed') return 'NONE'
  const blocking = pickups.find((item) => item.severity === 'blocking')
  return blocking?.route || pickups[0]?.route || 'HUMAN_REQUIRED'
}

export function reviewRoughCutQuality(params: {
  episodeId: string
  storyboards: RoughCutStoryboardInput[]
  voiceLines: RoughCutVoiceLineInput[]
  promptSnapshots?: RoughCutPromptSnapshotInput[]
  reviewedAt?: string
}): RoughCutReviewResult {
  const panels = flattenPanels(params.storyboards)
  const pickupItems: RoughCutPickupItem[] = []
  reviewAssembly(params.episodeId, panels, pickupItems)
  reviewVisualQuality(panels, pickupItems)
  reviewPromptTrace(panels, params.promptSnapshots || [], pickupItems)
  reviewVoiceAlignment(panels, params.voiceLines, pickupItems)
  reviewTiming(panels, params.voiceLines, pickupItems)

  const dimensions = [
    dimension('assembly', pickupItems, 12),
    dimension('visual_quality', pickupItems, 12),
    dimension('prompt_trace', pickupItems, 8),
    dimension('voice_alignment', pickupItems, 8),
    dimension('timing', pickupItems, 8),
  ]
  const score = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const status = statusFrom(score, pickupItems)
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    targetId: params.episodeId,
    targetType: 'video',
    reviewKind: 'rough_cut',
    specVersion: 'rough-cut-review.v1',
    score,
    confidence: panels.length > 0 ? 0.82 : 0.65,
    status,
    dimensions,
    criticalIssues: pickupItems.filter((item) => item.severity === 'blocking').map((item) => item.reason),
    route: routeFrom(status, pickupItems),
    evidence: pickupItems.flatMap((item) => item.evidence),
    panelCount: panels.length,
    voiceLineCount: params.voiceLines.length,
    pickupItems,
    reviewedAt: params.reviewedAt || new Date().toISOString(),
  }
}

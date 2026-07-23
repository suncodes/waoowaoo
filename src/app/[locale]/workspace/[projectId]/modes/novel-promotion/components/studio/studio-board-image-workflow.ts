import type { NovelPromotionPanel } from '@/types/project'
import {
  parseVisualQualityState,
  type VisualCandidateGroup,
} from '@/lib/quality-workflow'
import type { StudioProductStatus } from './studio-types'

type PanelImageTaskState = NonNullable<NovelPromotionPanel['imageTaskState']>
type ActivePanelImageTaskState = PanelImageTaskState & {
  phase: 'queued' | 'processing'
}

export type PanelImageWorkflowPresentation = {
  status: StudioProductStatus
  label: string
  blocksConfirmation: boolean
  progress: number | null
}

export type PanelCandidateCard = {
  candidateUrl: string
  index: number
  displayName: string
  sourceCandidateUrl: string | null
  action: VisualCandidateGroup['action']
  sourceLabel: string
}

export type PanelCandidateDisplayGroup = {
  key: string
  label: string
  cards: PanelCandidateCard[]
}

const IMAGE_GENERATION_TYPES = new Set([
  'image_panel',
  'panel_variant',
])

const IMAGE_MODIFY_TYPES = new Set([
  'modify_asset_image',
])

function isActiveTask(state: PanelImageTaskState | null | undefined): state is ActivePanelImageTaskState {
  return state?.phase === 'queued' || state?.phase === 'processing'
}

function repairRoundLabel(attempt?: number | null, maxAttempts?: number | null) {
  if (!attempt || attempt <= 0) return ''
  if (maxAttempts && maxAttempts > 0) return `（${attempt}/${maxAttempts}）`
  return `（第 ${attempt} 轮）`
}

function labelFromTaskState(state: PanelImageTaskState) {
  const taskType = state.runningTaskType || ''
  if (taskType === 'visual_quality_review') {
    if (state.phase === 'queued') return state.attempt && state.attempt > 0 ? '等待复查' : '等待检查'
    return state.attempt && state.attempt > 0
      ? `复查中${repairRoundLabel(state.attempt, state.maxAttempts)}`
      : '检查中'
  }
  if (taskType === 'visual_auto_repair') {
    return state.phase === 'queued'
      ? `等待修复${repairRoundLabel(state.attempt, state.maxAttempts)}`
      : `修复中${repairRoundLabel(state.attempt, state.maxAttempts)}`
  }
  if (IMAGE_MODIFY_TYPES.has(taskType)) return '改图中'
  if (IMAGE_GENERATION_TYPES.has(taskType)) return '生成中'
  return state.phase === 'queued' ? '等待处理' : '处理中'
}

function labelFromQualityState(panel: NovelPromotionPanel) {
  const qualityState = parseVisualQualityState(panel.visualQualityState)
  if (!qualityState || qualityState.mode !== 'auto') return null
  if (qualityState.status === 'pending') return '等待检查'
  if (qualityState.status === 'reviewing') {
    return qualityState.attempt > 0
      ? `复查中${repairRoundLabel(qualityState.attempt, qualityState.maxAttempts)}`
      : '检查中'
  }
  if (qualityState.status === 'repairing') {
    const nextAttempt = Math.min(qualityState.maxAttempts, qualityState.attempt + 1)
    return `修复中${repairRoundLabel(nextAttempt, qualityState.maxAttempts)}`
  }
  return null
}

function hasHumanConfirmed(panel: NovelPromotionPanel) {
  return !!parseVisualQualityState(panel.visualQualityState)?.humanConfirmedAt
}

function needsHumanReview(panel: NovelPromotionPanel) {
  const qualityState = parseVisualQualityState(panel.visualQualityState)
  return qualityState?.status === 'human_required'
}

export function resolvePanelImageWorkflowPresentation(params: {
  panel: NovelPromotionPanel
  hasCandidates: boolean
  isSubmitting?: boolean
  isModifying?: boolean
}): PanelImageWorkflowPresentation {
  if (params.isSubmitting) {
    return {
      status: 'generating',
      label: '提交中',
      blocksConfirmation: true,
      progress: null,
    }
  }
  if (params.isModifying) {
    return {
      status: 'generating',
      label: '改图中',
      blocksConfirmation: true,
      progress: null,
    }
  }

  const taskState = params.panel.imageTaskState || null
  if (isActiveTask(taskState)) {
    return {
      status: 'generating',
      label: labelFromTaskState(taskState),
      blocksConfirmation: true,
      progress: taskState.progress ?? null,
    }
  }

  const qualityLabel = labelFromQualityState(params.panel)
  if (qualityLabel) {
    return {
      status: 'generating',
      label: qualityLabel,
      blocksConfirmation: true,
      progress: null,
    }
  }
  if (params.panel.imageTaskRunning) {
    return {
      status: 'generating',
      label: params.panel.imageTaskIntent === 'modify' ? '改图中' : '生成中',
      blocksConfirmation: true,
      progress: null,
    }
  }

  if (params.panel.imageErrorMessage || taskState?.lastError) {
    return {
      status: 'failed',
      label: '失败',
      blocksConfirmation: false,
      progress: null,
    }
  }

  if (needsHumanReview(params.panel)) {
    return {
      status: 'needs_review',
      label: '待确认',
      blocksConfirmation: false,
      progress: null,
    }
  }

  if (params.hasCandidates && !hasHumanConfirmed(params.panel)) {
    return {
      status: 'needs_review',
      label: '待确认',
      blocksConfirmation: false,
      progress: null,
    }
  }

  if (params.panel.imageUrl) {
    return {
      status: 'locked',
      label: '已确认',
      blocksConfirmation: false,
      progress: null,
    }
  }

  if (params.panel.description) {
    return {
      status: 'drafting',
      label: '可编辑',
      blocksConfirmation: false,
      progress: null,
    }
  }

  return {
    status: 'empty',
    label: '未开始',
    blocksConfirmation: false,
    progress: null,
  }
}

function compareCandidateGroups(a: VisualCandidateGroup, b: VisualCandidateGroup) {
  if (a.origin !== b.origin) return a.origin === 'initial' ? -1 : 1
  if (a.origin === 'repair' && b.origin === 'repair' && a.attempt !== b.attempt) {
    return a.attempt - b.attempt
  }
  return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
}

function groupKey(group: VisualCandidateGroup) {
  return group.origin === 'initial' ? 'initial' : `repair:${Math.max(1, group.attempt)}`
}

function groupLabel(group: VisualCandidateGroup) {
  return group.origin === 'initial' ? '原始候选' : `第 ${Math.max(1, group.attempt)} 轮修复`
}

function candidateDisplayName(group: VisualCandidateGroup, indexInGroup: number) {
  if (group.origin === 'initial') return `原始 #${indexInGroup}`
  return `修复${Math.max(1, group.attempt)}-#${indexInGroup}`
}

function fallbackInitialGroup(candidateUrls: string[]): VisualCandidateGroup {
  return {
    id: 'all-candidates',
    label: '原始候选',
    origin: 'initial',
    attempt: 0,
    candidateUrls,
    sourceCandidateUrl: null,
    action: null,
    versionHash: '',
    createdAt: '',
  }
}

export function buildPanelCandidateDisplayGroups(params: {
  candidates: string[]
  groups: VisualCandidateGroup[]
}): PanelCandidateDisplayGroup[] {
  const groups = (params.groups.length > 0 ? params.groups : [fallbackInitialGroup(params.candidates)])
    .slice()
    .sort(compareCandidateGroups)
  const displays = new Map<string, PanelCandidateDisplayGroup>()
  const usedIndexes = new Set<number>()
  const cards: PanelCandidateCard[] = []

  const ensureDisplay = (group: VisualCandidateGroup) => {
    const key = groupKey(group)
    const existing = displays.get(key)
    if (existing) return existing
    const created = {
      key,
      label: groupLabel(group),
      cards: [],
    }
    displays.set(key, created)
    return created
  }

  for (const group of groups) {
    const display = ensureDisplay(group)
    for (const candidateUrl of group.candidateUrls) {
      const index = params.candidates.findIndex((itemUrl, itemIndex) =>
        itemUrl === candidateUrl && !usedIndexes.has(itemIndex),
      )
      if (index < 0) continue
      const card = {
        candidateUrl,
        index,
        displayName: candidateDisplayName(group, display.cards.length + 1),
        sourceCandidateUrl: group.sourceCandidateUrl,
        action: group.action,
        sourceLabel: '',
      }
      display.cards.push(card)
      cards.push(card)
      usedIndexes.add(index)
    }
  }

  const fallbackGroup = fallbackInitialGroup([])
  const fallbackDisplay = ensureDisplay(fallbackGroup)
  for (let index = 0; index < params.candidates.length; index += 1) {
    if (usedIndexes.has(index)) continue
    const card = {
      candidateUrl: params.candidates[index],
      index,
      displayName: candidateDisplayName(fallbackGroup, fallbackDisplay.cards.length + 1),
      sourceCandidateUrl: null,
      action: null,
      sourceLabel: '',
    }
    fallbackDisplay.cards.push(card)
    cards.push(card)
    usedIndexes.add(index)
  }

  const displayNameByUrl = new Map<string, string>()
  for (const card of cards) {
    displayNameByUrl.set(card.candidateUrl, card.displayName)
  }
  for (const card of cards) {
    if (!card.sourceCandidateUrl) {
      card.sourceLabel = card.action === 'regenerate' ? '重新生成 · 无单一来源' : ''
      continue
    }
    const sourceName = displayNameByUrl.get(card.sourceCandidateUrl) || '历史候选'
    card.sourceLabel = card.action === 'regenerate'
      ? `重新生成 · 参考：${sourceName}`
      : `来源：${sourceName}`
  }

  return Array.from(displays.values()).filter((group) => group.cards.length > 0)
}

import type { NovelPromotionPanel } from '@/types/project'
import {
  resolveVisualCandidateUrls,
  type VisualCandidateGroup,
} from '@/lib/quality-workflow'
import {
  resolveVisualWorkflowPresentation,
  type VisualWorkflowPresentation,
} from '@/lib/visual-workflow/status'
import type { StudioProductStatus } from './studio-types'

type PanelImageTaskState = NonNullable<NovelPromotionPanel['imageTaskState']>

export type PanelImageWorkflowPresentation = VisualWorkflowPresentation & {
  status: StudioProductStatus
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

export function resolvePanelImageWorkflowPresentation(params: {
  panel: NovelPromotionPanel
  hasCandidates: boolean
  isSubmitting?: boolean
  isModifying?: boolean
}): PanelImageWorkflowPresentation {
  const candidateUrls = resolveVisualCandidateUrls({
    visualQualityState: params.panel.visualQualityState,
    candidateImages: params.panel.candidateImages,
  })
  const taskState = params.panel.imageTaskState || null
  return resolveVisualWorkflowPresentation({
    isSubmitting: params.isSubmitting,
    isModifying: params.isModifying,
    taskStates: [
      taskState,
      params.panel.imageTaskRunning && !taskState
        ? {
          phase: 'processing',
          runningTaskType: params.panel.imageTaskIntent === 'modify' ? 'modify_asset_image' : 'image_panel',
        } satisfies PanelImageTaskState
        : null,
    ],
    visualQualityState: params.panel.visualQualityState,
    hasCandidates: params.hasCandidates || candidateUrls.length > 0,
    candidateCount: candidateUrls.length,
    hasPrimaryImage: !!params.panel.imageUrl,
    hasDraft: !!(params.panel.description || params.panel.imagePrompt),
    hasError: !!params.panel.imageErrorMessage,
  }) as PanelImageWorkflowPresentation
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

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function readBlockingAssetNames(panel: NovelPromotionPanel): string[] {
  const referencePlan = asRecord(panel.referencePlan)
  const decision = asRecord(referencePlan.decision)
  const decisionNames = readStringArray(decision.blockingAssetNames)
  if (decisionNames.length > 0) return decisionNames
  const backfill = asRecord(referencePlan.backfill)
  const requests = Array.isArray(backfill.requests) ? backfill.requests : []
  return requests.flatMap((item) => {
    const request = asRecord(item)
    const name = request.name
    return typeof name === 'string' && name.trim() ? [name.trim()] : []
  })
}

function buildReferenceBlockedPresentation(panel: NovelPromotionPanel): PanelImageWorkflowPresentation | null {
  if (panel.imageUrl) return null
  const route = panel.generationRoute
  if (route !== 'asset_backfill' && route !== 'human_required') return null
  const names = readBlockingAssetNames(panel)
  const suffix = names.length > 0 ? `：${names.join('、')}` : ''
  if (route === 'asset_backfill') {
    return {
      phase: 'generating',
      status: 'generating',
      label: `等待补齐资产${suffix}`,
      blocksConfirmation: true,
      progress: null,
      activeTaskType: 'image_panel',
    }
  }
  return {
    phase: 'human_required',
    status: 'needs_review',
    label: `缺少稳定参考${suffix}`,
    blocksConfirmation: true,
    progress: null,
    activeTaskType: 'image_panel',
  }
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
  const presentation = resolveVisualWorkflowPresentation({
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
    allowDraftStatus: false,
    hasError: !!params.panel.imageErrorMessage,
    emptyLabel: '未生成',
  }) as PanelImageWorkflowPresentation
  const hasActiveTask = presentation.blocksConfirmation
    || taskState?.phase === 'queued'
    || taskState?.phase === 'processing'
    || params.isSubmitting
    || params.isModifying
  const noImageOutput = !params.panel.imageUrl && !params.hasCandidates && candidateUrls.length === 0
  if (!hasActiveTask && noImageOutput) {
    return buildReferenceBlockedPresentation(params.panel) || presentation
  }
  return presentation
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

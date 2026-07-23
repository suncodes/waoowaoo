'use client'

import type { NovelPromotionPanel } from '@/types/project'
import { extractErrorMessage } from '@/lib/errors/extract'
import {
  flattenVisualCandidateGroups,
  parseVisualQualityState,
  resolveVisualCandidateGroups,
  type VisualCandidateGroup,
} from '@/lib/quality-workflow'

export interface PanelCandidateData {
  candidates: string[]
  selectedIndex: number
  groups: VisualCandidateGroup[]
}

interface CandidateStateLike {
  candidates: string[]
  selectedIndex: number
  originalUrl?: string | null
  previousUrl?: string | null
}

interface PanelCandidateSystemLike {
  getCandidateState: (id: string) => CandidateStateLike | null | undefined
  clearCandidates: (id: string) => void
  initCandidates: (
    id: string,
    originalUrl: string | null,
    candidates: string[],
    previousUrl: string | null,
    selectedIndex?: number,
  ) => void
}

function sameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function parseCandidateImages(candidateImagesStr: string): string[] | null {
  try {
    const candidates = JSON.parse(candidateImagesStr)
    if (!Array.isArray(candidates) || candidates.length === 0) return null
    const normalized = candidates.filter((candidate: string) => typeof candidate === 'string' && !!candidate)
    return normalized.length > 0 ? normalized : null
  } catch {
    return null
  }
}

function resolveCandidateGroups(panel: NovelPromotionPanel): VisualCandidateGroup[] {
  return resolveVisualCandidateGroups({
    visualQualityState: panel.visualQualityState,
    candidateImages: panel.candidateImages,
  })
}

function resolveCandidateImages(panel: NovelPromotionPanel): string[] | null {
  const groupedCandidates = flattenVisualCandidateGroups(resolveCandidateGroups(panel))
  if (groupedCandidates.length > 0) return groupedCandidates

  if (!panel.candidateImages) return null
  const candidates = parseCandidateImages(panel.candidateImages)
  return candidates || null
}

export function resolveConfirmedCandidateIndex(
  panel: Pick<NovelPromotionPanel, 'imageUrl' | 'visualQualityState'>,
  candidates: string[],
): number {
  const directIndex = candidates.findIndex((candidate) => candidate === panel.imageUrl)
  if (directIndex >= 0) return directIndex

  const qualityState = parseVisualQualityState(panel.visualQualityState)
  if (!qualityState?.activeCandidateUrl) return -1
  const stateIndex = qualityState.candidateUrls.findIndex(
    (candidate) => candidate === qualityState.activeCandidateUrl,
  )
  return stateIndex >= 0 && stateIndex < candidates.length ? stateIndex : -1
}

function clearIfExists(system: PanelCandidateSystemLike, panelId: string) {
  const state = system.getCandidateState(panelId)
  if (state) {
    system.clearCandidates(panelId)
  }
}

export function ensurePanelCandidatesInitialized(
  panel: NovelPromotionPanel,
  candidateSystem: PanelCandidateSystemLike,
): boolean {
  const candidates = resolveCandidateImages(panel)
  if (!candidates) {
    clearIfExists(candidateSystem, panel.id)
    return false
  }

  const validCandidates = candidates.filter((candidate) => !candidate.startsWith('PENDING:'))
  if (validCandidates.length === 0) {
    clearIfExists(candidateSystem, panel.id)
    return true
  }

  const existingState = candidateSystem.getCandidateState(panel.id)
  const shouldRebuildState =
    !existingState ||
    !sameStringArray(existingState.candidates, validCandidates) ||
    (existingState.originalUrl || null) !== (panel.imageUrl || null) ||
    (existingState.previousUrl || null) !== (panel.previousImageUrl || null)

  if (shouldRebuildState) {
    const confirmedIndex = resolveConfirmedCandidateIndex(panel, validCandidates)
    candidateSystem.initCandidates(
      panel.id,
      panel.imageUrl || null,
      validCandidates,
      panel.previousImageUrl || null,
      confirmedIndex >= 0 ? confirmedIndex : 0,
    )
  }
  return true
}

export function getPanelCandidatesFromRuntime(
  panel: NovelPromotionPanel,
  candidateSystem: PanelCandidateSystemLike,
): PanelCandidateData | null {
  const candidates = resolveCandidateImages(panel)
  const groups = resolveCandidateGroups(panel)
  if (!candidates) return null

  const localState = candidateSystem.getCandidateState(panel.id)
  if (localState && localState.candidates.length > 0) {
    return {
      candidates: localState.candidates,
      selectedIndex: localState.selectedIndex,
      groups,
    }
  }

  const validCandidates = candidates.filter((candidate) => !candidate.startsWith('PENDING:'))
  if (validCandidates.length === 0) {
    return {
      candidates,
      selectedIndex: 0,
      groups,
    }
  }

  return {
    candidates: validCandidates,
    selectedIndex: Math.max(0, resolveConfirmedCandidateIndex(panel, validCandidates)),
    groups,
  }
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return extractErrorMessage(error, fallback)
}

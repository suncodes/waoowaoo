import type { GuideContentPlan, GuideSegment } from '@/lib/content-planning'
import { cloneWorkspaceValue } from './artifact-state'

export interface GuidePlanMutation {
  plan: GuideContentPlan
  changedUnitIds: string[]
  focusUnitId: string
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value?.trim()).map((value) => value.trim()))]
}

function splitNarration(text: string, requestedIndex?: number): [string, string] {
  const normalized = text.trim()
  if (!normalized) return ['', '']
  const fallback = Math.max(1, Math.floor(normalized.length / 2))
  const requested = requestedIndex && requestedIndex > 0 && requestedIndex < normalized.length
    ? requestedIndex
    : fallback
  const punctuation = /[。！？.!?；;\n]/
  let splitAt = requested
  for (let offset = 0; offset < normalized.length; offset += 1) {
    const right = requested + offset
    if (right < normalized.length && punctuation.test(normalized[right])) {
      splitAt = right + 1
      break
    }
    const left = requested - offset
    if (left > 0 && punctuation.test(normalized[left])) {
      splitAt = left + 1
      break
    }
  }
  return [normalized.slice(0, splitAt).trim(), normalized.slice(splitAt).trim()]
}

export function addGuideSegment(params: {
  plan: GuideContentPlan
  afterIndex: number
  newId: string
  title: string
  narration: string
  sourceLabel: string
}): GuidePlanMutation {
  const next = cloneWorkspaceValue(params.plan)
  const reference = next.segments[Math.max(0, Math.min(params.afterIndex, next.segments.length - 1))]
  const outlineId = reference?.outlineId || next.outline[0]?.id
  if (!outlineId) throw new Error('GUIDE_OUTLINE_REQUIRED')
  const segment: GuideSegment = {
    id: params.newId,
    outlineId,
    title: params.title,
    narration: params.narration,
    visualPurpose: reference?.visualPurpose || params.title,
    visualHints: [],
    estimatedDurationSec: 15,
    spoilerLevel: reference?.spoilerLevel || 'light',
    sourceAnchor: {
      label: reference?.sourceAnchor.label || params.sourceLabel,
      ...(reference?.sourceAnchor.chapter ? { chapter: reference.sourceAnchor.chapter } : {}),
    },
    riskFlags: [],
  }
  const insertAt = Math.max(0, Math.min(params.afterIndex + 1, next.segments.length))
  next.segments.splice(insertAt, 0, segment)
  return { plan: next, changedUnitIds: [segment.id], focusUnitId: segment.id }
}

export function moveGuideSegment(
  plan: GuideContentPlan,
  index: number,
  direction: -1 | 1,
): GuidePlanMutation | null {
  const targetIndex = index + direction
  if (index < 0 || index >= plan.segments.length || targetIndex < 0 || targetIndex >= plan.segments.length) {
    return null
  }
  const next = cloneWorkspaceValue(plan)
  const current = next.segments[index]
  const target = next.segments[targetIndex]
  next.segments[index] = target
  next.segments[targetIndex] = current
  return {
    plan: next,
    changedUnitIds: [current.id, target.id],
    focusUnitId: current.id,
  }
}

export function splitGuideSegment(params: {
  plan: GuideContentPlan
  index: number
  newId: string
  newTitle: string
  cursor?: number
}): GuidePlanMutation | null {
  const current = params.plan.segments[params.index]
  if (!current) return null
  const [firstNarration, secondNarration] = splitNarration(current.narration, params.cursor)
  if (!firstNarration || !secondNarration) return null
  const next = cloneWorkspaceValue(params.plan)
  const firstDuration = Math.max(3, Math.round(current.estimatedDurationSec * (firstNarration.length / current.narration.length)))
  const secondDuration = Math.max(3, current.estimatedDurationSec - firstDuration)
  next.segments[params.index] = {
    ...cloneWorkspaceValue(current),
    narration: firstNarration,
    estimatedDurationSec: firstDuration,
  }
  const second: GuideSegment = {
    ...cloneWorkspaceValue(current),
    id: params.newId,
    title: params.newTitle,
    narration: secondNarration,
    estimatedDurationSec: secondDuration,
  }
  next.segments.splice(params.index + 1, 0, second)
  return {
    plan: next,
    changedUnitIds: [current.id, second.id],
    focusUnitId: second.id,
  }
}

export function mergeGuideSegmentWithNext(
  plan: GuideContentPlan,
  index: number,
): GuidePlanMutation | null {
  const current = plan.segments[index]
  const following = plan.segments[index + 1]
  if (!current || !following) return null
  const next = cloneWorkspaceValue(plan)
  next.segments[index] = {
    ...cloneWorkspaceValue(current),
    narration: [current.narration.trim(), following.narration.trim()].filter(Boolean).join('\n\n'),
    visualPurpose: uniqueStrings([current.visualPurpose, following.visualPurpose]).join(' / '),
    visualHints: uniqueStrings([...current.visualHints, ...following.visualHints]),
    riskFlags: [...current.riskFlags, ...following.riskFlags],
    onScreenText: uniqueStrings([current.onScreenText, following.onScreenText]).join(' / ') || undefined,
    estimatedDurationSec: current.estimatedDurationSec + following.estimatedDurationSec,
    sourceAnchor: {
      label: uniqueStrings([current.sourceAnchor.label, following.sourceAnchor.label]).join(' / '),
      quote: uniqueStrings([current.sourceAnchor.quote, following.sourceAnchor.quote]).join('\n') || undefined,
      startText: current.sourceAnchor.startText || following.sourceAnchor.startText,
      endText: following.sourceAnchor.endText || current.sourceAnchor.endText,
      chapter: uniqueStrings([current.sourceAnchor.chapter, following.sourceAnchor.chapter]).join(' / ') || undefined,
      visualAssetIds: uniqueStrings([
        ...(current.sourceAnchor.visualAssetIds || []),
        ...(following.sourceAnchor.visualAssetIds || []),
      ]),
    },
  }
  next.segments.splice(index + 1, 1)
  return {
    plan: next,
    changedUnitIds: [current.id, following.id],
    focusUnitId: current.id,
  }
}

export function removeGuideSegment(plan: GuideContentPlan, index: number): GuidePlanMutation | null {
  if (plan.segments.length <= 1 || index < 0 || index >= plan.segments.length) return null
  const next = cloneWorkspaceValue(plan)
  const [removed] = next.segments.splice(index, 1)
  const focus = next.segments[Math.min(index, next.segments.length - 1)]
  return {
    plan: next,
    changedUnitIds: [removed.id],
    focusUnitId: focus.id,
  }
}

export interface PickVideoDurationInput {
  targetDurationMs?: number | null
  supportedDurations?: readonly number[] | null
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function normalizeDurations(values: readonly number[] | null | undefined): number[] {
  return Array.from(new Set((values || [])
    .filter(isPositiveFiniteNumber)
    .map((value) => Math.round(value))
    .filter((value) => value > 0)))
    .sort((left, right) => left - right)
}

export function pickVideoDurationSeconds(input: PickVideoDurationInput): number | undefined {
  if (!isPositiveFiniteNumber(input.targetDurationMs)) return undefined

  const durations = normalizeDurations(input.supportedDurations)
  if (durations.length === 0) return undefined

  const targetSeconds = Math.max(1, Math.ceil(input.targetDurationMs / 1000))
  return durations.find((duration) => duration >= targetSeconds) || durations[durations.length - 1]
}

export function readPanelTargetDurationMs(panel: {
  targetDurationMs?: number | null
  duration?: number | null
}): number | undefined {
  if (isPositiveFiniteNumber(panel.targetDurationMs)) return Math.round(panel.targetDurationMs)
  if (isPositiveFiniteNumber(panel.duration)) return Math.round(panel.duration * 1000)
  return undefined
}

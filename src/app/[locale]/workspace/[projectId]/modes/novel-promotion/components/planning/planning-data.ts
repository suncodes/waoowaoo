export type PlanningRecord = Record<string, unknown>

export function asPlanningRecord(value: unknown): PlanningRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PlanningRecord
    : null
}

export function readPlanningString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function readPlanningNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readPlanningStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = readPlanningString(item)
    return text ? [text] : []
  })
}

export function readPlanningRecords(value: unknown): PlanningRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = asPlanningRecord(item)
    return record ? [record] : []
  })
}

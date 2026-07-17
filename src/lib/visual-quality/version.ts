import { createHash } from 'node:crypto'

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
  return `{${entries.join(',')}}`
}

export function createVisualVersionHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex')
}

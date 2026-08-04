type JsonRecord = Record<string, unknown>

export type PanelImagePromptState = {
  status: 'current' | 'stale'
  artifactId: string | null
  assetVersionHash: string | null
  updatedAt: string
  reason?: string
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function imagePromptState(referencePlan: unknown): PanelImagePromptState | null {
  const preparedPrompts = asRecord(asRecord(referencePlan).preparedPrompts)
  const image = asRecord(preparedPrompts.image)
  const status = image.status
  if (status !== 'current' && status !== 'stale') return null
  const updatedAt = readStringOrNull(image.updatedAt)
  if (!updatedAt) return null
  return {
    status,
    artifactId: readStringOrNull(image.artifactId),
    assetVersionHash: readStringOrNull(image.assetVersionHash),
    updatedAt,
    ...(readStringOrNull(image.reason) ? { reason: readStringOrNull(image.reason)! } : {}),
  }
}

function withImagePromptState(referencePlan: unknown, image: PanelImagePromptState): JsonRecord {
  const plan = asRecord(referencePlan)
  const preparedPrompts = asRecord(plan.preparedPrompts)
  return {
    ...plan,
    preparedPrompts: {
      ...preparedPrompts,
      schemaVersion: 1,
      image,
    },
  }
}

export function markPanelImagePromptStale(referencePlan: unknown, reason: string): JsonRecord {
  return withImagePromptState(referencePlan, {
    status: 'stale',
    artifactId: null,
    assetVersionHash: null,
    updatedAt: new Date().toISOString(),
    reason,
  })
}

export function markPanelImagePromptCurrent(params: {
  referencePlan: unknown
  artifactId: string
  assetVersionHash?: string | null
}): JsonRecord {
  return withImagePromptState(params.referencePlan, {
    status: 'current',
    artifactId: params.artifactId,
    assetVersionHash: params.assetVersionHash?.trim() || null,
    updatedAt: new Date().toISOString(),
  })
}

export function isPanelImagePromptCurrent(params: {
  referencePlan: unknown
  artifactId: string
  assetVersionHash?: string | null
}): boolean {
  const state = imagePromptState(params.referencePlan)
  if (!state) return true
  if (state.status !== 'current' || state.artifactId !== params.artifactId) return false
  return !state.assetVersionHash || state.assetVersionHash === (params.assetVersionHash?.trim() || null)
}

import { apiFetch } from '@/lib/api-fetch'

export type PreparedGenerationPromptKind = 'asset_image' | 'panel_image' | 'panel_video'

export interface PreparedGenerationPromptLookup {
  kind: PreparedGenerationPromptKind
  targetId: string
  refId?: string
  generationMode?: string
}

export interface PreparedGenerationPromptDescriptor {
  artifactId: string
  kind: PreparedGenerationPromptKind
  refId: string
  targetId: string
  generationMode: string | null
  generationOptions: Record<string, string | number | boolean>
  preparedAt: string
}

export async function fetchLatestPreparedGenerationPrompts(
  projectId: string,
  lookups: PreparedGenerationPromptLookup[],
): Promise<PreparedGenerationPromptDescriptor[]> {
  if (!projectId || lookups.length === 0) return []
  const response = await apiFetch(`/api/novel-promotion/${encodeURIComponent(projectId)}/prepared-generation-prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookups }),
  })
  if (!response.ok) {
    throw new Error('读取已固定提示词失败。')
  }
  const body = await response.json() as { preparedPrompts?: unknown }
  if (!Array.isArray(body.preparedPrompts)) return []
  return body.preparedPrompts.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const artifactId = typeof record.artifactId === 'string' ? record.artifactId.trim() : ''
    const kind = record.kind
    const refId = typeof record.refId === 'string' ? record.refId.trim() : ''
    const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : ''
    if (
      !artifactId
      || !refId
      || !targetId
      || (kind !== 'asset_image' && kind !== 'panel_image' && kind !== 'panel_video')
    ) {
      return []
    }
    const generationOptions: Record<string, string | number | boolean> = {}
    if (record.generationOptions && typeof record.generationOptions === 'object' && !Array.isArray(record.generationOptions)) {
      for (const [key, value] of Object.entries(record.generationOptions as Record<string, unknown>)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          generationOptions[key] = value
        }
      }
    }
    return [{
      artifactId,
      kind,
      refId,
      targetId,
      generationMode: typeof record.generationMode === 'string' && record.generationMode.trim()
        ? record.generationMode
        : null,
      generationOptions,
      preparedAt: typeof record.preparedAt === 'string' ? record.preparedAt : '',
    } satisfies PreparedGenerationPromptDescriptor]
  })
}

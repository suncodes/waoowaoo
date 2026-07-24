import OpenAI, { toFile } from 'openai'
import { getProviderConfig } from '@/lib/api-config'
import { loadImageResource } from '@/lib/media/outbound-image'
import type { OpenAICompatClientConfig } from '../types'

export function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const marker = ';base64,'
  const markerIndex = value.indexOf(marker)
  if (!value.startsWith('data:') || markerIndex === -1) return null
  const mimeType = value.slice(5, markerIndex)
  const base64 = value.slice(markerIndex + marker.length)
  if (!mimeType || !base64) return null
  return { mimeType, base64 }
}

export function readStringOption(value: unknown, optionName: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`OPENAI_COMPAT_OPTION_INVALID: ${optionName}`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`OPENAI_COMPAT_OPTION_INVALID: ${optionName}`)
  }
  return trimmed
}

export async function resolveOpenAICompatClientConfig(userId: string, providerId: string): Promise<OpenAICompatClientConfig> {
  const config = await getProviderConfig(userId, providerId)
  if (!config.baseUrl) {
    throw new Error(`PROVIDER_BASE_URL_MISSING: ${config.id}`)
  }
  return {
    providerId: config.id,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  }
}

export function createOpenAICompatClient(config: OpenAICompatClientConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })
}

export async function toUploadFile(imageSource: string, index: number): Promise<File> {
  const resource = await loadImageResource(imageSource)
  const filename = resource.sourceKind === 'data-url'
    ? `reference-${index}.png`
    : resource.filename || `reference-${index}.png`
  return await toFile(resource.bytes, filename, { type: resource.mimeType })
}

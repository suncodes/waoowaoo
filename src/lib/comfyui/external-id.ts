import type { ComfyUIMediaType } from './profile'

export interface ParsedComfyUIExternalId {
  type: 'IMAGE' | 'VIDEO'
  providerId: string
  outputNodeId: string
  promptId: string
}

function encodeToken(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`COMFYUI_EXTERNAL_ID_${field.toUpperCase()}_MISSING`)
  }
  return Buffer.from(normalized, 'utf8').toString('base64url')
}

function decodeToken(value: string, field: string): string {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8').trim()
    if (!decoded) {
      throw new Error(`COMFYUI_EXTERNAL_ID_${field.toUpperCase()}_INVALID`)
    }
    return decoded
  } catch {
    throw new Error(`COMFYUI_EXTERNAL_ID_${field.toUpperCase()}_INVALID`)
  }
}

export function formatComfyUIExternalId(input: {
  mediaType: ComfyUIMediaType
  providerId: string
  outputNodeId: string
  promptId: string
}): string {
  const type = input.mediaType === 'video' ? 'VIDEO' : 'IMAGE'
  return [
    'COMFY',
    type,
    encodeToken(input.providerId, 'provider'),
    encodeToken(input.outputNodeId, 'output_node'),
    encodeToken(input.promptId, 'prompt'),
  ].join(':')
}

export function parseComfyUIExternalId(externalId: string): ParsedComfyUIExternalId {
  const parts = externalId.split(':')
  const [provider, type, providerToken, outputNodeToken, promptToken] = parts
  if (
    provider !== 'COMFY'
    || (type !== 'IMAGE' && type !== 'VIDEO')
    || parts.length !== 5
    || !providerToken
    || !outputNodeToken
    || !promptToken
  ) {
    throw new Error(`COMFYUI_EXTERNAL_ID_INVALID: ${externalId}`)
  }

  return {
    type,
    providerId: decodeToken(providerToken, 'provider'),
    outputNodeId: decodeToken(outputNodeToken, 'output_node'),
    promptId: decodeToken(promptToken, 'prompt'),
  }
}

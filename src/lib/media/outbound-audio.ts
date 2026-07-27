import path from 'node:path'
import crypto from 'node:crypto'
import { createScopedLogger } from '@/lib/logging/core'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'

type StorageHelpers = Pick<typeof import('@/lib/storage'), 'extractStorageKey' | 'getObjectBuffer' | 'toFetchableUrl'>

export type OutboundAudioMimeType = 'audio/mpeg' | 'audio/wav'
export type OutboundAudioSourceKind = 'data-url' | 'storage' | 'remote-url'

export interface OutboundAudioCandidate {
  url: string
  speaker?: string
  source?: 'character' | 'speaker'
  provider?: string
  voiceType?: string
}

export interface OutboundAudioReference {
  url: string
  speaker?: string
  source?: 'character' | 'speaker'
  provider?: string
  voiceType?: string
  mimeType: OutboundAudioMimeType
  byteSize: number
  hash: string
  durationMs?: number
  sourceKind: OutboundAudioSourceKind
}

export interface OutboundAudioReferenceSummary {
  speaker?: string
  source?: 'character' | 'speaker'
  provider?: string
  voiceType?: string
  mimeType: OutboundAudioMimeType
  byteSize: number
  hash: string
  durationMs?: number
  sourceKind: OutboundAudioSourceKind
}

export type OutboundAudioIssueCode =
  | 'OUTBOUND_AUDIO_EMPTY_INPUT'
  | 'OUTBOUND_AUDIO_MEDIA_ROUTE_UNRESOLVED'
  | 'OUTBOUND_AUDIO_UNSUPPORTED_INPUT'
  | 'OUTBOUND_AUDIO_FETCH_FAILED'
  | 'OUTBOUND_AUDIO_FETCH_EXCEPTION'
  | 'OUTBOUND_AUDIO_FORMAT_UNSUPPORTED'
  | 'OUTBOUND_AUDIO_TOO_LARGE'
  | 'OUTBOUND_AUDIO_DURATION_OUT_OF_RANGE'
  | 'OUTBOUND_AUDIO_UNKNOWN'

export interface OutboundAudioIssue {
  index: number
  input: string
  code: OutboundAudioIssueCode
  message: string
}

interface AudioBinaryResource {
  bytes: Buffer
  mimeType: string
  sourceKind: OutboundAudioSourceKind
}

const logger = createScopedLogger({ module: 'media.outbound-audio' })

const MAX_REFERENCE_AUDIO_COUNT = 3
const MAX_REFERENCE_AUDIO_BYTES = 15 * 1024 * 1024
const MIN_REFERENCE_AUDIO_DURATION_MS = 2_000
const MAX_REFERENCE_AUDIO_DURATION_MS = 15_000
const MAX_NEXT_MEDIA_UNWRAP_DEPTH = 6
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

const STORAGE_KEY_PREFIXES = [
  'audio/',
  'audios/',
  'global-voice/',
  'images/audio/',
  'images/global-voice/',
  'images/voice/',
  'images/voices/',
  'video/',
  'videos/',
  'voice/',
  'voices/',
] as const

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

let storageHelpersPromise: Promise<StorageHelpers> | null = null

async function getStorageHelpers(): Promise<StorageHelpers> {
  if (!storageHelpersPromise) {
    storageHelpersPromise = import('@/lib/storage').then((mod) => ({
      extractStorageKey: mod.extractStorageKey,
      getObjectBuffer: mod.getObjectBuffer,
      toFetchableUrl: mod.toFetchableUrl,
    }))
  }
  return await storageHelpersPromise
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeInput(input: string): string {
  const value = readTrimmedString(input)
  if (!value) {
    throw new Error('OUTBOUND_AUDIO_EMPTY_INPUT: outbound audio input is empty')
  }
  return value
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function isStorageKey(value: string): boolean {
  return STORAGE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function toUrlMaybe(value: string): URL | null {
  try {
    if (isHttpUrl(value)) return new URL(value)
    if (value.startsWith('/')) return new URL(value, 'http://localhost')
  } catch {
    return null
  }
  return null
}

function decodeRepeatedly(raw: string): string {
  let value = raw
  for (let i = 0; i < MAX_NEXT_MEDIA_UNWRAP_DEPTH; i += 1) {
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) break
      value = decoded
    } catch {
      break
    }
  }
  return value
}

function parseDataUrl(value: string): AudioBinaryResource | null {
  const marker = ';base64,'
  const markerIndex = value.indexOf(marker)
  if (!value.startsWith('data:') || markerIndex === -1) return null
  const mimeType = value.slice(5, markerIndex).split(';')[0]?.trim() || DEFAULT_CONTENT_TYPE
  const base64 = value.slice(markerIndex + marker.length).trim()
  if (!base64) return null
  return {
    bytes: Buffer.from(base64, 'base64'),
    mimeType,
    sourceKind: 'data-url',
  }
}

function isLikelyRawBase64(value: string): boolean {
  if (value.length < 32) return false
  if (value.includes('/') || value.includes('\\') || value.includes(':')) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0
}

function normalizeAudioMimeType(value: string | null | undefined): OutboundAudioMimeType | null {
  const mimeType = readTrimmedString(value).toLowerCase().split(';')[0]?.trim()
  if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') return 'audio/mpeg'
  if (mimeType === 'audio/wav' || mimeType === 'audio/wave' || mimeType === 'audio/x-wav') return 'audio/wav'
  return null
}

function detectMimeFromBuffer(buffer: Uint8Array): string | null {
  if (buffer.length >= 12) {
    const isWav =
      buffer[0] === 0x52
      && buffer[1] === 0x49
      && buffer[2] === 0x46
      && buffer[3] === 0x46
      && buffer[8] === 0x57
      && buffer[9] === 0x41
      && buffer[10] === 0x56
      && buffer[11] === 0x45
    if (isWav) return 'audio/wav'
  }

  if (buffer.length >= 3) {
    const isMp3WithId3 = buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33
    const isMp3FrameSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0
    if (isMp3WithId3 || isMp3FrameSync) return 'audio/mpeg'
  }

  return null
}

function guessMimeType(input: string, contentTypeHeader: string | null, buffer: Uint8Array): string {
  const normalizedHeader = normalizeAudioMimeType(contentTypeHeader)
  if (normalizedHeader) return normalizedHeader
  const sniffed = detectMimeFromBuffer(buffer)
  if (sniffed) return sniffed
  const parsed = toUrlMaybe(input)
  const pathname = parsed?.pathname ?? input
  const ext = path.extname(pathname).toLowerCase()
  return MIME_BY_EXT[ext] || DEFAULT_CONTENT_TYPE
}

function filenameStorageKeyFromApiPath(parsed: URL): string | null {
  if (parsed.pathname.startsWith('/api/files/')) {
    return decodeRepeatedly(parsed.pathname.replace(/^\/api\/files\//, ''))
  }
  if (parsed.pathname === '/api/storage/sign') {
    const key = parsed.searchParams.get('key')
    return key ? decodeRepeatedly(key) : null
  }
  return null
}

async function resolveStorageKeyForDirectRead(input: string): Promise<string | null> {
  if (isStorageKey(input)) return input

  const parsed = toUrlMaybe(input)
  if (parsed?.pathname.startsWith('/m/')) {
    const storageKey = await resolveStorageKeyFromMediaValue(parsed.pathname)
    if (!storageKey) {
      throw new Error(`OUTBOUND_AUDIO_MEDIA_ROUTE_UNRESOLVED: failed to resolve ${parsed.pathname}`)
    }
    return storageKey
  }

  if (parsed) {
    const apiStorageKey = filenameStorageKeyFromApiPath(parsed)
    if (apiStorageKey) return apiStorageKey
  }

  if (input.startsWith('/')) {
    const rootStorageKey = input.slice(1)
    if (isStorageKey(rootStorageKey)) return rootStorageKey
    return null
  }

  if (isHttpUrl(input)) return null

  const storageKeyFromMedia = await resolveStorageKeyFromMediaValue(input)
  if (storageKeyFromMedia) return storageKeyFromMedia

  const { extractStorageKey } = await getStorageHelpers()
  return extractStorageKey(input)
}

async function toFetchableAbsoluteUrl(value: string): Promise<string> {
  const { toFetchableUrl } = await getStorageHelpers()
  return toFetchableUrl(value)
}

async function loadAudioResource(input: string): Promise<AudioBinaryResource> {
  const normalizedInput = normalizeInput(input)

  const parsedDataUrl = parseDataUrl(normalizedInput)
  if (parsedDataUrl) return parsedDataUrl

  const storageKey = await resolveStorageKeyForDirectRead(normalizedInput)
  if (storageKey) {
    const { getObjectBuffer } = await getStorageHelpers()
    const bytes = await getObjectBuffer(storageKey)
    return {
      bytes,
      mimeType: guessMimeType(storageKey, null, bytes),
      sourceKind: 'storage',
    }
  }

  if (isLikelyRawBase64(normalizedInput)) {
    const bytes = Buffer.from(normalizedInput, 'base64')
    return {
      bytes,
      mimeType: guessMimeType('reference-audio', null, bytes),
      sourceKind: 'data-url',
    }
  }

  const fetchUrl = await toFetchableAbsoluteUrl(normalizedInput)
  let response: Response
  try {
    response = await fetch(fetchUrl)
  } catch {
    throw new Error(`OUTBOUND_AUDIO_FETCH_EXCEPTION: ${fetchUrl}`)
  }

  if (!response.ok) {
    throw new Error(`OUTBOUND_AUDIO_FETCH_FAILED: ${response.status}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    bytes,
    mimeType: guessMimeType(normalizedInput, response.headers.get('content-type'), bytes),
    sourceKind: 'remote-url',
  }
}

function getWavDurationMs(buffer: Buffer): number | null {
  if (detectMimeFromBuffer(buffer) !== 'audio/wav' || buffer.length < 44) return null

  let offset = 12
  let byteRate: number | null = null
  let dataSize: number | null = null
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkDataOffset = offset + 8
    if (chunkId === 'fmt ' && chunkDataOffset + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(chunkDataOffset + 8)
    } else if (chunkId === 'data') {
      dataSize = chunkSize
      break
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2)
  }

  if (!byteRate || !dataSize) return null
  return Math.round((dataSize / byteRate) * 1000)
}

function validateResource(resource: AudioBinaryResource, input: string): {
  mimeType: OutboundAudioMimeType
  durationMs?: number
} {
  if (resource.bytes.length > MAX_REFERENCE_AUDIO_BYTES) {
    throw new Error(`OUTBOUND_AUDIO_TOO_LARGE: ${resource.bytes.length}`)
  }

  const mimeType = normalizeAudioMimeType(resource.mimeType)
  if (!mimeType) {
    throw new Error(`OUTBOUND_AUDIO_FORMAT_UNSUPPORTED: ${resource.mimeType || input}`)
  }

  const durationMs = mimeType === 'audio/wav' ? getWavDurationMs(resource.bytes) : null
  if (
    durationMs !== null
    && (durationMs < MIN_REFERENCE_AUDIO_DURATION_MS || durationMs > MAX_REFERENCE_AUDIO_DURATION_MS)
  ) {
    throw new Error(`OUTBOUND_AUDIO_DURATION_OUT_OF_RANGE: ${durationMs}ms`)
  }

  return {
    mimeType,
    ...(durationMs !== null ? { durationMs } : {}),
  }
}

function classifyIssue(error: unknown): OutboundAudioIssueCode {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('OUTBOUND_AUDIO_EMPTY_INPUT')) return 'OUTBOUND_AUDIO_EMPTY_INPUT'
  if (message.startsWith('OUTBOUND_AUDIO_MEDIA_ROUTE_UNRESOLVED')) return 'OUTBOUND_AUDIO_MEDIA_ROUTE_UNRESOLVED'
  if (message.startsWith('OUTBOUND_AUDIO_FETCH_FAILED')) return 'OUTBOUND_AUDIO_FETCH_FAILED'
  if (message.startsWith('OUTBOUND_AUDIO_FETCH_EXCEPTION')) return 'OUTBOUND_AUDIO_FETCH_EXCEPTION'
  if (message.startsWith('OUTBOUND_AUDIO_FORMAT_UNSUPPORTED')) return 'OUTBOUND_AUDIO_FORMAT_UNSUPPORTED'
  if (message.startsWith('OUTBOUND_AUDIO_TOO_LARGE')) return 'OUTBOUND_AUDIO_TOO_LARGE'
  if (message.startsWith('OUTBOUND_AUDIO_DURATION_OUT_OF_RANGE')) return 'OUTBOUND_AUDIO_DURATION_OUT_OF_RANGE'
  return 'OUTBOUND_AUDIO_UNKNOWN'
}

function hashAudio(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export function summarizeOutboundAudioReferences(
  references: OutboundAudioReference[],
): OutboundAudioReferenceSummary[] {
  return references.map((reference) => ({
    ...(reference.speaker ? { speaker: reference.speaker } : {}),
    ...(reference.source ? { source: reference.source } : {}),
    ...(reference.provider ? { provider: reference.provider } : {}),
    ...(reference.voiceType ? { voiceType: reference.voiceType } : {}),
    mimeType: reference.mimeType,
    byteSize: reference.byteSize,
    hash: reference.hash,
    ...(typeof reference.durationMs === 'number' ? { durationMs: reference.durationMs } : {}),
    sourceKind: reference.sourceKind,
  }))
}

export async function resolveOutboundAudioReferences(
  candidates: OutboundAudioCandidate[],
  options: {
    maxCount?: number
    onIssue?: (issue: OutboundAudioIssue) => void
  } = {},
): Promise<{
  references: OutboundAudioReference[]
  issues: OutboundAudioIssue[]
}> {
  const maxCount = Math.max(0, Math.min(options.maxCount ?? MAX_REFERENCE_AUDIO_COUNT, MAX_REFERENCE_AUDIO_COUNT))
  const references: OutboundAudioReference[] = []
  const issues: OutboundAudioIssue[] = []
  const seenInputs = new Set<string>()
  const seenHashes = new Set<string>()

  for (let index = 0; index < candidates.length && references.length < maxCount; index += 1) {
    const candidate = candidates[index]
    const input = readTrimmedString(candidate.url)
    if (!input || seenInputs.has(input)) continue
    seenInputs.add(input)

    try {
      const resource = await loadAudioResource(input)
      const validated = validateResource(resource, input)
      const hash = hashAudio(resource.bytes)
      if (seenHashes.has(hash)) continue
      seenHashes.add(hash)

      references.push({
        url: `data:${validated.mimeType};base64,${resource.bytes.toString('base64')}`,
        ...(candidate.speaker ? { speaker: candidate.speaker } : {}),
        ...(candidate.source ? { source: candidate.source } : {}),
        ...(candidate.provider ? { provider: candidate.provider } : {}),
        ...(candidate.voiceType ? { voiceType: candidate.voiceType } : {}),
        mimeType: validated.mimeType,
        byteSize: resource.bytes.length,
        hash,
        ...(typeof validated.durationMs === 'number' ? { durationMs: validated.durationMs } : {}),
        sourceKind: resource.sourceKind,
      })
    } catch (error) {
      const issue: OutboundAudioIssue = {
        index,
        input,
        code: classifyIssue(error),
        message: error instanceof Error ? error.message : String(error),
      }
      issues.push(issue)
      options.onIssue?.(issue)
      logger.warn({
        message: 'reference audio normalize failed',
        details: issue,
      })
    }
  }

  return { references, issues }
}

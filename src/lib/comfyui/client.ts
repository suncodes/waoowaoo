import type { ComfyUIMediaType, ComfyUIWorkflowNode } from './profile'

type ComfyUIErrorCode = 'INVALID_PARAMS' | 'NETWORK_ERROR' | 'EXTERNAL_ERROR'

interface ComfyUIError extends Error {
  code: ComfyUIErrorCode
  provider: 'comfyui'
  status?: number
}

export class ComfyUISubmissionUnknownError extends Error {
  readonly code = 'COMFYUI_SUBMISSION_UNKNOWN' as const
  readonly provider = 'comfyui' as const
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ComfyUISubmissionUnknownError'
    this.status = status
  }
}

export interface ComfyUIUploadedImage {
  name: string
  subfolder?: string
  type?: string
}

export interface ComfyUIOutputFile {
  filename: string
  subfolder?: string
  type?: string
}

export type ComfyUIHistoryResult =
  | { status: 'pending' }
  | { status: 'completed'; file: ComfyUIOutputFile }
  | { status: 'failed'; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function createComfyUIError(
  code: ComfyUIErrorCode,
  message: string,
  status?: number,
): ComfyUIError {
  const error = new Error(message) as ComfyUIError
  error.code = code
  error.provider = 'comfyui'
  if (typeof status === 'number') error.status = status
  return error
}

function responseErrorMessage(prefix: string, status: number, body: string): string {
  const detail = body.trim().replace(/\s+/g, ' ').slice(0, 500)
  return detail ? `${prefix}: status ${status} ${detail}` : `${prefix}: status ${status}`
}

function joinComfyUIPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function isLoopbackOrUnspecifiedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === '0.0.0.0'
    || host === '::'
    || host === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(host)
    // URL 会把 [::ffff:127.0.0.1] 规范化为 [::ffff:7f00:1]。
    || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host)
  )
}

/**
 * 保留反向代理路径（如 http://host/comfy），并要求服务端和 Worker 都能直连的
 * 远端 http(s) 地址。ComfyUI 当前部署在另一台内网机器，不能填写回环地址。
 */
export function normalizeComfyUIBaseUrl(rawBaseUrl: string): string {
  const value = rawBaseUrl.trim()
  if (!value) {
    throw createComfyUIError('INVALID_PARAMS', 'COMFYUI_BASE_URL_MISSING')
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw createComfyUIError('INVALID_PARAMS', 'COMFYUI_BASE_URL_INVALID')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw createComfyUIError('INVALID_PARAMS', 'COMFYUI_BASE_URL_PROTOCOL_INVALID')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw createComfyUIError('INVALID_PARAMS', 'COMFYUI_BASE_URL_INVALID')
  }
  if (isLoopbackOrUnspecifiedHost(parsed.hostname)) {
    throw createComfyUIError('INVALID_PARAMS', 'COMFYUI_BASE_URL_REMOTE_REQUIRED')
  }

  const pathname = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${pathname === '/' ? '' : pathname}`
}

export function buildComfyUIEndpoint(baseUrl: string, path: string): string {
  return joinComfyUIPath(normalizeComfyUIBaseUrl(baseUrl), path)
}

function parseJsonResponse(body: string, errorMessage: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown
    if (!isRecord(parsed)) {
      throw new Error('not object')
    }
    return parsed
  } catch {
    throw createComfyUIError('EXTERNAL_ERROR', errorMessage)
  }
}

function formatPromptValidationError(value: unknown): string {
  if (typeof value === 'string') return value.trim().slice(0, 1_000)
  try {
    return JSON.stringify(value).replace(/\s+/g, ' ').slice(0, 1_000)
  } catch {
    return ''
  }
}

function getPromptValidationError(payload: Record<string, unknown>): string | null {
  for (const field of ['error', 'node_errors']) {
    const value = payload[field]
    const detail = formatPromptValidationError(value)
    if (detail && detail !== '{}' && detail !== '[]' && detail !== 'null') {
      return `COMFYUI_PROMPT_REJECTED: ${detail}`
    }
  }
  return null
}

function readUploadedImagePath(uploaded: ComfyUIUploadedImage): string {
  const name = uploaded.name.trim()
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw createComfyUIError('EXTERNAL_ERROR', 'COMFYUI_UPLOAD_RESPONSE_INVALID')
  }

  const subfolder = (uploaded.subfolder || '').trim().replace(/\\/g, '/')
  if (!subfolder) return name
  const segments = subfolder.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw createComfyUIError('EXTERNAL_ERROR', 'COMFYUI_UPLOAD_RESPONSE_INVALID')
  }
  return `${segments.join('/')}/${name}`
}

/** 上传参考图到远端 ComfyUI input 目录，并返回可写入 LoadImage 节点的文件名。 */
export async function uploadComfyUIImage(input: {
  baseUrl: string
  bytes: Buffer
  mimeType: string
  filename: string
}): Promise<string> {
  const formData = new FormData()
  const imageBytes = Uint8Array.from(input.bytes)
  const blob = new Blob([imageBytes], { type: input.mimeType || 'image/png' })
  formData.append('image', blob, input.filename || 'reference.png')

  let response: Response
  try {
    response = await fetch(buildComfyUIEndpoint(input.baseUrl, '/upload/image'), {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw createComfyUIError('NETWORK_ERROR', `COMFYUI_IMAGE_UPLOAD_FAILED: ${detail}`)
  }

  const body = await response.text().catch(() => '')
  if (!response.ok) {
    throw createComfyUIError(
      response.status >= 500 ? 'EXTERNAL_ERROR' : 'INVALID_PARAMS',
      responseErrorMessage('COMFYUI_IMAGE_UPLOAD_FAILED', response.status, body),
      response.status,
    )
  }

  const payload = parseJsonResponse(body, 'COMFYUI_IMAGE_UPLOAD_RESPONSE_INVALID')
  const name = readTrimmedString(payload.name)
  if (!name) {
    throw createComfyUIError('EXTERNAL_ERROR', 'COMFYUI_IMAGE_UPLOAD_RESPONSE_INVALID')
  }
  return readUploadedImagePath({
    name,
    subfolder: readTrimmedString(payload.subfolder) || undefined,
    type: readTrimmedString(payload.type) || undefined,
  })
}

/**
 * 提交工作流。提交请求的网络异常、5xx 和无法确认 prompt_id 的成功响应都不能自动
 * 重试：ComfyUI 可能已将任务入队，重试会产生重复生成。
 */
export async function submitComfyUIWorkflow(
  baseUrl: string,
  workflow: Record<string, ComfyUIWorkflowNode>,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(buildComfyUIEndpoint(baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ComfyUISubmissionUnknownError(`COMFYUI_SUBMISSION_UNKNOWN: ${detail}`)
  }

  const body = await response.text().catch(() => '')
  if (!response.ok) {
    const message = responseErrorMessage('COMFYUI_PROMPT_SUBMISSION_FAILED', response.status, body)
    // 这些状态表示请求没有进入 ComfyUI 队列；其余状态都按未知结果处理，防止重复提交。
    if ([400, 401, 403, 404, 405, 422].includes(response.status)) {
      throw createComfyUIError('INVALID_PARAMS', message, response.status)
    }
    throw new ComfyUISubmissionUnknownError(`COMFYUI_SUBMISSION_UNKNOWN: ${message}`, response.status)
  }

  let payload: Record<string, unknown>
  try {
    payload = parseJsonResponse(body, 'COMFYUI_PROMPT_RESPONSE_INVALID')
  } catch {
    throw new ComfyUISubmissionUnknownError('COMFYUI_SUBMISSION_UNKNOWN: prompt response is not a JSON object')
  }
  const promptValidationError = getPromptValidationError(payload)
  if (promptValidationError) {
    throw createComfyUIError('INVALID_PARAMS', promptValidationError, response.status)
  }
  const promptId = readTrimmedString(payload.prompt_id)
  if (!promptId) {
    throw new ComfyUISubmissionUnknownError('COMFYUI_SUBMISSION_UNKNOWN: prompt_id is missing')
  }
  return promptId
}

export async function getComfyUIHistory(
  baseUrl: string,
  promptId: string,
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(
      buildComfyUIEndpoint(baseUrl, `/history/${encodeURIComponent(promptId)}`),
      {
        method: 'GET',
        signal: AbortSignal.timeout(30_000),
      },
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw createComfyUIError('NETWORK_ERROR', `COMFYUI_HISTORY_REQUEST_FAILED: ${detail}`)
  }

  const body = await response.text().catch(() => '')
  if (!response.ok) {
    throw createComfyUIError(
      response.status >= 500 ? 'EXTERNAL_ERROR' : 'INVALID_PARAMS',
      responseErrorMessage('COMFYUI_HISTORY_REQUEST_FAILED', response.status, body),
      response.status,
    )
  }
  return parseJsonResponse(body, 'COMFYUI_HISTORY_RESPONSE_INVALID')
}

function extractStatusError(rawStatus: unknown): string {
  if (!isRecord(rawStatus)) return 'ComfyUI task failed'
  const messages = rawStatus.messages
  if (typeof messages === 'string' && messages.trim()) return messages.trim().slice(0, 500)
  if (Array.isArray(messages) && messages.length > 0) {
    try {
      return JSON.stringify(messages[0]).slice(0, 500)
    } catch {
      return 'ComfyUI task failed'
    }
  }
  const status = readTrimmedString(rawStatus.status_str)
  return status ? `ComfyUI task ${status}` : 'ComfyUI task failed'
}

function readOutputFiles(rawOutput: unknown, mediaType: ComfyUIMediaType): ComfyUIOutputFile[] {
  if (!isRecord(rawOutput)) return []
  const fields = mediaType === 'video'
    ? ['gifs', 'videos', 'images']
    : ['images', 'gifs']

  for (const field of fields) {
    const rawFiles = rawOutput[field]
    if (!Array.isArray(rawFiles)) continue
    const files: ComfyUIOutputFile[] = []
    for (const rawFile of rawFiles) {
      if (!isRecord(rawFile)) continue
      const filename = readTrimmedString(rawFile.filename)
      if (!filename) continue
      files.push({
        filename,
        subfolder: readTrimmedString(rawFile.subfolder) || undefined,
        type: readTrimmedString(rawFile.type) || undefined,
      })
    }
    if (files.length > 0) return files
  }
  return []
}

/** 将 /history 响应归一化为 Worker 可消费的任务状态。 */
export function resolveComfyUIHistoryResult(input: {
  history: Record<string, unknown>
  promptId: string
  outputNodeId: string
  mediaType: ComfyUIMediaType
}): ComfyUIHistoryResult {
  const historyEntry = input.history[input.promptId]
  if (!isRecord(historyEntry)) return { status: 'pending' }

  const rawStatus = historyEntry.status
  const statusString = isRecord(rawStatus)
    ? readTrimmedString(rawStatus.status_str).toLowerCase()
    : ''
  if (['error', 'failed', 'cancelled', 'canceled'].includes(statusString)) {
    return { status: 'failed', error: extractStatusError(rawStatus) }
  }

  const outputs = historyEntry.outputs
  const outputNode = isRecord(outputs) ? outputs[input.outputNodeId] : undefined
  const files = readOutputFiles(outputNode, input.mediaType)
  if (files.length > 0) {
    return { status: 'completed', file: files[0] }
  }

  if (['success', 'completed', 'complete', 'finished'].includes(statusString)) {
    return {
      status: 'failed',
      error: `COMFYUI_OUTPUT_NOT_FOUND: output node ${input.outputNodeId}`,
    }
  }
  return { status: 'pending' }
}

export function buildComfyUIViewUrl(baseUrl: string, file: ComfyUIOutputFile): string {
  const filename = file.filename.trim()
  if (!filename) {
    throw createComfyUIError('EXTERNAL_ERROR', 'COMFYUI_OUTPUT_FILE_INVALID')
  }
  const searchParams = new URLSearchParams({
    filename,
    type: file.type?.trim() || 'output',
  })
  const subfolder = file.subfolder?.trim()
  if (subfolder) searchParams.set('subfolder', subfolder)
  return `${buildComfyUIEndpoint(baseUrl, '/view')}?${searchParams.toString()}`
}

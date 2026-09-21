/**
 * ComfyUI 真实任务冒烟测试。
 *
 * 默认只做只读预检（/system_stats、/object_info、Profile 与节点注册表比对），
 * 只有显式传入 --submit 才会上传参考图或提交 /prompt。
 *
 * 用法：
 *   npx tsx scripts/test-comfyui-smoke.ts --base-url=http://192.168.9.148:8188 --profile=./comfyui-image-profile.json
 *   npx tsx scripts/test-comfyui-smoke.ts --base-url=http://192.168.9.148:8188 --profile=./comfyui-image-profile.json --submit --scenario=text-to-image --steps=4 --width=512 --height=512
 *   npx tsx scripts/test-comfyui-smoke.ts --base-url=http://192.168.9.148:8188 --profile=./comfyui-image-reference-profile.json --submit --scenario=image-to-image --reference=./fixtures/reference.png
 *   npx tsx scripts/test-comfyui-smoke.ts --base-url=http://192.168.9.148:8188 --profile=./scripts/comfyui-profiles/minimax-h3-text-to-video.profile.json --submit --scenario=text-to-video --prompt="a fox runs through a snowy forest" --duration=5 --fps=24 --timeout-seconds=900
 *   npx tsx scripts/test-comfyui-smoke.ts --base-url=http://192.168.9.148:8188 --profile=./comfyui-video-profile.json --submit --scenario=image-to-video --reference=./fixtures/reference.png --timeout-seconds=900
 *
 * --profile 必须是本项目配置中心使用的 ComfyUI Profile JSON，而不是仅包含
 * workflow 的导出文件。真实提交会在 ComfyUI 的 input/output 目录留下测试文件；
 * 本脚本不会自动重试无法确认结果的提交，避免重复生成。
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ComfyUISubmissionUnknownError,
  buildComfyUIEndpoint,
  buildComfyUIViewUrl,
  getComfyUIHistory,
  normalizeComfyUIBaseUrl,
  resolveComfyUIHistoryResult,
} from '../src/lib/comfyui/client'
import { parseComfyUIExternalId } from '../src/lib/comfyui/external-id'
import {
  validateComfyUIProfile,
  type ComfyUIMediaType,
  type ComfyUIProfile,
} from '../src/lib/comfyui/profile'
import {
  generateComfyUIImage,
  generateComfyUITextToVideo,
  generateComfyUIVideo,
} from '../src/lib/comfyui/runtime'

type Scenario = 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video'

type CliOptions = {
  baseUrl: string | null
  profilePath: string | null
  scenario: Scenario
  submit: boolean
  prompt: string
  referencePath: string | null
  timeoutSeconds: number
  pollIntervalMs: number
  seed: number
  width?: number
  height?: number
  steps?: number
  duration?: number
  fps?: number
  extraOptions: Record<string, unknown>
}

type ObjectInfo = Record<string, unknown>

type DownloadedOutput = {
  bytes: number
  contentType: string | null
  detectedType: string | null
}

class SmokeTestTimeoutError extends Error {
  constructor(promptId: string, timeoutSeconds: number) {
    super(`COMFYUI_SMOKE_TIMEOUT: prompt_id=${promptId} did not finish within ${timeoutSeconds} seconds`)
    this.name = 'SmokeTestTimeoutError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function printUsage(): void {
  process.stdout.write(`
ComfyUI 真实任务冒烟测试

默认行为：只读预检，不会创建 ComfyUI 任务。

必填参数：
  --base-url=<url>              远端 ComfyUI 地址，例如 http://192.168.9.148:8188

可选预检参数：
  --profile=<path>              本项目格式的 ComfyUI Profile JSON；提供后会校验节点和输入映射

真实提交参数（必须显式带 --submit）：
  --submit                      允许创建真实 ComfyUI 任务
  --scenario=<name>             text-to-image（默认）、image-to-image、text-to-video、image-to-video
  --reference=<path>            image-to-image / image-to-video 必填的本地参考图
  --prompt=<text>               测试提示词
  --steps=<number>              仅当 Profile 映射 options.steps 时生效
  --duration=<number>           仅当 Profile 映射 options.duration 时生效
  --fps=<number>                仅当 Profile 映射 options.fps 时生效
  --width=<number>              仅当 Profile 映射 width 时生效
  --height=<number>             仅当 Profile 映射 height 时生效
  --seed=<number>               仅当 Profile 映射 seed 时生效，默认 20260921
  --options-json=<json>         工作流专有参数，例如 '{"cfg":1,"fps":8}'；仅已映射 options.<key> 生效
  --timeout-seconds=<number>    轮询上限，默认 300，范围 10-1800
  --poll-interval-ms=<number>   轮询间隔，默认 2000，范围 500-30000

示例：
  npx tsx scripts/test-comfyui-smoke.ts --base-url=http://192.168.9.148:8188 --profile=./comfyui-image-profile.json
  npx tsx scripts/test-comfyui-smoke.ts --base-url=http://192.168.9.148:8188 --profile=./comfyui-image-profile.json --submit --steps=4 --width=512 --height=512
  npx tsx scripts/test-comfyui-smoke.ts --base-url=http://192.168.9.148:8188 --profile=./scripts/comfyui-profiles/minimax-h3-text-to-video.profile.json --submit --scenario=text-to-video --prompt="a fox runs through a snowy forest" --duration=5 --fps=24 --timeout-seconds=900
`)
}

function readFlagValue(name: string): string | null {
  const equalsPrefix = `--${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(equalsPrefix))
  if (inline) {
    const value = inline.slice(equalsPrefix.length).trim()
    return value || null
  }

  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return null
  const next = process.argv[index + 1]?.trim()
  return next && !next.startsWith('--') ? next : null
}

function readNumberFlag(name: string, options?: { min?: number; max?: number }): number | undefined {
  const raw = readFlagValue(name)
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || (options?.min !== undefined && value < options.min) || (options?.max !== undefined && value > options.max)) {
    throw new Error(`INVALID_ARGUMENT: --${name} must be a number${options?.min !== undefined ? ` >= ${options.min}` : ''}${options?.max !== undefined ? ` and <= ${options.max}` : ''}`)
  }
  return value
}

function readObjectFlag(name: string): Record<string, unknown> {
  const raw = readFlagValue(name)
  if (raw === null) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw new Error(`INVALID_ARGUMENT: --${name} must be a JSON object`)
  }
}

function parseScenario(value: string | null): Scenario {
  if (value === null || value === 'text-to-image') return 'text-to-image'
  if (value === 'image-to-image' || value === 'text-to-video' || value === 'image-to-video') return value
  throw new Error('INVALID_ARGUMENT: --scenario must be text-to-image, image-to-image, text-to-video, or image-to-video')
}

function parseOptions(): CliOptions | null {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage()
    return null
  }

  const timeoutSeconds = readNumberFlag('timeout-seconds', { min: 10, max: 1_800 }) ?? 300
  const pollIntervalMs = readNumberFlag('poll-interval-ms', { min: 500, max: 30_000 }) ?? 2_000
  const width = readNumberFlag('width', { min: 1, max: 16_384 })
  const height = readNumberFlag('height', { min: 1, max: 16_384 })
  const steps = readNumberFlag('steps', { min: 1, max: 10_000 })
  const duration = readNumberFlag('duration', { min: 0.1, max: 600 })
  const fps = readNumberFlag('fps', { min: 1, max: 240 })
  const seed = readNumberFlag('seed', { min: 0, max: Number.MAX_SAFE_INTEGER }) ?? 20_260_921

  return {
    baseUrl: readFlagValue('base-url'),
    profilePath: readFlagValue('profile'),
    scenario: parseScenario(readFlagValue('scenario')),
    submit: process.argv.includes('--submit'),
    prompt: readFlagValue('prompt') || 'smoke test: a small red cube on a plain white background',
    referencePath: readFlagValue('reference'),
    timeoutSeconds,
    pollIntervalMs,
    seed,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(steps === undefined ? {} : { steps }),
    ...(duration === undefined ? {} : { duration }),
    ...(fps === undefined ? {} : { fps }),
    extraOptions: readObjectFlag('options-json'),
  }
}

function expectedMediaType(scenario: Scenario): ComfyUIMediaType {
  return scenario === 'text-to-video' || scenario === 'image-to-video' ? 'video' : 'image'
}

async function fetchJsonObject(url: string, label: string): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20_000) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`COMFYUI_${label.toUpperCase()}_REQUEST_FAILED: ${message}`)
  }

  const body = await response.text().catch(() => '')
  if (!response.ok) {
    throw new Error(`COMFYUI_${label.toUpperCase()}_REQUEST_FAILED: HTTP ${response.status} ${body.replace(/\s+/g, ' ').slice(0, 500)}`)
  }

  try {
    const parsed = JSON.parse(body) as unknown
    if (!isRecord(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw new Error(`COMFYUI_${label.toUpperCase()}_RESPONSE_INVALID`)
  }
}

async function readProfile(profilePath: string, scenario: Scenario): Promise<ComfyUIProfile> {
  const resolvedPath = path.resolve(process.cwd(), profilePath)
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(resolvedPath, 'utf8')) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`COMFYUI_PROFILE_READ_FAILED: ${resolvedPath}: ${message}`)
  }

  const validation = validateComfyUIProfile(raw, { expectedMediaType: expectedMediaType(scenario) })
  if (!validation.ok) {
    throw new Error(`${validation.code}: ${validation.message}`)
  }
  return validation.profile
}

function getDeclaredInputNames(rawNodeInfo: unknown): Set<string> {
  if (!isRecord(rawNodeInfo) || !isRecord(rawNodeInfo.input)) return new Set()

  const names = new Set<string>()
  for (const group of Object.values(rawNodeInfo.input)) {
    if (!isRecord(group)) continue
    for (const name of Object.keys(group)) names.add(name)
  }
  return names
}

function validateProfileAgainstObjectInfo(profile: ComfyUIProfile, objectInfo: ObjectInfo): void {
  const missingClasses = new Set<string>()
  const unknownInputs: string[] = []

  for (const [nodeId, node] of Object.entries(profile.workflow)) {
    if (!isRecord(objectInfo[node.class_type])) {
      missingClasses.add(`${nodeId}:${node.class_type}`)
    }
  }

  for (const [source, mapping] of Object.entries(profile.inputMappings)) {
    const node = profile.workflow[mapping.nodeId]
    if (!node || !isRecord(objectInfo[node.class_type])) continue
    const inputNames = getDeclaredInputNames(objectInfo[node.class_type])
    if (inputNames.size > 0 && !inputNames.has(mapping.inputName)) {
      unknownInputs.push(`${source} -> ${mapping.nodeId}.${mapping.inputName} (${node.class_type})`)
    }
  }

  if (missingClasses.size > 0 || unknownInputs.length > 0) {
    const details = [
      ...(missingClasses.size > 0 ? [`missing classes: ${[...missingClasses].join(', ')}`] : []),
      ...(unknownInputs.length > 0 ? [`unknown mapped inputs: ${unknownInputs.join(', ')}`] : []),
    ]
    throw new Error(`COMFYUI_PROFILE_OBJECT_INFO_MISMATCH: ${details.join('; ')}`)
  }
}

function buildMappedOptions(options: CliOptions): Record<string, unknown> {
  return {
    ...options.extraOptions,
    seed: options.seed,
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.height === undefined ? {} : { height: options.height }),
    ...(options.steps === undefined ? {} : { steps: options.steps }),
    ...(options.duration === undefined ? {} : { duration: options.duration }),
    ...(options.fps === undefined ? {} : { fps: options.fps }),
  }
}

function extensionToMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  const mimeTypeByExtension: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  const mimeType = mimeTypeByExtension[extension]
  if (!mimeType) {
    throw new Error('COMFYUI_REFERENCE_IMAGE_TYPE_UNSUPPORTED: use png, jpg, jpeg, webp, or gif')
  }
  return mimeType
}

async function readReferenceAsDataUrl(referencePath: string): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), referencePath)
  const mimeType = extensionToMimeType(resolvedPath)
  const bytes = await readFile(resolvedPath)
  if (bytes.byteLength === 0) {
    throw new Error(`COMFYUI_REFERENCE_IMAGE_EMPTY: ${resolvedPath}`)
  }
  if (bytes.byteLength > 50 * 1024 * 1024) {
    throw new Error(`COMFYUI_REFERENCE_IMAGE_TOO_LARGE: ${resolvedPath}`)
  }
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function detectOutputType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'image/gif'
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  if (bytes.length >= 4
    && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm'
  }
  if (bytes.length >= 8
    && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'video/mp4'
  }
  return null
}

function isExpectedOutput(mediaType: ComfyUIMediaType, contentType: string | null, detectedType: string | null): boolean {
  const normalizedContentType = contentType?.split(';')[0]?.trim().toLowerCase() || null
  const types = [normalizedContentType, detectedType].filter((value): value is string => !!value)
  if (mediaType === 'image') return types.some((value) => value.startsWith('image/'))
  return types.some((value) => value.startsWith('video/') || value === 'image/gif' || value === 'image/webp')
}

async function downloadAndValidateOutput(input: {
  viewUrl: string
  mediaType: ComfyUIMediaType
}): Promise<DownloadedOutput> {
  let response: Response
  try {
    response = await fetch(input.viewUrl, { method: 'GET', signal: AbortSignal.timeout(60_000) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`COMFYUI_VIEW_REQUEST_FAILED: ${message}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`COMFYUI_VIEW_REQUEST_FAILED: HTTP ${response.status} ${body.replace(/\s+/g, ' ').slice(0, 500)}`)
  }

  const contentLength = Number(response.headers.get('content-length'))
  const maximumBytes = 256 * 1024 * 1024
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error(`COMFYUI_VIEW_OUTPUT_TOO_LARGE: ${contentLength} bytes`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new Error('COMFYUI_VIEW_OUTPUT_EMPTY')
  }
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`COMFYUI_VIEW_OUTPUT_TOO_LARGE: ${bytes.byteLength} bytes`)
  }

  const contentType = response.headers.get('content-type')
  const detectedType = detectOutputType(bytes)
  if (!isExpectedOutput(input.mediaType, contentType, detectedType)) {
    throw new Error(`COMFYUI_VIEW_OUTPUT_TYPE_INVALID: content-type=${contentType || 'none'} detected=${detectedType || 'unknown'}`)
  }
  return { bytes: bytes.byteLength, contentType, detectedType }
}

async function waitForOutput(input: {
  baseUrl: string
  promptId: string
  outputNodeId: string
  mediaType: ComfyUIMediaType
  timeoutSeconds: number
  pollIntervalMs: number
}): Promise<{ viewUrl: string; polls: number }> {
  const deadline = Date.now() + input.timeoutSeconds * 1_000
  let polls = 0
  let lastProgressLogAt = 0

  while (Date.now() < deadline) {
    polls += 1
    const history = await getComfyUIHistory(input.baseUrl, input.promptId)
    const result = resolveComfyUIHistoryResult({
      history,
      promptId: input.promptId,
      outputNodeId: input.outputNodeId,
      mediaType: input.mediaType,
    })

    if (result.status === 'completed') {
      return {
        viewUrl: buildComfyUIViewUrl(input.baseUrl, result.file),
        polls,
      }
    }
    if (result.status === 'failed') {
      throw new Error(`COMFYUI_TASK_FAILED: prompt_id=${input.promptId}: ${result.error}`)
    }

    const now = Date.now()
    if (now - lastProgressLogAt >= 10_000) {
      process.stdout.write(`[smoke] task pending prompt_id=${input.promptId} polls=${polls}\n`)
      lastProgressLogAt = now
    }
    await new Promise<void>((resolve) => setTimeout(resolve, input.pollIntervalMs))
  }

  throw new SmokeTestTimeoutError(input.promptId, input.timeoutSeconds)
}

function printMappedInputSummary(profile: ComfyUIProfile, options: CliOptions): void {
  const mappedSources = Object.keys(profile.inputMappings).sort()
  const requestedSources = [
    'prompt',
    'seed',
    ...(options.width === undefined ? [] : ['width']),
    ...(options.height === undefined ? [] : ['height']),
    ...(options.steps === undefined ? [] : ['options.steps']),
    ...(options.duration === undefined ? [] : ['options.duration']),
    ...(options.fps === undefined ? [] : ['options.fps']),
    ...Object.keys(options.extraOptions).map((key) => `options.${key}`),
  ]
  const notMapped = requestedSources.filter((source) => !profile.inputMappings[source])
  process.stdout.write(`[smoke] profile mediaType=${profile.mediaType} nodes=${Object.keys(profile.workflow).length} mapped_inputs=${mappedSources.join(', ')}\n`)
  if (notMapped.length > 0) {
    process.stdout.write(`[smoke] warning requested inputs not mapped and therefore not injected: ${notMapped.join(', ')}\n`)
  }
}

async function main(): Promise<void> {
  const options = parseOptions()
  if (!options) return
  if (!options.baseUrl) {
    throw new Error('INVALID_ARGUMENT: --base-url is required; use --help for usage')
  }

  const baseUrl = normalizeComfyUIBaseUrl(options.baseUrl)
  process.stdout.write(`[smoke] target=${baseUrl} mode=${options.submit ? 'submit' : 'preflight'} scenario=${options.scenario}\n`)

  const [systemStats, objectInfo] = await Promise.all([
    fetchJsonObject(buildComfyUIEndpoint(baseUrl, '/system_stats'), 'system_stats'),
    fetchJsonObject(buildComfyUIEndpoint(baseUrl, '/object_info'), 'object_info'),
  ])
  process.stdout.write(`[smoke] preflight passed system_stats_keys=${Object.keys(systemStats).length} object_info_nodes=${Object.keys(objectInfo).length}\n`)

  let profile: ComfyUIProfile | null = null
  if (options.profilePath) {
    profile = await readProfile(options.profilePath, options.scenario)
    validateProfileAgainstObjectInfo(profile, objectInfo)
    printMappedInputSummary(profile, options)
    process.stdout.write('[smoke] profile and remote node registry are compatible\n')
  } else {
    process.stdout.write('[smoke] profile check skipped: --profile was not provided\n')
  }

  if (!options.submit) {
    process.stdout.write('[smoke] preflight completed; no task was submitted\n')
    return
  }
  if (!profile) {
    throw new Error('INVALID_ARGUMENT: --submit requires --profile')
  }

  const requiresReference = options.scenario === 'image-to-image' || options.scenario === 'image-to-video'
  if (requiresReference && !options.referencePath) {
    throw new Error(`INVALID_ARGUMENT: --scenario=${options.scenario} requires --reference=<local image path>`)
  }
  if (options.scenario === 'text-to-image' && profile.inputMappings.image?.required) {
    throw new Error('COMFYUI_REFERENCE_IMAGE_REQUIRED: the selected text-to-image Profile requires an image mapping')
  }
  if (options.scenario === 'image-to-image' && !profile.inputMappings.image) {
    throw new Error('COMFYUI_IMAGE_MAPPING_REQUIRED: the selected image-to-image Profile does not map image')
  }
  if (options.scenario === 'text-to-video' && profile.inputMappings.image) {
    throw new Error('COMFYUI_TEXT_TO_VIDEO_IMAGE_MAPPING_UNSUPPORTED: the selected text-to-video Profile maps image')
  }

  const referenceDataUrl = options.referencePath
    ? await readReferenceAsDataUrl(options.referencePath)
    : undefined
  const generated = options.scenario === 'image-to-video'
    ? await generateComfyUIVideo({
      baseUrl,
      providerId: `comfyui-smoke-${randomUUID()}`,
      profile,
      imageUrl: referenceDataUrl!,
      prompt: options.prompt,
      options: buildMappedOptions(options),
    })
    : options.scenario === 'text-to-video'
      ? await generateComfyUITextToVideo({
        baseUrl,
        providerId: `comfyui-smoke-${randomUUID()}`,
        profile,
        prompt: options.prompt,
        options: buildMappedOptions(options),
      })
    : await generateComfyUIImage({
      baseUrl,
      providerId: `comfyui-smoke-${randomUUID()}`,
      profile,
      prompt: options.prompt,
      ...(referenceDataUrl ? { referenceImages: [referenceDataUrl] } : {}),
      options: buildMappedOptions(options),
    })

  if (!generated.success || !generated.externalId || !generated.requestId) {
    throw new Error(`COMFYUI_SUBMISSION_RESULT_INVALID: ${generated.error || 'missing externalId or requestId'}`)
  }

  const externalId = parseComfyUIExternalId(generated.externalId)
  if (externalId.promptId !== generated.requestId) {
    throw new Error('COMFYUI_SUBMISSION_RESULT_INVALID: requestId does not match externalId promptId')
  }
  process.stdout.write(`[smoke] task submitted prompt_id=${externalId.promptId} output_node=${externalId.outputNodeId}\n`)

  const output = await waitForOutput({
    baseUrl,
    promptId: externalId.promptId,
    outputNodeId: externalId.outputNodeId,
    mediaType: profile.mediaType,
    timeoutSeconds: options.timeoutSeconds,
    pollIntervalMs: options.pollIntervalMs,
  })
  process.stdout.write(`[smoke] task completed polls=${output.polls} view_url=${output.viewUrl}\n`)

  const downloaded = await downloadAndValidateOutput({
    viewUrl: output.viewUrl,
    mediaType: profile.mediaType,
  })
  process.stdout.write(`[smoke] output download passed bytes=${downloaded.bytes} content_type=${downloaded.contentType || 'none'} detected_type=${downloaded.detectedType || 'unknown'}\n`)
  process.stdout.write('[smoke] real task smoke test passed\n')
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[smoke] failed: ${message}\n`)
  if (error instanceof ComfyUISubmissionUnknownError) {
    process.stderr.write('[smoke] submission result is unknown; do not rerun automatically. Check the ComfyUI queue/history before deciding whether to submit again.\n')
    process.exitCode = 3
    return
  }
  if (error instanceof SmokeTestTimeoutError) {
    process.stderr.write('[smoke] the task may still be running; do not rerun automatically. Check the reported prompt_id in ComfyUI history.\n')
    process.exitCode = 2
    return
  }
  process.exitCode = 1
})

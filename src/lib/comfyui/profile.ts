/**
 * ComfyUI 工作流 Profile 契约。
 *
 * ComfyUI 的 API 只接收「API 格式」工作流：以节点 ID 为 key，节点包含
 * class_type 和 inputs。Profile 只保存可配置的输入映射；运行时不会修改
 * 保存的工作流模板，而是深拷贝后按映射注入请求参数。
 */

export const COMFYUI_PROFILE_VERSION = 1
export const MAX_COMFYUI_PROFILE_BYTES = 48 * 1024

export type ComfyUIMediaType = 'image' | 'video'

export interface ComfyUIWorkflowNode {
  class_type: string
  inputs: Record<string, unknown>
  [key: string]: unknown
}

export interface ComfyUIInputMapping {
  nodeId: string
  inputName: string
  required?: boolean
}

/**
 * 映射 key 支持：
 * - prompt / seed / width / height / image
 * - options.<key>，用于 steps、cfg、negativePrompt 等工作流专有输入
 *
 * 视频 Profile 是否映射 image 决定其输入模式：有 image 映射为图生视频，
 * 无 image 映射为文生视频。
 */
export type ComfyUIInputMappings = Record<string, ComfyUIInputMapping>

export interface ComfyUIProfile {
  version: typeof COMFYUI_PROFILE_VERSION
  mediaType: ComfyUIMediaType
  workflow: Record<string, ComfyUIWorkflowNode>
  inputMappings: ComfyUIInputMappings
  outputNodeId: string
}

export type ComfyUIProfileValidationResult =
  | { ok: true; profile: ComfyUIProfile }
  | { ok: false; code: string; message: string }

export class ComfyUIProfileInputError extends Error {
  readonly code = 'COMFYUI_PROFILE_INPUT_MISSING'

  constructor(source: string) {
    super(`COMFYUI_PROFILE_INPUT_MISSING: ${source}`)
    this.name = 'ComfyUIProfileInputError'
  }
}

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const DIRECT_INPUT_SOURCES = new Set(['prompt', 'seed', 'width', 'height', 'image'])
const OPTION_SOURCE_PATTERN = /^options\.[A-Za-z_][A-Za-z0-9_-]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isSafeObjectKey(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !RESERVED_OBJECT_KEYS.has(value)
}

function fail(code: string, message: string): ComfyUIProfileValidationResult {
  return { ok: false, code, message }
}

function getJsonByteLength(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return null
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isSupportedInputSource(source: string): boolean {
  return DIRECT_INPUT_SOURCES.has(source) || OPTION_SOURCE_PATTERN.test(source)
}

/**
 * 校验并标准化 ComfyUI Profile。该函数不依赖 Node API，可同时用于服务端
 * 保存校验和浏览器端表单预校验。
 */
export function validateComfyUIProfile(
  raw: unknown,
  options?: { expectedMediaType?: ComfyUIMediaType },
): ComfyUIProfileValidationResult {
  if (!isRecord(raw)) {
    return fail('COMFYUI_PROFILE_INVALID', 'ComfyUI profile must be an object')
  }

  const byteLength = getJsonByteLength(raw)
  if (byteLength === null) {
    return fail('COMFYUI_PROFILE_INVALID', 'ComfyUI profile must be JSON serializable')
  }
  if (byteLength > MAX_COMFYUI_PROFILE_BYTES) {
    return fail(
      'COMFYUI_PROFILE_TOO_LARGE',
      `ComfyUI profile must not exceed ${MAX_COMFYUI_PROFILE_BYTES} bytes`,
    )
  }

  if (raw.version !== COMFYUI_PROFILE_VERSION) {
    return fail('COMFYUI_PROFILE_VERSION_INVALID', `ComfyUI profile version must be ${COMFYUI_PROFILE_VERSION}`)
  }

  const mediaType = raw.mediaType
  if (mediaType !== 'image' && mediaType !== 'video') {
    return fail('COMFYUI_PROFILE_MEDIA_TYPE_INVALID', 'ComfyUI profile mediaType must be image or video')
  }
  if (options?.expectedMediaType && mediaType !== options.expectedMediaType) {
    return fail(
      'COMFYUI_PROFILE_MEDIA_TYPE_MISMATCH',
      `ComfyUI profile mediaType must be ${options.expectedMediaType}`,
    )
  }

  if (!isRecord(raw.workflow)) {
    return fail('COMFYUI_PROFILE_WORKFLOW_INVALID', 'ComfyUI profile workflow must be an API workflow object')
  }
  const workflowEntries = Object.entries(raw.workflow)
  if (workflowEntries.length === 0) {
    return fail('COMFYUI_PROFILE_WORKFLOW_EMPTY', 'ComfyUI profile workflow must include at least one node')
  }
  if (workflowEntries.length > 500) {
    return fail('COMFYUI_PROFILE_WORKFLOW_TOO_LARGE', 'ComfyUI profile workflow has too many nodes')
  }

  for (const [nodeId, rawNode] of workflowEntries) {
    if (!isSafeObjectKey(nodeId)) {
      return fail('COMFYUI_PROFILE_NODE_ID_INVALID', `Invalid workflow node id: ${nodeId}`)
    }
    if (!isRecord(rawNode)) {
      return fail('COMFYUI_PROFILE_NODE_INVALID', `Workflow node ${nodeId} must be an object`)
    }
    if (!readTrimmedString(rawNode.class_type)) {
      return fail('COMFYUI_PROFILE_NODE_CLASS_INVALID', `Workflow node ${nodeId} is missing class_type`)
    }
    if (!isRecord(rawNode.inputs)) {
      return fail('COMFYUI_PROFILE_NODE_INPUTS_INVALID', `Workflow node ${nodeId} is missing inputs`)
    }
  }

  const outputNodeId = readTrimmedString(raw.outputNodeId)
  if (!isSafeObjectKey(outputNodeId) || !Object.prototype.hasOwnProperty.call(raw.workflow, outputNodeId)) {
    return fail('COMFYUI_PROFILE_OUTPUT_NODE_INVALID', 'ComfyUI profile outputNodeId must reference a workflow node')
  }

  if (!isRecord(raw.inputMappings)) {
    return fail('COMFYUI_PROFILE_INPUT_MAPPINGS_INVALID', 'ComfyUI profile inputMappings must be an object')
  }
  const mappingEntries = Object.entries(raw.inputMappings)
  if (mappingEntries.length === 0) {
    return fail('COMFYUI_PROFILE_INPUT_MAPPINGS_EMPTY', 'ComfyUI profile must map at least prompt')
  }

  const inputMappings: ComfyUIInputMappings = {}
  const targets = new Set<string>()
  for (const [source, rawMapping] of mappingEntries) {
    if (!isSupportedInputSource(source)) {
      return fail('COMFYUI_PROFILE_INPUT_SOURCE_INVALID', `Unsupported ComfyUI input mapping source: ${source}`)
    }
    if (!isRecord(rawMapping)) {
      return fail('COMFYUI_PROFILE_INPUT_MAPPING_INVALID', `Input mapping ${source} must be an object`)
    }

    const nodeId = readTrimmedString(rawMapping.nodeId)
    const inputName = readTrimmedString(rawMapping.inputName)
    if (!isSafeObjectKey(nodeId) || !Object.prototype.hasOwnProperty.call(raw.workflow, nodeId)) {
      return fail('COMFYUI_PROFILE_INPUT_NODE_INVALID', `Input mapping ${source} references an unknown node`)
    }
    if (!isSafeObjectKey(inputName)) {
      return fail('COMFYUI_PROFILE_INPUT_NAME_INVALID', `Input mapping ${source} has an invalid inputName`)
    }
    if (rawMapping.required !== undefined && typeof rawMapping.required !== 'boolean') {
      return fail('COMFYUI_PROFILE_INPUT_REQUIRED_INVALID', `Input mapping ${source}.required must be boolean`)
    }

    const target = `${nodeId}\u0000${inputName}`
    if (targets.has(target)) {
      return fail('COMFYUI_PROFILE_INPUT_TARGET_DUPLICATE', `Multiple mappings target ${nodeId}.${inputName}`)
    }
    targets.add(target)
    inputMappings[source] = {
      nodeId,
      inputName,
      ...(rawMapping.required === true ? { required: true } : {}),
    }
  }

  if (!inputMappings.prompt) {
    return fail('COMFYUI_PROFILE_PROMPT_MAPPING_REQUIRED', 'ComfyUI profile must map prompt')
  }

  try {
    return {
      ok: true,
      profile: {
        version: COMFYUI_PROFILE_VERSION,
        mediaType,
        workflow: cloneJson(raw.workflow) as Record<string, ComfyUIWorkflowNode>,
        inputMappings,
        outputNodeId,
      },
    }
  } catch {
    return fail('COMFYUI_PROFILE_INVALID', 'ComfyUI profile must be JSON serializable')
  }
}

/**
 * 以深拷贝的 API 工作流为基础，写入本次任务的已映射输入。
 */
export function patchComfyUIWorkflow(
  profile: ComfyUIProfile,
  values: Record<string, unknown>,
): Record<string, ComfyUIWorkflowNode> {
  const workflow = cloneJson(profile.workflow)

  for (const [source, mapping] of Object.entries(profile.inputMappings)) {
    const value = values[source]
    if (value === undefined) {
      if (mapping.required) {
        throw new ComfyUIProfileInputError(source)
      }
      continue
    }

    const node = workflow[mapping.nodeId]
    if (!node || !isRecord(node.inputs)) {
      // Profile 已在保存时校验；这里保留防御式检查，避免历史脏数据写入错误节点。
      throw new Error(`COMFYUI_PROFILE_NODE_INVALID: ${mapping.nodeId}`)
    }
    node.inputs[mapping.inputName] = value
  }

  return workflow
}

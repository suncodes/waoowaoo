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
 * 一组同类输入的映射。
 *
 * ComfyUI 的部分自定义节点（例如 MiniMax H3 ReferenceToVideo）使用动态输入
 * 名称接收多个参考媒体。Profile 将目标节点、动态 key 前缀和每个上传节点显式
 * 固定下来，避免运行时按节点名称猜测工作流结构。
 */
export interface ComfyUICollectionInputMapping {
  type: 'collection'
  nodeId: string
  inputName: string
  itemPrefix: string
  itemMappings: ComfyUIInputMapping[]
  /** 集合是否至少需要一项。 */
  required?: boolean
}

/**
 * 映射 key 支持：
 * - prompt / seed / width / height / image / lastFrameImage
 * - referenceAudios（集合映射，仅用于节点明确支持多个参考音频的工作流）
 * - options.<key>，用于 steps、cfg、negativePrompt 等工作流专有输入
 *
 * 视频 Profile 是否映射 image 决定其输入模式：有 image 映射为图生视频，
 * 无 image 映射为文生视频。
 */
export type ComfyUIInputMappings = Record<
  string,
  ComfyUIInputMapping | ComfyUICollectionInputMapping
>

export interface ComfyUIProfile {
  version: typeof COMFYUI_PROFILE_VERSION
  mediaType: ComfyUIMediaType
  workflow: Record<string, ComfyUIWorkflowNode>
  inputMappings: ComfyUIInputMappings
  outputNodeId: string
}

/**
 * 一个视频模型可按请求形态切换多个 API 工作流。
 *
 * 每个变体仍是完整、可独立执行的 Profile；不能在运行时拼接节点或
 * Conditioning。这样可以让一个模型配置同时覆盖文生视频、首尾帧和
 * 参考音频工作流，同时保持每个工作流的节点图可审计。
 */
export type ComfyUIVideoProfileVariant =
  | 't2v'
  | 'firstLastFrame'
  | 'referenceAudio'
  | 'firstLastReferenceAudio'

export interface ComfyUIProfileSet {
  version: typeof COMFYUI_PROFILE_VERSION
  mediaType: 'video'
  variants: Partial<Record<ComfyUIVideoProfileVariant, ComfyUIProfile>>
}

/** 兼容历史单 Profile，以及新的视频多工作流 Profile Set。 */
export type ComfyUIProfileDefinition = ComfyUIProfile | ComfyUIProfileSet

export type ComfyUIProfileValidationResult =
  | { ok: true; profile: ComfyUIProfile }
  | { ok: false; code: string; message: string }

export type ComfyUIProfileDefinitionValidationResult =
  | { ok: true; profile: ComfyUIProfileDefinition }
  | { ok: false; code: string; message: string }

type ComfyUIMappingValidationResult =
  | { ok: true; mapping: ComfyUIInputMapping }
  | { ok: false; code: string; message: string }

export class ComfyUIProfileInputError extends Error {
  readonly code = 'COMFYUI_PROFILE_INPUT_MISSING'

  constructor(source: string) {
    super(`COMFYUI_PROFILE_INPUT_MISSING: ${source}`)
    this.name = 'ComfyUIProfileInputError'
  }
}

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const DIRECT_INPUT_SOURCES = new Set([
  'prompt',
  'seed',
  'width',
  'height',
  'image',
  'lastFrameImage',
])
const COLLECTION_INPUT_SOURCES = new Set(['referenceAudios'])
const OPTION_SOURCE_PATTERN = /^options\.[A-Za-z_][A-Za-z0-9_-]*$/
const COLLECTION_ITEM_PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/
const MAX_REFERENCE_AUDIO_MAPPINGS = 3

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

function definitionFail(code: string, message: string): ComfyUIProfileDefinitionValidationResult {
  return { ok: false, code, message }
}

function mappingFail(code: string, message: string): ComfyUIMappingValidationResult {
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
  return DIRECT_INPUT_SOURCES.has(source)
    || COLLECTION_INPUT_SOURCES.has(source)
    || OPTION_SOURCE_PATTERN.test(source)
}

export function isComfyUICollectionInputMapping(
  value: ComfyUIInputMapping | ComfyUICollectionInputMapping | undefined,
): value is ComfyUICollectionInputMapping {
  return !!value
    && 'type' in value
    && value.type === 'collection'
}

export function getComfyUIScalarInputMapping(
  profile: ComfyUIProfile,
  source: string,
): ComfyUIInputMapping | undefined {
  const mapping = profile.inputMappings[source]
  return mapping && !isComfyUICollectionInputMapping(mapping) ? mapping : undefined
}

function validateMappingTarget(input: {
  rawMapping: Record<string, unknown>
  source: string
  workflow: Record<string, unknown>
  targets: Set<string>
}): ComfyUIMappingValidationResult {
  const nodeId = readTrimmedString(input.rawMapping.nodeId)
  const inputName = readTrimmedString(input.rawMapping.inputName)
  if (!isSafeObjectKey(nodeId) || !Object.prototype.hasOwnProperty.call(input.workflow, nodeId)) {
    return mappingFail('COMFYUI_PROFILE_INPUT_NODE_INVALID', `Input mapping ${input.source} references an unknown node`)
  }
  if (!isSafeObjectKey(inputName)) {
    return mappingFail('COMFYUI_PROFILE_INPUT_NAME_INVALID', `Input mapping ${input.source} has an invalid inputName`)
  }
  if (input.rawMapping.required !== undefined && typeof input.rawMapping.required !== 'boolean') {
    return mappingFail('COMFYUI_PROFILE_INPUT_REQUIRED_INVALID', `Input mapping ${input.source}.required must be boolean`)
  }

  const target = `${nodeId}\u0000${inputName}`
  if (input.targets.has(target)) {
    return mappingFail('COMFYUI_PROFILE_INPUT_TARGET_DUPLICATE', `Multiple mappings target ${nodeId}.${inputName}`)
  }
  input.targets.add(target)
  return {
    ok: true,
    mapping: {
      nodeId,
      inputName,
      ...(input.rawMapping.required === true ? { required: true } : {}),
    },
  }
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

    if (COLLECTION_INPUT_SOURCES.has(source)) {
      if (rawMapping.type !== 'collection') {
        return fail('COMFYUI_PROFILE_COLLECTION_TYPE_INVALID', `Input mapping ${source} must use type=collection`)
      }
      const targetResult = validateMappingTarget({
        rawMapping,
        source,
        workflow: raw.workflow,
        targets,
      })
      if (!targetResult.ok) return targetResult

      const itemPrefix = readTrimmedString(rawMapping.itemPrefix)
      if (!COLLECTION_ITEM_PREFIX_PATTERN.test(itemPrefix)) {
        return fail('COMFYUI_PROFILE_COLLECTION_PREFIX_INVALID', `Input mapping ${source} has an invalid itemPrefix`)
      }
      if (!Array.isArray(rawMapping.itemMappings)
        || rawMapping.itemMappings.length === 0
        || rawMapping.itemMappings.length > MAX_REFERENCE_AUDIO_MAPPINGS) {
        return fail(
          'COMFYUI_PROFILE_COLLECTION_ITEMS_INVALID',
          `Input mapping ${source} must declare 1-${MAX_REFERENCE_AUDIO_MAPPINGS} itemMappings`,
        )
      }

      const itemMappings: ComfyUIInputMapping[] = []
      for (let index = 0; index < rawMapping.itemMappings.length; index += 1) {
        const rawItemMapping = rawMapping.itemMappings[index]
        if (!isRecord(rawItemMapping)) {
          return fail('COMFYUI_PROFILE_COLLECTION_ITEM_INVALID', `Input mapping ${source}.itemMappings[${index}] must be an object`)
        }
        if (rawItemMapping.required !== undefined) {
          return fail('COMFYUI_PROFILE_COLLECTION_ITEM_REQUIRED_UNSUPPORTED', `Input mapping ${source}.itemMappings[${index}] must not declare required`)
        }
        const itemResult = validateMappingTarget({
          rawMapping: rawItemMapping,
          source: `${source}.itemMappings[${index}]`,
          workflow: raw.workflow,
          targets,
        })
        if (!itemResult.ok) return itemResult
        itemMappings.push({
          nodeId: itemResult.mapping.nodeId,
          inputName: itemResult.mapping.inputName,
        })
      }

      inputMappings[source] = {
        type: 'collection',
        nodeId: targetResult.mapping.nodeId,
        inputName: targetResult.mapping.inputName,
        itemPrefix,
        itemMappings,
        ...(targetResult.mapping.required ? { required: true } : {}),
      }
      continue
    }

    if (rawMapping.type !== undefined) {
      return fail('COMFYUI_PROFILE_INPUT_TYPE_INVALID', `Input mapping ${source} must be a scalar mapping`)
    }
    const targetResult = validateMappingTarget({
      rawMapping,
      source,
      workflow: raw.workflow,
      targets,
    })
    if (!targetResult.ok) return targetResult
    inputMappings[source] = targetResult.mapping
  }

  const promptMapping = inputMappings.prompt
  if (!promptMapping || isComfyUICollectionInputMapping(promptMapping)) {
    return fail('COMFYUI_PROFILE_PROMPT_MAPPING_REQUIRED', 'ComfyUI profile must map prompt')
  }
  const imageMapping = inputMappings.image
  const lastFrameImageMapping = inputMappings.lastFrameImage
  const referenceAudioMapping = inputMappings.referenceAudios
  if (mediaType !== 'video' && (lastFrameImageMapping || referenceAudioMapping)) {
    return fail('COMFYUI_PROFILE_VIDEO_INPUT_UNSUPPORTED', 'lastFrameImage and referenceAudios mappings require a video profile')
  }
  if (lastFrameImageMapping && (!imageMapping || isComfyUICollectionInputMapping(imageMapping))) {
    return fail('COMFYUI_PROFILE_LAST_FRAME_IMAGE_REQUIRES_IMAGE', 'lastFrameImage mapping requires an image mapping')
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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function validateVideoProfileVariant(
  variant: ComfyUIVideoProfileVariant,
  profile: ComfyUIProfile,
): ComfyUIProfileDefinitionValidationResult | null {
  const imageMapping = getComfyUIScalarInputMapping(profile, 'image')
  const lastFrameMapping = getComfyUIScalarInputMapping(profile, 'lastFrameImage')
  const referenceAudioMapping = profile.inputMappings.referenceAudios
  const hasReferenceAudioMapping = isComfyUICollectionInputMapping(referenceAudioMapping)

  if (variant === 't2v') {
    if (imageMapping || lastFrameMapping || hasReferenceAudioMapping) {
      return definitionFail(
        'COMFYUI_PROFILE_SET_T2V_INVALID',
        'ComfyUI Profile Set variant t2v must not map image, lastFrameImage, or referenceAudios',
      )
    }
    return null
  }

  if (variant === 'firstLastFrame') {
    if (!imageMapping || !lastFrameMapping) {
      return definitionFail(
        'COMFYUI_PROFILE_SET_FIRSTLAST_INVALID',
        'ComfyUI Profile Set variant firstLastFrame must map image and lastFrameImage',
      )
    }
    if (hasReferenceAudioMapping) {
      return definitionFail(
        'COMFYUI_PROFILE_SET_FIRSTLAST_AUDIO_INVALID',
        'ComfyUI Profile Set variant firstLastFrame must not map referenceAudios; use firstLastReferenceAudio instead',
      )
    }
    return null
  }

  if (variant === 'referenceAudio') {
    if (!hasReferenceAudioMapping) {
      return definitionFail(
        'COMFYUI_PROFILE_SET_REFERENCE_AUDIO_INVALID',
        'ComfyUI Profile Set variant referenceAudio must map referenceAudios',
      )
    }
    if (lastFrameMapping) {
      return definitionFail(
        'COMFYUI_PROFILE_SET_REFERENCE_AUDIO_FIRSTLAST_INVALID',
        'ComfyUI Profile Set variant referenceAudio must not map lastFrameImage; use firstLastReferenceAudio instead',
      )
    }
    return null
  }

  if (!imageMapping || !lastFrameMapping || !hasReferenceAudioMapping) {
    return definitionFail(
      'COMFYUI_PROFILE_SET_FIRSTLAST_REFERENCE_AUDIO_INVALID',
      'ComfyUI Profile Set variant firstLastReferenceAudio must map image, lastFrameImage, and referenceAudios',
    )
  }
  return null
}

/** 判断已校验定义是否是视频多工作流 Profile Set。 */
export function isComfyUIProfileSet(value: unknown): value is ComfyUIProfileSet {
  return isRecord(value)
    && hasOwn(value, 'variants')
    && !hasOwn(value, 'workflow')
}

export function getComfyUIProfileSetVariant(
  profile: ComfyUIProfileSet,
  variant: ComfyUIVideoProfileVariant,
): ComfyUIProfile | undefined {
  return profile.variants[variant]
}

/**
 * 校验模型配置中保存的 Profile 定义。
 *
 * 单 Profile 保持历史格式不变；只要顶层出现 variants，就按 Profile Set
 * 处理。Profile Set 目前仅服务视频模型，避免在图像工作流中引入没有明确
 * 路由语义的变体。
 */
export function validateComfyUIProfileDefinition(
  raw: unknown,
  options?: { expectedMediaType?: ComfyUIMediaType },
): ComfyUIProfileDefinitionValidationResult {
  if (!isRecord(raw) || !hasOwn(raw, 'variants')) {
    const validated = validateComfyUIProfile(raw, options)
    return validated.ok
      ? { ok: true, profile: validated.profile }
      : validated
  }

  const byteLength = getJsonByteLength(raw)
  if (byteLength === null) {
    return definitionFail('COMFYUI_PROFILE_INVALID', 'ComfyUI profile must be JSON serializable')
  }
  if (byteLength > MAX_COMFYUI_PROFILE_BYTES) {
    return definitionFail(
      'COMFYUI_PROFILE_TOO_LARGE',
      `ComfyUI profile must not exceed ${MAX_COMFYUI_PROFILE_BYTES} bytes`,
    )
  }
  if (raw.version !== COMFYUI_PROFILE_VERSION) {
    return definitionFail('COMFYUI_PROFILE_VERSION_INVALID', `ComfyUI profile version must be ${COMFYUI_PROFILE_VERSION}`)
  }
  if (raw.mediaType !== 'video') {
    return definitionFail('COMFYUI_PROFILE_SET_MEDIA_TYPE_INVALID', 'ComfyUI Profile Set mediaType must be video')
  }
  if (options?.expectedMediaType && options.expectedMediaType !== 'video') {
    return definitionFail(
      'COMFYUI_PROFILE_MEDIA_TYPE_MISMATCH',
      `ComfyUI profile mediaType must be ${options.expectedMediaType}`,
    )
  }
  if (!isRecord(raw.variants)) {
    return definitionFail('COMFYUI_PROFILE_SET_VARIANTS_INVALID', 'ComfyUI Profile Set variants must be an object')
  }

  const variantEntries = Object.entries(raw.variants)
  if (variantEntries.length === 0) {
    return definitionFail('COMFYUI_PROFILE_SET_VARIANTS_EMPTY', 'ComfyUI Profile Set must include at least one variant')
  }

  const allowedVariants = new Set<ComfyUIVideoProfileVariant>([
    't2v',
    'firstLastFrame',
    'referenceAudio',
    'firstLastReferenceAudio',
  ])
  const variants: Partial<Record<ComfyUIVideoProfileVariant, ComfyUIProfile>> = {}
  for (const [variantKey, rawVariant] of variantEntries) {
    if (!allowedVariants.has(variantKey as ComfyUIVideoProfileVariant)) {
      return definitionFail(
        'COMFYUI_PROFILE_SET_VARIANT_UNSUPPORTED',
        `Unsupported ComfyUI Profile Set variant: ${variantKey}`,
      )
    }
    const variant = variantKey as ComfyUIVideoProfileVariant
    const validated = validateComfyUIProfile(rawVariant, { expectedMediaType: 'video' })
    if (!validated.ok) {
      return definitionFail(
        'COMFYUI_PROFILE_SET_VARIANT_INVALID',
        `ComfyUI Profile Set variant ${variant} is invalid: ${validated.message}`,
      )
    }
    const contractError = validateVideoProfileVariant(variant, validated.profile)
    if (contractError) return contractError
    variants[variant] = validated.profile
  }

  return {
    ok: true,
    profile: {
      version: COMFYUI_PROFILE_VERSION,
      mediaType: 'video',
      variants,
    },
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
    if (isComfyUICollectionInputMapping(mapping)) {
      const node = workflow[mapping.nodeId]
      if (!node || !isRecord(node.inputs)) {
        throw new Error(`COMFYUI_PROFILE_NODE_INVALID: ${mapping.nodeId}`)
      }

      // 清除模板中静态配置的动态输入；仅本次上传的项目可以参与执行。
      delete node.inputs[mapping.inputName]
      const value = values[source]
      if (value === undefined) {
        if (mapping.required) {
          throw new ComfyUIProfileInputError(source)
        }
        continue
      }
      if (!Array.isArray(value)) {
        throw new Error(`COMFYUI_PROFILE_COLLECTION_INPUT_INVALID: ${source}`)
      }
      if (value.length === 0 && mapping.required) {
        throw new ComfyUIProfileInputError(source)
      }
      if (value.length > mapping.itemMappings.length) {
        throw new Error(`COMFYUI_PROFILE_COLLECTION_INPUT_EXCEEDS_CAPACITY: ${source}`)
      }

      const links: Record<string, [string, number]> = {}
      for (let index = 0; index < value.length; index += 1) {
        const itemMapping = mapping.itemMappings[index]
        if (!itemMapping) {
          throw new Error(`COMFYUI_PROFILE_COLLECTION_INPUT_EXCEEDS_CAPACITY: ${source}`)
        }
        const itemNode = workflow[itemMapping.nodeId]
        if (!itemNode || !isRecord(itemNode.inputs)) {
          throw new Error(`COMFYUI_PROFILE_NODE_INVALID: ${itemMapping.nodeId}`)
        }
        itemNode.inputs[itemMapping.inputName] = value[index]
        links[`${mapping.itemPrefix}${index + 1}`] = [itemMapping.nodeId, 0]
      }
      if (Object.keys(links).length > 0) {
        node.inputs[mapping.inputName] = links
      }
      continue
    }

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

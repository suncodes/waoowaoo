import { prisma } from '@/lib/prisma'
import {
  appendRunEventWithSeq,
  createArtifact,
  createRun,
} from '@/lib/run-runtime/service'
import { RUN_EVENT_TYPE } from '@/lib/run-runtime/types'
import type { GenerationSnapshot } from './contracts'
import { isPanelImagePromptCurrent } from '@/lib/visual-production/panel-prepared-prompt-state'

export const PREPARED_PROMPT_ARTIFACT_TYPES = {
  asset_image: 'prompt.asset_image.prepared',
  panel_image: 'prompt.panel_image.prepared',
  panel_video: 'prompt.panel_video.prepared',
} as const

export type PreparedPromptKind = keyof typeof PREPARED_PROMPT_ARTIFACT_TYPES
export type PreparedPromptArtifactType = typeof PREPARED_PROMPT_ARTIFACT_TYPES[PreparedPromptKind]

type PromptGenerationOption = string | number | boolean
type JsonRecord = Record<string, unknown>

export interface PreparedGenerationPrompt {
  artifactId: string
  artifactType: PreparedPromptArtifactType
  runId: string
  kind: PreparedPromptKind
  refId: string
  targetType: GenerationSnapshot['targetType']
  targetId: string
  generationMode: string | null
  generationOptions: Record<string, PromptGenerationOption>
  snapshot: GenerationSnapshot
  preparedAt: string
}

export interface PreparedPromptLookup {
  kind: PreparedPromptKind
  targetId: string
  refId?: string | null
  generationMode?: string | null
}

export class PreparedPromptError extends Error {
  code: 'PREPARED_PROMPT_REQUIRED' | 'PREPARED_PROMPT_NOT_FOUND' | 'PREPARED_PROMPT_INVALID'

  constructor(code: PreparedPromptError['code'], message: string) {
    super(message)
    this.name = 'PreparedPromptError'
    this.code = code
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringOrNull(value: unknown): string | null {
  const normalized = readString(value)
  return normalized || null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const normalized = readString(item)
    return normalized ? [normalized] : []
  })
}

function readGenerationOptions(value: unknown): Record<string, PromptGenerationOption> {
  const result: Record<string, PromptGenerationOption> = {}
  for (const [key, option] of Object.entries(asRecord(value))) {
    if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
      result[key] = option
    }
  }
  return result
}

function artifactTypeForKind(kind: PreparedPromptKind): PreparedPromptArtifactType {
  return PREPARED_PROMPT_ARTIFACT_TYPES[kind]
}

function kindForArtifactType(value: string): PreparedPromptKind | null {
  if (value === PREPARED_PROMPT_ARTIFACT_TYPES.asset_image) return 'asset_image'
  if (value === PREPARED_PROMPT_ARTIFACT_TYPES.panel_image) return 'panel_image'
  if (value === PREPARED_PROMPT_ARTIFACT_TYPES.panel_video) return 'panel_video'
  return null
}

function snapshotTypeMatchesKind(snapshotType: string, kind: PreparedPromptKind) {
  if (kind === 'asset_image') return snapshotType === 'asset_image_prompt'
  if (kind === 'panel_image') return snapshotType === 'panel_image_prompt'
  return snapshotType === 'panel_video_prompt'
}

function normalizeSnapshot(value: unknown, kind: PreparedPromptKind): GenerationSnapshot | null {
  const record = asRecord(value)
  const snapshotType = readString(record.snapshotType)
  const targetType = readString(record.targetType)
  const targetId = readString(record.targetId)
  const modelKey = readString(record.modelKey)
  const promptTemplateId = readString(record.promptTemplateId)
  const promptHash = readString(record.promptHash)
  const specHash = readString(record.specHash)
  const inputHash = readString(record.inputHash)
  const compiledPrompt = readString(record.compiledPrompt)
  const createdAt = readString(record.createdAt)
  if (
    !snapshotTypeMatchesKind(snapshotType, kind)
    || !targetType
    || !targetId
    || !modelKey
    || !promptTemplateId
    || !promptHash
    || !specHash
    || !inputHash
    || !compiledPrompt
    || !createdAt
  ) {
    return null
  }

  return {
    schemaVersion: 1,
    snapshotType: snapshotType as GenerationSnapshot['snapshotType'],
    targetType: targetType as GenerationSnapshot['targetType'],
    targetId,
    modelKey,
    promptTemplateId,
    promptHash,
    specHash,
    inputHash,
    assetVersionHash: readStringOrNull(record.assetVersionHash),
    referenceImages: readStringArray(record.referenceImages),
    ...(record.structuredReferences !== undefined ? { structuredReferences: record.structuredReferences } : {}),
    ...(record.bindingPlan !== undefined ? { bindingPlan: record.bindingPlan } : {}),
    ...(readStringOrNull(record.preparationHash) ? { preparationHash: readStringOrNull(record.preparationHash)! } : {}),
    ...(record.optimization !== undefined ? { optimization: record.optimization as GenerationSnapshot['optimization'] } : {}),
    promptSpec: record.promptSpec ?? null,
    compiledPrompt,
    createdAt,
  }
}

function normalizePreparedPrompt(row: {
  id: string
  runId: string
  artifactType: string
  refId: string
  payload: unknown
  createdAt: Date | string
}): PreparedGenerationPrompt | null {
  const kind = kindForArtifactType(row.artifactType)
  if (!kind) return null
  const payload = asRecord(row.payload)
  const snapshot = normalizeSnapshot(payload, kind)
  if (!snapshot) return null
  const targetId = readString(payload.targetId) || snapshot.targetId
  const targetType = readString(payload.targetType) || snapshot.targetType
  const preparedAt = readString(payload.preparedAt)
    || (row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString())
  if (!targetId || !targetType) return null

  return {
    artifactId: row.id,
    artifactType: row.artifactType as PreparedPromptArtifactType,
    runId: row.runId,
    kind,
    refId: row.refId,
    targetType: targetType as GenerationSnapshot['targetType'],
    targetId,
    generationMode: readStringOrNull(payload.generationMode),
    generationOptions: readGenerationOptions(payload.generationOptions),
    snapshot,
    preparedAt,
  }
}

export async function persistPreparedPrompt(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  kind: PreparedPromptKind
  targetType: GenerationSnapshot['targetType']
  targetId: string
  refId?: string | null
  generationMode?: string | null
  generationOptions?: Record<string, PromptGenerationOption>
  snapshot: GenerationSnapshot
  metadata?: JsonRecord
}): Promise<PreparedGenerationPrompt> {
  const refId = params.refId?.trim() || params.targetId
  if (!refId || !params.targetId.trim()) {
    throw new PreparedPromptError('PREPARED_PROMPT_INVALID', 'Prepared prompt target is required')
  }
  const run = await createRun({
    userId: params.userId,
    projectId: params.projectId,
    episodeId: params.episodeId || null,
    workflowType: 'prompt_preparation',
    targetType: params.targetType,
    targetId: params.targetId,
    input: {
      kind: params.kind,
      targetType: params.targetType,
      targetId: params.targetId,
      refId,
    },
  })

  try {
    await appendRunEventWithSeq({
      runId: run.id,
      projectId: params.projectId,
      userId: params.userId,
      eventType: RUN_EVENT_TYPE.RUN_START,
      payload: { kind: params.kind },
    })
    const preparedAt = new Date().toISOString()
    const artifact = await createArtifact({
      runId: run.id,
      stepKey: 'prepare_generation_prompt',
      artifactType: artifactTypeForKind(params.kind),
      refId,
      versionHash: params.snapshot.promptHash,
      payload: {
        ...params.snapshot,
        preparationKind: params.kind,
        targetType: params.targetType,
        targetId: params.targetId,
        generationMode: params.generationMode || null,
        generationOptions: params.generationOptions || {},
        preparedAt,
        ...(params.metadata ? { metadata: params.metadata } : {}),
      },
    })
    await appendRunEventWithSeq({
      runId: run.id,
      projectId: params.projectId,
      userId: params.userId,
      eventType: RUN_EVENT_TYPE.RUN_COMPLETE,
      payload: {
        kind: params.kind,
        preparedPromptArtifactId: artifact.id,
        promptHash: params.snapshot.promptHash,
      },
    })
    const prepared = normalizePreparedPrompt({
      id: artifact.id,
      runId: artifact.runId,
      artifactType: artifact.artifactType,
      refId: artifact.refId,
      payload: {
        ...params.snapshot,
        preparationKind: params.kind,
        targetType: params.targetType,
        targetId: params.targetId,
        generationMode: params.generationMode || null,
        generationOptions: params.generationOptions || {},
        preparedAt,
      },
      createdAt: artifact.createdAt,
    })
    if (!prepared) {
      throw new PreparedPromptError('PREPARED_PROMPT_INVALID', 'Prepared prompt payload is invalid')
    }
    return prepared
  } catch (error) {
    await appendRunEventWithSeq({
      runId: run.id,
      projectId: params.projectId,
      userId: params.userId,
      eventType: RUN_EVENT_TYPE.RUN_ERROR,
      payload: {
        errorCode: error instanceof PreparedPromptError ? error.code : 'PROMPT_PREPARATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => undefined)
    throw error
  }
}

export async function getPreparedPromptByArtifactId(params: {
  artifactId: string
  projectId: string
  targetId?: string | null
  refId?: string | null
  kind?: PreparedPromptKind
  userId?: string | null
}): Promise<PreparedGenerationPrompt | null> {
  const artifactId = params.artifactId.trim()
  if (!artifactId) return null
  const row = await prisma.graphArtifact.findFirst({
    where: {
      id: artifactId,
      ...(params.kind ? { artifactType: artifactTypeForKind(params.kind) } : {}),
      run: {
        projectId: params.projectId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
    },
  })
  const prepared = row ? normalizePreparedPrompt(row) : null
  if (!prepared) return null
  if (params.targetId && prepared.targetId !== params.targetId) return null
  if (params.refId && prepared.refId !== params.refId) return null
  return prepared
}

export async function getLatestPreparedPrompt(params: {
  projectId: string
  targetId: string
  kind: PreparedPromptKind
  refId?: string | null
  generationMode?: string | null
  userId?: string | null
}): Promise<PreparedGenerationPrompt | null> {
  const rows = await prisma.graphArtifact.findMany({
    where: {
      artifactType: artifactTypeForKind(params.kind),
      refId: params.refId?.trim() || params.targetId,
      run: {
        projectId: params.projectId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 12,
  })
  for (const row of rows) {
    const prepared = normalizePreparedPrompt(row)
    if (
      prepared?.targetId === params.targetId
      && (params.generationMode === undefined || prepared.generationMode === params.generationMode)
    ) {
      return prepared
    }
  }
  return null
}

export async function getLatestPreparedPrompts(params: {
  projectId: string
  lookups: PreparedPromptLookup[]
  userId?: string | null
}): Promise<PreparedGenerationPrompt[]> {
  const uniqueLookups = Array.from(new Map(
    params.lookups
      .map((lookup) => ({
        ...lookup,
        targetId: lookup.targetId.trim(),
        refId: lookup.refId?.trim() || lookup.targetId.trim(),
      }))
      .filter((lookup) => lookup.targetId)
      .map((lookup) => [
        `${lookup.kind}:${lookup.targetId}:${lookup.refId}:${lookup.generationMode ?? '*'}`,
        lookup,
      ]),
  ).values())
  if (uniqueLookups.length === 0) return []

  const artifactTypes = Array.from(new Set(uniqueLookups.map((lookup) => artifactTypeForKind(lookup.kind))))
  const refIds = Array.from(new Set(uniqueLookups.map((lookup) => lookup.refId)))
  const rows = await prisma.graphArtifact.findMany({
    where: {
      artifactType: { in: artifactTypes },
      refId: { in: refIds },
      run: {
        projectId: params.projectId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.max(uniqueLookups.length * 12, 24),
  })
  const matches = new Map<string, PreparedGenerationPrompt>()
  for (const row of rows) {
    const prepared = normalizePreparedPrompt(row)
    if (!prepared) continue
    for (const lookup of uniqueLookups) {
      const key = `${lookup.kind}:${lookup.targetId}:${lookup.refId}:${lookup.generationMode ?? '*'}`
      if (matches.has(key)) continue
      if (
        prepared.kind === lookup.kind
        && prepared.targetId === lookup.targetId
        && prepared.refId === lookup.refId
        && (lookup.generationMode === undefined || prepared.generationMode === lookup.generationMode)
      ) {
        matches.set(key, prepared)
      }
    }
  }
  return uniqueLookups.flatMap((lookup) => {
    const key = `${lookup.kind}:${lookup.targetId}:${lookup.refId}:${lookup.generationMode ?? '*'}`
    const prepared = matches.get(key)
    return prepared ? [prepared] : []
  })
}

export async function requirePreparedPrompt(params: {
  artifactId: unknown
  projectId: string
  targetId: string
  refId?: string | null
  kind: PreparedPromptKind
  userId?: string | null
}): Promise<PreparedGenerationPrompt> {
  const artifactId = readString(params.artifactId)
  if (!artifactId) {
    throw new PreparedPromptError('PREPARED_PROMPT_REQUIRED', '请先固定提示词，再提交生成。')
  }
  const prepared = await getPreparedPromptByArtifactId({
    artifactId,
    projectId: params.projectId,
    targetId: params.targetId,
    refId: params.refId || null,
    kind: params.kind,
    userId: params.userId || null,
  })
  if (!prepared) {
    throw new PreparedPromptError('PREPARED_PROMPT_NOT_FOUND', '已固定的提示词不存在、无权访问或不属于当前目标。')
  }
  return prepared
}

export async function requireCurrentPanelImagePreparedPrompt(params: {
  artifactId: unknown
  projectId: string
  targetId: string
  userId?: string | null
}): Promise<PreparedGenerationPrompt> {
  const prepared = await requirePreparedPrompt({
    artifactId: params.artifactId,
    projectId: params.projectId,
    targetId: params.targetId,
    kind: 'panel_image',
    userId: params.userId || null,
  })
  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: params.targetId,
      storyboard: {
        episode: {
          novelPromotionProject: { projectId: params.projectId },
        },
      },
    },
    select: { referencePlan: true },
  })
  if (!panel || !isPanelImagePromptCurrent({
    referencePlan: panel.referencePlan,
    artifactId: prepared.artifactId,
    assetVersionHash: prepared.snapshot.assetVersionHash,
  })) {
    throw new PreparedPromptError(
      'PREPARED_PROMPT_INVALID',
      '分镜引用的资产定稿已变更，请重新固定图片提示词。',
    )
  }
  return prepared
}

export function attachPreparedPromptToSnapshot(
  snapshot: GenerationSnapshot,
  preparedPromptArtifactId: string,
): GenerationSnapshot & { preparedPromptArtifactId: string } {
  return {
    ...snapshot,
    preparedPromptArtifactId,
  }
}

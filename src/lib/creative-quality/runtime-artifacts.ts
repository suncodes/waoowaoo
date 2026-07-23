import type { Job } from 'bullmq'
import { createArtifact } from '@/lib/run-runtime/service'
import type { TaskJobData } from '@/lib/task/types'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function readOptionalTaskRunId(job: Job<TaskJobData>): string | null {
  const payload = asRecord(job.data.payload)
  const meta = asRecord(payload.meta)
  const direct = typeof payload.runId === 'string' ? payload.runId.trim() : ''
  if (direct) return direct
  const fromMeta = typeof meta.runId === 'string' ? meta.runId.trim() : ''
  return fromMeta || null
}

export function toJsonRecord(value: unknown): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord
}

export async function createOptionalGenerationSnapshotArtifact(params: {
  job: Job<TaskJobData>
  stepKey: string
  artifactType: string
  refId: string
  versionHash: string
  payload: unknown
}): Promise<boolean> {
  const runId = readOptionalTaskRunId(params.job)
  if (!runId) return false
  try {
    await createArtifact({
      runId,
      stepKey: params.stepKey,
      artifactType: params.artifactType,
      refId: params.refId,
      versionHash: params.versionHash,
      payload: toJsonRecord(params.payload),
    })
    return true
  } catch {
    return false
  }
}

import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { safeParseJsonObject } from '@/lib/json-repair'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { TaskJobData } from '@/lib/task/types'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

export type JsonRecord = Record<string, unknown>

export function readTaskRunId(job: Job<TaskJobData>): string {
  const payload = (job.data.payload || {}) as JsonRecord
  const direct = typeof payload.runId === 'string' ? payload.runId.trim() : ''
  if (direct) return direct
  const meta = payload.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta)
    ? payload.meta as JsonRecord
    : {}
  const fromMeta = typeof meta.runId === 'string' ? meta.runId.trim() : ''
  if (!fromMeta) throw new Error('runId is required')
  return fromMeta
}

export function toJsonRecord(value: unknown): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord
}

export async function executePlanningJsonStep(params: {
  job: Job<TaskJobData>
  model: string
  prompt: string
  action: string
  stepId: string
  stepTitle: string
  stepIndex: number
  stepTotal: number
  temperature?: number
}) {
  const streamContext = createWorkerLLMStreamContext(params.job, params.stepId)
  const callbacks = createWorkerLLMStreamCallbacks(params.job, streamContext)
  try {
    const completion = await withInternalLLMStreamCallbacks(
      callbacks,
      async () => await executeAiTextStep({
        userId: params.job.data.userId,
        model: params.model,
        messages: [{ role: 'user', content: params.prompt }],
        projectId: params.job.data.projectId,
        action: params.action,
        temperature: params.temperature ?? 0.4,
        reasoning: true,
        meta: {
          stepId: params.stepId,
          stepTitle: params.stepTitle,
          stepIndex: params.stepIndex,
          stepTotal: params.stepTotal,
        },
      }),
    )
    return safeParseJsonObject(completion.text)
  } finally {
    await callbacks.flush()
  }
}

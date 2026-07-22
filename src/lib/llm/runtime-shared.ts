import OpenAI from 'openai'
import { createScopedLogger } from '@/lib/logging/core'
import { resolveModelSelection } from '../api-config'
import { recordTextUsage as recordBillingTextUsage } from '@/lib/billing/runtime-usage'
import type { InternalLLMStreamStepMeta } from '@/lib/llm-observe/internal-stream-context'

export const llmLogger = createScopedLogger({
  module: 'llm.client',
  action: 'llm.call',
})

export const _ulogInfo = (...args: unknown[]) => llmLogger.info(...args)
export const _ulogWarn = (...args: unknown[]) => llmLogger.warn(...args)
export const _ulogError = (...args: unknown[]) => llmLogger.error(...args)

/**
 * Stable correlation id for one logical provider call.
 * The id is written to both raw input and raw output events so offline
 * diagnostics never have to infer pairs from model/step names.
 */
export function createLlmInvocationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export type LlmRawMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type LlmUsage = {
  promptTokens: number
  completionTokens: number
}

export function completionUsageSummary(
  completion: OpenAI.Chat.Completions.ChatCompletion | null | undefined,
): LlmUsage | null {
  const usage = completion?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  if (!usage) return null
  const promptTokens = Number(usage.prompt_tokens ?? 0)
  const completionTokens = Number(usage.completion_tokens ?? 0)
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null
  return {
    promptTokens,
    completionTokens,
  }
}

export function logLlmRawInput(params: {
  userId: string
  projectId?: string
  provider: string
  modelId: string
  modelKey: string
  stream: boolean
  reasoning: boolean
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
  temperature: number
  action?: string
  invocationId?: string
  attempt?: number
  messages: LlmRawMessage[]
  step?: InternalLLMStreamStepMeta
  imageCount?: number
}) {
  llmLogger.info({
    audit: true,
    action: 'llm.raw.input',
    message: 'llm raw input',
    userId: params.userId,
    projectId: params.projectId,
    provider: params.provider,
    details: {
      action: params.action || null,
      invocationId: params.invocationId || null,
      attempt: params.attempt || null,
      stream: params.stream,
      model: {
        id: params.modelId,
        key: params.modelKey,
      },
      options: {
        temperature: params.temperature,
        reasoning: params.reasoning,
        reasoningEffort: params.reasoningEffort,
      },
      step: params.step || null,
      imageCount: params.imageCount ?? 0,
      messages: params.messages,
    },
  })
}

export function logLlmRawOutput(params: {
  userId: string
  projectId?: string
  provider: string
  modelId: string
  modelKey: string
  stream: boolean
  action?: string
  invocationId?: string
  attempt?: number
  text: string
  reasoning: string
  usage?: LlmUsage | null
  step?: InternalLLMStreamStepMeta
}) {
  const isEmpty = !params.text
  const logPayload = {
    audit: true,
    action: 'llm.raw.output',
    message: isEmpty ? 'llm raw output [EMPTY]' : 'llm raw output',
    userId: params.userId,
    projectId: params.projectId,
    provider: params.provider,
    details: {
      action: params.action || null,
      invocationId: params.invocationId || null,
      attempt: params.attempt || null,
      stream: params.stream,
      model: {
        id: params.modelId,
        key: params.modelKey,
      },
      output: {
        reasoning: params.reasoning,
        text: params.text,
        // 空响应时显式标记，方便 grep
        empty: isEmpty || undefined,
      },
      step: params.step || null,
      usage: params.usage || null,
    },
  }
  if (isEmpty) {
    llmLogger.warn(logPayload)
  } else {
    llmLogger.info(logPayload)
  }
}

export function logLlmRawError(params: {
  userId: string
  projectId?: string
  provider: string
  modelId: string
  modelKey: string
  stream: boolean
  action?: string
  invocationId?: string
  attempt?: number
  retryable?: boolean
  durationMs?: number
  step?: InternalLLMStreamStepMeta
  error: unknown
}) {
  const error = params.error instanceof Error
    ? {
      name: params.error.name,
      message: params.error.message,
      code: typeof (params.error as Error & { code?: unknown }).code === 'string'
        ? (params.error as Error & { code?: string }).code
        : null,
    }
    : { name: 'Error', message: String(params.error), code: null }
  llmLogger.warn({
    audit: true,
    action: 'llm.raw.error',
    message: 'llm raw error',
    userId: params.userId,
    projectId: params.projectId,
    provider: params.provider,
    retryable: params.retryable,
    durationMs: params.durationMs,
    details: {
      action: params.action || null,
      invocationId: params.invocationId || null,
      attempt: params.attempt || null,
      stream: params.stream,
      model: { id: params.modelId, key: params.modelKey },
      step: params.step || null,
      error,
    },
  })
}

export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const errorRecord = error as { code?: unknown; status?: unknown }
  if (errorRecord.code === 'ECONNRESET' || errorRecord.code === 'ETIMEDOUT') return true
  if (typeof errorRecord.status === 'number' && (errorRecord.status === 429 || (errorRecord.status >= 500 && errorRecord.status < 600))) {
    return true
  }
  return false
}

export function recordCompletionUsage(model: string, completion: OpenAI.Chat.Completions.ChatCompletion) {
  const summary = completionUsageSummary(completion)
  if (!summary) return

  recordBillingTextUsage({
    model,
    inputTokens: summary.promptTokens,
    outputTokens: summary.completionTokens,
  })
}

export interface ResolvedLlmRuntimeModel {
  provider: string
  modelId: string
  modelKey: string
  llmProtocol?: 'responses' | 'chat-completions'
}

export async function resolveLlmRuntimeModel(
  userId: string,
  model: string,
): Promise<ResolvedLlmRuntimeModel> {
  const selection = await resolveModelSelection(userId, model, 'llm')
  return {
    provider: selection.provider,
    modelId: selection.modelId,
    modelKey: selection.modelKey,
    llmProtocol: selection.llmProtocol,
  }
}

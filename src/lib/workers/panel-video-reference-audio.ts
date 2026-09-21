import type { Job } from 'bullmq'
import { createScopedLogger } from '@/lib/logging/core'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { arkSeedanceSupportsReferenceAudio } from '@/lib/generators/ark'
import { readPanelSpeechVoiceConfig } from '@/lib/novel-promotion/panel-speech'
import {
  resolveOutboundAudioReferences,
  summarizeOutboundAudioReferences,
  type OutboundAudioReference,
  type OutboundAudioReferenceSummary,
} from '@/lib/media/outbound-audio'
import type { TaskJobData } from '@/lib/task/types'
import {
  readVideoReferenceAudioSources,
  resolveVideoReferenceAudioMaxCount,
} from '@/lib/video-reference-audio'

function canUseAutomaticReferenceAudio(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  return parsed?.provider.toLowerCase() === 'ark' && arkSeedanceSupportsReferenceAudio(parsed.modelId)
}

function createReferenceAudioLogger(job: Job<TaskJobData>) {
  return createScopedLogger({
    module: 'worker.video',
    action: 'panel_video_reference_audio',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
}

async function resolveExplicitReferenceAudios(params: {
  job: Job<TaskJobData>
  modelKey: string
  structuredReferences?: unknown
}): Promise<{
  referenceAudios: OutboundAudioReference[]
  referenceAudioSummary: OutboundAudioReferenceSummary[]
} | null> {
  const sources = readVideoReferenceAudioSources(params.structuredReferences)
  if (sources.length === 0) return null

  const maxCount = await resolveVideoReferenceAudioMaxCount({
    userId: params.job.data.userId,
    modelKey: params.modelKey,
  })
  if (maxCount === 0) {
    throw new Error('PREPARED_PROMPT_REFERENCE_AUDIO_UNSUPPORTED: current model no longer supports reference audio')
  }
  if (sources.length > maxCount) {
    throw new Error(`PREPARED_PROMPT_REFERENCE_AUDIO_CAPACITY_CHANGED: selected=${sources.length} current=${maxCount}`)
  }

  const logger = createReferenceAudioLogger(params.job)
  const resolved = await resolveOutboundAudioReferences(
    sources.map((source) => ({
      url: source.url,
      speaker: source.name,
      source: 'speaker' as const,
      provider: 'global-voice',
      voiceType: source.voiceType,
    })),
    {
      maxCount: sources.length,
      onIssue: (issue) => {
        logger.warn({
          message: 'prepared panel reference audio unavailable',
          details: {
            index: issue.index,
            code: issue.code,
            message: issue.message,
          },
        })
      },
    },
  )
  if (resolved.issues.length > 0 || resolved.references.length !== sources.length) {
    throw new Error('PREPARED_PROMPT_REFERENCE_AUDIO_UNAVAILABLE: selected reference audio is missing or invalid')
  }

  const summary = summarizeOutboundAudioReferences(resolved.references)
  logger.info({
    message: 'prepared panel reference audio ready',
    details: {
      count: summary.length,
      references: summary,
    },
  })
  return {
    referenceAudios: resolved.references,
    referenceAudioSummary: summary,
  }
}

export async function resolvePanelVideoReferenceAudios(params: {
  job: Job<TaskJobData>
  modelKey: string
  requestedGenerateAudio: boolean | undefined
  speech: { speaker: string; voiceConfigJson?: unknown } | null
  structuredReferences?: unknown
}): Promise<{
  referenceAudios: OutboundAudioReference[]
  referenceAudioSummary: OutboundAudioReferenceSummary[]
}> {
  const explicit = await resolveExplicitReferenceAudios({
    job: params.job,
    modelKey: params.modelKey,
    structuredReferences: params.structuredReferences,
  })
  if (explicit) return explicit

  if (params.requestedGenerateAudio !== true || !params.speech) {
    return { referenceAudios: [], referenceAudioSummary: [] }
  }
  if (!canUseAutomaticReferenceAudio(params.modelKey)) {
    return { referenceAudios: [], referenceAudioSummary: [] }
  }

  const voiceConfig = readPanelSpeechVoiceConfig(params.speech.voiceConfigJson)
  if (!voiceConfig?.hasVoice || !voiceConfig.previewAudioUrl) {
    return { referenceAudios: [], referenceAudioSummary: [] }
  }

  const logger = createReferenceAudioLogger(params.job)

  const resolved = await resolveOutboundAudioReferences(
    [{
      url: voiceConfig.previewAudioUrl,
      speaker: voiceConfig.speaker,
      source: voiceConfig.source === 'character' || voiceConfig.source === 'speaker' ? voiceConfig.source : undefined,
      provider: voiceConfig.provider,
      voiceType: voiceConfig.voiceType,
    }],
    {
      maxCount: 1,
      onIssue: (issue) => {
        logger.warn({
          message: 'panel reference audio skipped',
          details: {
            index: issue.index,
            code: issue.code,
            message: issue.message,
          },
        })
      },
    },
  )
  const summary = summarizeOutboundAudioReferences(resolved.references)
  if (summary.length > 0) {
    logger.info({
      message: 'panel reference audio prepared',
      details: {
        count: summary.length,
        references: summary,
      },
    })
  }

  return {
    referenceAudios: resolved.references,
    referenceAudioSummary: summary,
  }
}

import type { Job } from 'bullmq'
import { createScopedLogger } from '@/lib/logging/core'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { arkSeedanceSupportsReferenceAudio } from '@/lib/generators/ark'
import { getPanelSpeechReferenceVoiceConfigs } from '@/lib/novel-promotion/speech-plan'
import {
  resolveOutboundAudioReferences,
  summarizeOutboundAudioReferences,
  type OutboundAudioReference,
  type OutboundAudioReferenceSummary,
} from '@/lib/media/outbound-audio'
import type { TaskJobData } from '@/lib/task/types'

function canUseReferenceAudio(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  return parsed?.provider.toLowerCase() === 'ark' && arkSeedanceSupportsReferenceAudio(parsed.modelId)
}

export async function resolvePanelVideoReferenceAudios(params: {
  job: Job<TaskJobData>
  modelKey: string
  requestedGenerateAudio: boolean | undefined
  speechPlan: { linesJson?: unknown; voiceConfigJson?: unknown } | null
}): Promise<{
  referenceAudios: OutboundAudioReference[]
  referenceAudioSummary: OutboundAudioReferenceSummary[]
}> {
  if (params.requestedGenerateAudio !== true || !params.speechPlan) {
    return { referenceAudios: [], referenceAudioSummary: [] }
  }
  if (!canUseReferenceAudio(params.modelKey)) {
    return { referenceAudios: [], referenceAudioSummary: [] }
  }

  const voiceConfigs = getPanelSpeechReferenceVoiceConfigs(
    params.speechPlan.linesJson,
    params.speechPlan.voiceConfigJson,
  )
  if (voiceConfigs.length === 0) {
    return { referenceAudios: [], referenceAudioSummary: [] }
  }

  const logger = createScopedLogger({
    module: 'worker.video',
    action: 'panel_video_reference_audio',
    requestId: params.job.data.trace?.requestId || undefined,
    taskId: params.job.data.taskId,
    projectId: params.job.data.projectId,
    userId: params.job.data.userId,
  })

  const resolved = await resolveOutboundAudioReferences(
    voiceConfigs.flatMap((config) => {
      if (!config.previewAudioUrl) return []
      return [{
        url: config.previewAudioUrl,
        speaker: config.speaker,
        source: config.source === 'character' || config.source === 'speaker' ? config.source : undefined,
        provider: config.provider,
        voiceType: config.voiceType,
      }]
    }),
    {
      maxCount: 3,
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

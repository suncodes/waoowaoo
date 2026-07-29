import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { TaskJobData } from '@/lib/task/types'
import { rebuildEpisodeNarrationTimeline } from '@/lib/novel-promotion/narration-timeline'
import {
  listEpisodePanelSpeeches,
} from '@/lib/novel-promotion/panel-speech'
import {
  rebuildEpisodeSpeechPlans,
} from '@/lib/novel-promotion/speech-plan'

export async function handleVoiceAnalyzeTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const projectId = job.data.projectId
  const episodeIdRaw =
    typeof payload.episodeId === 'string'
      ? payload.episodeId
      : typeof job.data.episodeId === 'string'
        ? job.data.episodeId
        : ''
  const episodeId = episodeIdRaw.trim()

  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: {
      voiceLines: {
        select: { id: true },
      },
    },
  })
  if (!episode) {
    throw new Error('Episode not found')
  }
  const existingPanelSpeeches = await listEpisodePanelSpeeches(episodeId)
  const hasLegacyVoiceLines = episode.voiceLines.length > 0
  const hasCanonicalSpeechContract = existingPanelSpeeches.available
    && (existingPanelSpeeches.speeches.length > 0 || !hasLegacyVoiceLines)
  if (hasCanonicalSpeechContract) {
    await reportTaskProgress(job, 20, {
      stage: 'voice_analyze_prepare',
      stageLabel: '准备台词分析参数',
      displayMode: 'detail',
      message: '当前分镜已有镜头级台词，正在同步台词与声音计划。',
    })
    await assertTaskActive(job, 'voice_analyze_prepare')

    await rebuildEpisodeNarrationTimeline(episodeId)
    const speechPlanResult = await rebuildEpisodeSpeechPlans(episodeId, 'storyboard')
    const speakerStats: Record<string, number> = {}
    for (const speech of existingPanelSpeeches.speeches) {
      speakerStats[speech.speaker] = (speakerStats[speech.speaker] || 0) + 1
    }
    const matchedCount = existingPanelSpeeches.speeches.length

    await reportTaskProgress(job, 96, {
      stage: 'voice_analyze_persist_done',
      stageLabel: '台词分析结果已保存',
      displayMode: 'detail',
      message: '镜头台词与声音计划已同步。',
    })

    return {
      episodeId,
      count: existingPanelSpeeches.speeches.length,
      matchedCount,
      speakerStats,
      speechPlanSummary: speechPlanResult.summary,
    }
  }

  throw new Error('PANEL_SPEECH_REBUILD_REQUIRED: 当前项目仅有旧台词数据，无法安全转换为一镜一条可播台词；请重新生成分镜文稿。')
}

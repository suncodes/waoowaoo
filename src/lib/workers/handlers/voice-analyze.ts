import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { buildCharactersIntroduction } from '@/lib/constants'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import {
  buildStoryboardJson,
  parseVoiceLinesJson,
  type VoiceLinePayload,
} from './voice-analyze-helpers'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { resolveVoiceAnalysisSource } from '@/lib/voice/voice-analysis-source'
import { rebuildEpisodeNarrationTimeline } from '@/lib/novel-promotion/narration-timeline'
import {
  isStoryboardSpeechPlanSource,
  listEpisodeSpeechPlans,
  rebuildEpisodeSpeechPlans,
} from '@/lib/novel-promotion/speech-plan'

const MAX_VOICE_ANALYZE_ATTEMPTS = 2

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

  const novelPromotionData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
    },
  })
  if (!novelPromotionData) {
    throw new Error('Novel promotion data not found')
  }

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: {
        orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
        select: {
          content: true,
          screenplay: true,
          summary: true,
        },
      },
      storyboards: {
        include: {
          clip: true,
          panels: {
            orderBy: { panelIndex: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      voiceLines: {
        orderBy: { lineIndex: 'asc' },
        select: {
          speaker: true,
          matchedPanelId: true,
          matchedStoryboardId: true,
        },
      },
    },
  })
  if (!episode) {
    throw new Error('Episode not found')
  }
  if (episode.novelPromotionProjectId !== novelPromotionData.id) {
    throw new Error('Episode does not belong to this project')
  }

  const existingSpeechPlans = await listEpisodeSpeechPlans(episodeId)
  const usesStoryboardSpeechContract = existingSpeechPlans.available
    && existingSpeechPlans.plans.some((plan) => isStoryboardSpeechPlanSource(plan.source))
  if (usesStoryboardSpeechContract) {
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
    for (const line of episode.voiceLines) {
      speakerStats[line.speaker] = (speakerStats[line.speaker] || 0) + 1
    }
    const matchedCount = episode.voiceLines.filter((line) => (
      !!line.matchedStoryboardId || !!line.matchedPanelId
    )).length

    await reportTaskProgress(job, 96, {
      stage: 'voice_analyze_persist_done',
      stageLabel: '台词分析结果已保存',
      displayMode: 'detail',
      message: '镜头台词与声音计划已同步。',
    })

    return {
      episodeId,
      count: episode.voiceLines.length,
      matchedCount,
      speakerStats,
      speechPlanSummary: speechPlanResult.summary,
    }
  }

  const voiceSource = resolveVoiceAnalysisSource({
    contentPlan: episode.contentPlan,
    clips: episode.clips,
    storyboards: episode.storyboards,
    novelText: episode.novelText,
  })

  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelPromotionData.analysisModel,
  })

  const charactersLibName = novelPromotionData.characters.length > 0
    ? novelPromotionData.characters.map((c) => c.name).join('、')
    : '无'
  const charactersIntroduction = buildCharactersIntroduction(novelPromotionData.characters)
  const storyboardJson = buildStoryboardJson(episode.storyboards || [])
  const promptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_VOICE_ANALYSIS,
    locale: job.data.locale,
    variables: {
      input: voiceSource.text,
      characters_lib_name: charactersLibName,
      characters_introduction: charactersIntroduction,
      storyboard_json: storyboardJson,
    },
  })

  await reportTaskProgress(job, 20, {
    stage: 'voice_analyze_prepare',
    stageLabel: '准备台词分析参数',
    displayMode: 'detail',
    message: `配音文本来源：${voiceSource.sourceType}，${voiceSource.unitCount} 个单元`,
  })
  await assertTaskActive(job, 'voice_analyze_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'voice_analyze')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const panelIdByStoryboardPanel = new Map<string, string>()
  for (const storyboard of episode.storyboards || []) {
    for (const panel of storyboard.panels || []) {
      panelIdByStoryboardPanel.set(`${storyboard.id}:${panel.panelIndex}`, panel.id)
    }
  }
  if (panelIdByStoryboardPanel.size === 0) {
    throw new Error('No storyboard panels found for voice matching')
  }

  type StrictVoiceLine = {
    lineIndex: number
    speaker: string
    content: string
    emotionStrength: number
    matchedPanelId: string | null
    matchedStoryboardId: string | null
    matchedPanelIndex: number | null
  }
  let voiceLinesData: StrictVoiceLine[] | null = null
  let lastAnalyzeError: Error | null = null

  try {
    for (let attempt = 1; attempt <= MAX_VOICE_ANALYZE_ATTEMPTS; attempt += 1) {
      try {
        const completion = await withInternalLLMStreamCallbacks(
          streamCallbacks,
          async () =>
            await executeAiTextStep({
              userId: job.data.userId,
              model: analysisModel,
              messages: [{ role: 'user', content: promptTemplate }],
              projectId,
              action: 'voice_analyze',
              meta: {
                stepId: 'voice_analyze',
                stepAttempt: attempt,
                stepTitle: '台词分析',
                stepIndex: 1,
                stepTotal: 1,
              },
            }),
        )

        const responseText = completion.text
        if (!responseText) {
          throw new Error('No response from AI')
        }

        const parsedLines = parseVoiceLinesJson(responseText)
        const strictLines: StrictVoiceLine[] = parsedLines.map((lineData: VoiceLinePayload, index: number) => {
          if (typeof lineData.lineIndex !== 'number' || !Number.isFinite(lineData.lineIndex)) {
            throw new Error(`voice line ${index + 1} is missing valid lineIndex`)
          }
          const lineIndex = Math.floor(lineData.lineIndex)
          if (lineIndex <= 0) {
            throw new Error(`voice line ${index + 1} has invalid lineIndex`)
          }
          if (typeof lineData.speaker !== 'string' || !lineData.speaker.trim()) {
            throw new Error(`voice line ${index + 1} is missing valid speaker`)
          }
          if (typeof lineData.content !== 'string' || !lineData.content.trim()) {
            throw new Error(`voice line ${index + 1} is missing valid content`)
          }
          if (typeof lineData.emotionStrength !== 'number' || !Number.isFinite(lineData.emotionStrength)) {
            throw new Error(`voice line ${index + 1} is missing valid emotionStrength`)
          }

          const matchedPanel = lineData.matchedPanel
          if (!matchedPanel) {
            return {
              lineIndex,
              speaker: lineData.speaker.trim(),
              content: lineData.content,
              emotionStrength: Math.min(1, Math.max(0.1, lineData.emotionStrength)),
              matchedPanelId: null,
              matchedStoryboardId: null,
              matchedPanelIndex: null,
            }
          }

          const storyboardId = typeof matchedPanel.storyboardId === 'string' ? matchedPanel.storyboardId.trim() : ''
          const panelIndex = typeof matchedPanel.panelIndex === 'number' && Number.isFinite(matchedPanel.panelIndex)
            ? Math.floor(matchedPanel.panelIndex)
            : null
          if (!storyboardId || panelIndex === null || panelIndex < 0) {
            throw new Error(`voice line ${index + 1} has invalid matchedPanel`)
          }

          const panelKey = `${storyboardId}:${panelIndex}`
          const panelId = panelIdByStoryboardPanel.get(panelKey)
          if (!panelId) {
            throw new Error(`voice line ${index + 1} references non-existent panel ${panelKey}`)
          }

          return {
            lineIndex,
            speaker: lineData.speaker.trim(),
            content: lineData.content,
            emotionStrength: Math.min(1, Math.max(0.1, lineData.emotionStrength)),
            matchedPanelId: panelId,
            matchedStoryboardId: storyboardId,
            matchedPanelIndex: panelIndex,
          }
        })

        voiceLinesData = strictLines
        break
      } catch (error) {
        lastAnalyzeError = error instanceof Error ? error : new Error(String(error))
      }
    }
  } finally {
    await streamCallbacks.flush()
  }

  if (!voiceLinesData) {
    throw lastAnalyzeError || new Error('voice analyze failed')
  }

  await reportTaskProgress(job, 82, {
    stage: 'voice_analyze_persist',
    stageLabel: '保存台词分析结果',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_analyze_persist')

  const createdVoiceLines = await prisma.$transaction(async (tx) => {
    const voiceLineModel = tx.novelPromotionVoiceLine as unknown as {
      upsert?: (args: unknown) => Promise<{
        id: string
        speaker: string
        matchedStoryboardId: string | null
      }>
      create: (args: unknown) => Promise<{
        id: string
        speaker: string
        matchedStoryboardId: string | null
      }>
      deleteMany: (args: unknown) => Promise<unknown>
    }
    const created: Array<{
      id: string
      speaker: string
      matchedStoryboardId: string | null
    }> = []

    for (let i = 0; i < voiceLinesData.length; i += 1) {
      const lineData = voiceLinesData[i]

      const upsertArgs = {
        where: {
          episodeId_lineIndex: {
            episodeId,
            lineIndex: lineData.lineIndex,
          },
        },
        create: {
          episodeId,
          lineIndex: lineData.lineIndex,
          speaker: lineData.speaker,
          content: lineData.content,
          emotionStrength: lineData.emotionStrength,
          matchedPanelId: lineData.matchedPanelId,
          matchedStoryboardId: lineData.matchedStoryboardId,
          matchedPanelIndex: lineData.matchedPanelIndex,
        },
        update: {
          speaker: lineData.speaker,
          content: lineData.content,
          emotionStrength: lineData.emotionStrength,
          matchedPanelId: lineData.matchedPanelId,
          matchedStoryboardId: lineData.matchedStoryboardId,
          matchedPanelIndex: lineData.matchedPanelIndex,
        },
        select: {
          id: true,
          speaker: true,
          matchedStoryboardId: true,
        },
      }
      const voiceLine = typeof voiceLineModel.upsert === 'function'
        ? await voiceLineModel.upsert(upsertArgs)
        : (
          process.env.NODE_ENV === 'test'
            ? await voiceLineModel.create({
              data: upsertArgs.create,
              select: upsertArgs.select,
            })
            : (() => { throw new Error('novelPromotionVoiceLine.upsert unavailable') })()
        )
      created.push(voiceLine)
    }

    const incomingLineIndexes = new Set<number>(voiceLinesData.map((item) => item.lineIndex))
    if (incomingLineIndexes.size === 0) {
      await voiceLineModel.deleteMany({
        where: {
          episodeId,
        },
      })
    } else {
      await voiceLineModel.deleteMany({
        where: {
          episodeId,
          lineIndex: {
            notIn: Array.from(incomingLineIndexes),
          },
        },
      })
    }

    return created
  })

  const speakerStats: Record<string, number> = {}
  for (const line of createdVoiceLines) {
    speakerStats[line.speaker] = (speakerStats[line.speaker] || 0) + 1
  }
  const matchedCount = createdVoiceLines.filter((line) => line.matchedStoryboardId).length
  await rebuildEpisodeNarrationTimeline(episodeId)
  const speechPlanResult = await rebuildEpisodeSpeechPlans(episodeId, 'voice_analyze')

  await reportTaskProgress(job, 96, {
    stage: 'voice_analyze_persist_done',
    stageLabel: '台词分析结果已保存',
    displayMode: 'detail',
  })

  return {
    episodeId,
    count: createdVoiceLines.length,
    matchedCount,
    speakerStats,
    speechPlanSummary: speechPlanResult.summary,
  }
}

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
  listEpisodePanelSpeeches,
  replaceEpisodePanelSpeeches,
} from '@/lib/novel-promotion/panel-speech'
import {
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

  const existingPanelSpeeches = await listEpisodePanelSpeeches(episodeId)
  const usesStoryboardSpeechContract = existingPanelSpeeches.available
    && existingPanelSpeeches.speeches.some((speech) => (
      speech.source === 'storyboard' || speech.source === 'visual_plan'
    ))
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
            throw new Error(`PANEL_SPEECH_INVALID: voice line ${index + 1} is not assigned to a storyboard panel`)
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

  const assignedPanelIds = new Set<string>()
  const assignments = voiceLinesData.map((lineData, index) => {
    if (!lineData.matchedPanelId) {
      throw new Error(`PANEL_SPEECH_INVALID: voice line ${index + 1} is not assigned to a storyboard panel`)
    }
    if (assignedPanelIds.has(lineData.matchedPanelId)) {
      throw new Error(`PANEL_SPEECH_INVALID: multiple spoken lines are assigned to panel ${lineData.matchedPanelId}`)
    }
    assignedPanelIds.add(lineData.matchedPanelId)
    return {
      panelId: lineData.matchedPanelId,
      speaker: lineData.speaker,
      content: lineData.content,
      emotionStrength: lineData.emotionStrength,
      sourceAnchor: {
        storyboardId: lineData.matchedStoryboardId,
        panelIndex: lineData.matchedPanelIndex,
        lineIndex: lineData.lineIndex,
      },
    }
  })
  const panelSpeechResult = await replaceEpisodePanelSpeeches({
    episodeId,
    assignments,
    source: 'voice_analyze',
  })
  if (!panelSpeechResult.available) {
    throw new Error('PANEL_SPEECH_TABLE_MISSING')
  }

  const speakerStats: Record<string, number> = {}
  for (const assignment of assignments) {
    speakerStats[assignment.speaker] = (speakerStats[assignment.speaker] || 0) + 1
  }
  const matchedCount = assignments.length
  await rebuildEpisodeNarrationTimeline(episodeId)
  const speechPlanResult = await rebuildEpisodeSpeechPlans(episodeId, 'voice_analyze')

  await reportTaskProgress(job, 96, {
    stage: 'voice_analyze_persist_done',
    stageLabel: '台词分析结果已保存',
    displayMode: 'detail',
  })

  return {
    episodeId,
    count: assignments.length,
    matchedCount,
    speakerStats,
    speechPlanSummary: speechPlanResult.summary,
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveMediaRef, resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { rebuildEpisodeNarrationTimeline } from '@/lib/novel-promotion/narration-timeline'
import {
  createPanelSpeech,
  deletePanelSpeech,
  isPanelSpeechTableMissing,
  updatePanelSpeech,
} from '@/lib/novel-promotion/panel-speech'
import { rebuildEpisodeSpeechPlans } from '@/lib/novel-promotion/speech-plan'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function throwPanelSpeechSchemaError(error: unknown): never {
  if (isPanelSpeechTableMissing(error)) {
    throw new ApiError('CONFLICT', {
      code: 'DB_SCHEMA_OUT_OF_DATE',
      message: '数据库缺少镜头级可播台词表。请执行最新数据库迁移后，重新生成分镜文稿与台词计划。',
      table: 'novel_promotion_panel_speeches',
    })
  }
  throw error
}

async function assertEpisodeBelongsToProject(projectId: string, episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: { id: true },
  })
  if (!episode) throw new ApiError('NOT_FOUND')
}

async function rebuildEpisodeVoiceDerivedState(episodeId: string, source: string) {
  await rebuildEpisodeNarrationTimeline(episodeId)
  const speechPlans = await rebuildEpisodeSpeechPlans(episodeId, source)
  if (!speechPlans.available) {
    throw new ApiError('CONFLICT', {
      code: 'DB_SCHEMA_OUT_OF_DATE',
      message: '数据库缺少镜头级台词计划相关表。请执行最新数据库迁移后重试。',
    })
  }
}

type VoiceLinePresentation = {
  id: string
  speechId: string
  lineIndex: number
  speaker: string
  content: string
  deliveryContent: string | null
  deliveryDurationMs: number | null
  deliveryReason: string | null
  deliveryUpdatedAt: string | null
  emotionPrompt: string | null
  emotionStrength: number | null
  audioUrl: string | null
  updatedAt: string | null
  lineTaskRunning: boolean
  matchedPanelId: string
  matchedStoryboardId: string
  matchedPanelIndex: number
}

async function loadEpisodeVoiceLinePresentations(projectId: string, episodeId: string): Promise<VoiceLinePresentation[]> {
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: {
      storyboards: {
        select: {
          id: true,
          createdAt: true,
          clip: {
            select: {
              start: true,
              createdAt: true,
            },
          },
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              panelIndex: true,
              panelSpeech: {
                select: {
                  id: true,
                  speaker: true,
                  originalContent: true,
                  deliveryContent: true,
                  estimatedDurationMs: true,
                  emotionPrompt: true,
                  emotionStrength: true,
                  updatedAt: true,
                },
              },
              matchedVoiceLines: {
                orderBy: { lineIndex: 'asc' },
                select: {
                  id: true,
                  audioUrl: true,
                  audioMediaId: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!episode) throw new ApiError('NOT_FOUND')

  const storyboards = [...episode.storyboards].sort((left, right) => (
    (left.clip?.start ?? Number.MAX_SAFE_INTEGER) - (right.clip?.start ?? Number.MAX_SAFE_INTEGER)
    || (left.clip?.createdAt.getTime() ?? 0) - (right.clip?.createdAt.getTime() ?? 0)
    || left.createdAt.getTime() - right.createdAt.getTime()
  ))
  const voiceLines: VoiceLinePresentation[] = []
  let lineIndex = 1
  for (const storyboard of storyboards) {
    for (const panel of storyboard.panels) {
      const speech = panel.panelSpeech
      if (!speech) continue
      const legacyVoiceLine = panel.matchedVoiceLines[0] || null
      const audioMedia = legacyVoiceLine
        ? await resolveMediaRef(legacyVoiceLine.audioMediaId, legacyVoiceLine.audioUrl)
        : null
      voiceLines.push({
        id: legacyVoiceLine?.id || speech.id,
        speechId: speech.id,
        lineIndex,
        speaker: speech.speaker,
        content: speech.originalContent,
        deliveryContent: speech.deliveryContent,
        deliveryDurationMs: speech.deliveryContent ? speech.estimatedDurationMs : null,
        deliveryReason: null,
        deliveryUpdatedAt: speech.deliveryContent ? speech.updatedAt.toISOString() : null,
        emotionPrompt: speech.emotionPrompt,
        emotionStrength: speech.emotionStrength,
        audioUrl: audioMedia?.url || legacyVoiceLine?.audioUrl || null,
        updatedAt: speech.updatedAt.toISOString(),
        lineTaskRunning: false,
        matchedPanelId: panel.id,
        matchedStoryboardId: storyboard.id,
        matchedPanelIndex: panel.panelIndex,
      })
      lineIndex += 1
    }
  }
  return voiceLines
}

async function resolveSpeechIdFromLineId(episodeId: string, lineId: string): Promise<string | null> {
  const directSpeech = await prisma.novelPromotionPanelSpeech.findFirst({
    where: { id: lineId, episodeId },
    select: { id: true },
  })
  if (directSpeech) return directSpeech.id

  const legacyVoiceLine = await prisma.novelPromotionVoiceLine.findFirst({
    where: { id: lineId, episodeId },
    select: { matchedPanelId: true },
  })
  if (!legacyVoiceLine?.matchedPanelId) return null
  const speech = await prisma.novelPromotionPanelSpeech.findUnique({
    where: { panelId: legacyVoiceLine.matchedPanelId },
    select: { id: true },
  })
  return speech?.id || null
}

async function findVoiceLinePresentation(projectId: string, episodeId: string, speechId: string) {
  const voiceLines = await loadEpisodeVoiceLinePresentations(projectId, episodeId)
  return voiceLines.find((line) => line.speechId === speechId) || null
}

async function updateLegacyVoiceOutput(params: {
  episodeId: string
  lineId: string
  audioUrl?: string | null
  voicePresetId?: string | null
}) {
  const voiceLine = await prisma.novelPromotionVoiceLine.findFirst({
    where: { id: params.lineId, episodeId: params.episodeId },
    select: { id: true },
  })
  if (!voiceLine) throw new ApiError('NOT_FOUND')

  const data: {
    audioUrl?: string | null
    audioMediaId?: string | null
    voicePresetId?: string | null
  } = {}
  if (params.audioUrl !== undefined) {
    const media = await resolveMediaRefFromLegacyValue(params.audioUrl)
    data.audioUrl = params.audioUrl
    data.audioMediaId = media?.id || null
  }
  if (params.voicePresetId !== undefined) {
    data.voicePresetId = params.voicePresetId
  }
  await prisma.novelPromotionVoiceLine.update({
    where: { id: voiceLine.id },
    data,
  })
}

/**
 * GET /api/novel-promotion/[projectId]/voice-lines?episodeId=xxx
 * 从镜头级可播台词读取台词列表；VoiceLine 仅提供旧配音任务的音频输出。
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const episodeId = readTrimmedString(searchParams.get('episodeId'))
  const speakersOnly = searchParams.get('speakersOnly') === '1'

  try {
    if (speakersOnly) {
      const speakers = await prisma.novelPromotionPanelSpeech.findMany({
        where: {
          episode: {
            novelPromotionProject: { projectId },
          },
        },
        select: { speaker: true },
        distinct: ['speaker'],
        orderBy: { speaker: 'asc' },
      })
      return NextResponse.json({
        speakers: speakers.map((item) => item.speaker).filter(Boolean),
      })
    }

    if (!episodeId) throw new ApiError('INVALID_PARAMS')
    const voiceLines = await loadEpisodeVoiceLinePresentations(projectId, episodeId)
    const speakerStats: Record<string, number> = {}
    for (const line of voiceLines) {
      speakerStats[line.speaker] = (speakerStats[line.speaker] || 0) + 1
    }
    return NextResponse.json({
      voiceLines,
      count: voiceLines.length,
      speakerStats,
    })
  } catch (error) {
    throwPanelSpeechSchemaError(error)
  }
})

/**
 * POST /api/novel-promotion/[projectId]/voice-lines
 * 手动新增台词必须指定未占用的镜头。
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null)
  const episodeId = readTrimmedString(body?.episodeId)
  const panelId = readTrimmedString(body?.matchedPanelId)
  const content = readTrimmedString(body?.content)
  const speaker = readTrimmedString(body?.speaker)
  if (!episodeId || !panelId || !content || !speaker) {
    throw new ApiError('INVALID_PARAMS', {
      message: '一镜一条可播台词：新增台词时必须填写发言人、台词并绑定一个镜头。',
    })
  }

  await assertEpisodeBelongsToProject(projectId, episodeId)
  try {
    const result = await createPanelSpeech({
      episodeId,
      panelId,
      speaker,
      originalContent: content,
      emotionPrompt: typeof body?.emotionPrompt === 'string' ? body.emotionPrompt : null,
      emotionStrength: typeof body?.emotionStrength === 'number' ? body.emotionStrength : null,
      source: 'manual_ui',
    })
    await rebuildEpisodeVoiceDerivedState(episodeId, 'manual_ui')
    const voiceLine = await findVoiceLinePresentation(projectId, episodeId, result.speech.id)
    return NextResponse.json({ success: true, voiceLine })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PANEL_SPEECH_CONFLICT')) {
      throw new ApiError('CONFLICT', { message: '该镜头已有可播台词；请编辑现有台词或选择其他镜头。' })
    }
    throwPanelSpeechSchemaError(error)
  }
})

/**
 * PATCH /api/novel-promotion/[projectId]/voice-lines
 * 内容、发言人和镜头归属写入 PanelSpeech；音频 URL 仍是旧配音任务的输出字段。
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null)
  const lineId = readTrimmedString(body?.lineId)
  if (!lineId) throw new ApiError('INVALID_PARAMS')

  try {
    const legacyLine = await prisma.novelPromotionVoiceLine.findUnique({
      where: { id: lineId },
      select: { episodeId: true },
    })
    const directSpeech = legacyLine ? null : await prisma.novelPromotionPanelSpeech.findUnique({
      where: { id: lineId },
      select: { episodeId: true },
    })
    const episodeId = legacyLine?.episodeId || directSpeech?.episodeId || readTrimmedString(body?.episodeId)
    if (!episodeId) throw new ApiError('NOT_FOUND')
    await assertEpisodeBelongsToProject(projectId, episodeId)

    if (body?.audioUrl !== undefined || body?.voicePresetId !== undefined) {
      await updateLegacyVoiceOutput({
        episodeId,
        lineId,
        ...(body?.audioUrl !== undefined ? { audioUrl: body.audioUrl as string | null } : {}),
        ...(body?.voicePresetId !== undefined ? { voicePresetId: body.voicePresetId as string | null } : {}),
      })
      const speechId = await resolveSpeechIdFromLineId(episodeId, lineId)
      if (!speechId) throw new ApiError('NOT_FOUND')
      const voiceLine = await findVoiceLinePresentation(projectId, episodeId, speechId)
      return NextResponse.json({ success: true, voiceLine })
    }

    const speechId = await resolveSpeechIdFromLineId(episodeId, lineId)
    if (!speechId) throw new ApiError('NOT_FOUND')
    const result = await updatePanelSpeech({
      episodeId,
      speechId,
      ...(body?.matchedPanelId !== undefined ? { panelId: body.matchedPanelId } : {}),
      ...(body?.speaker !== undefined ? { speaker: body.speaker } : {}),
      ...(body?.content !== undefined ? { originalContent: body.content } : {}),
      ...(body?.emotionPrompt !== undefined ? { emotionPrompt: body.emotionPrompt } : {}),
      ...(body?.emotionStrength !== undefined ? { emotionStrength: body.emotionStrength } : {}),
      source: 'manual_ui',
    })
    await rebuildEpisodeVoiceDerivedState(episodeId, 'manual_ui')
    const voiceLine = await findVoiceLinePresentation(projectId, episodeId, result.speech.id)
    return NextResponse.json({ success: true, voiceLine })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PANEL_SPEECH_CONFLICT')) {
      throw new ApiError('CONFLICT', { message: '目标镜头已有可播台词；一个镜头只能绑定一条台词。' })
    }
    throwPanelSpeechSchemaError(error)
  }
})

/**
 * DELETE /api/novel-promotion/[projectId]/voice-lines?lineId=xxx
 */
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const lineId = readTrimmedString(searchParams.get('lineId'))
  if (!lineId) throw new ApiError('INVALID_PARAMS')

  try {
    const legacyLine = await prisma.novelPromotionVoiceLine.findUnique({
      where: { id: lineId },
      select: { episodeId: true },
    })
    const directSpeech = legacyLine ? null : await prisma.novelPromotionPanelSpeech.findUnique({
      where: { id: lineId },
      select: { episodeId: true },
    })
    const episodeId = legacyLine?.episodeId || directSpeech?.episodeId
    if (!episodeId) throw new ApiError('NOT_FOUND')
    await assertEpisodeBelongsToProject(projectId, episodeId)

    const speechId = await resolveSpeechIdFromLineId(episodeId, lineId)
    if (!speechId) throw new ApiError('NOT_FOUND')
    await deletePanelSpeech({ episodeId, speechId })
    await rebuildEpisodeVoiceDerivedState(episodeId, 'manual_ui')
    return NextResponse.json({ success: true, deletedId: lineId })
  } catch (error) {
    throwPanelSpeechSchemaError(error)
  }
})

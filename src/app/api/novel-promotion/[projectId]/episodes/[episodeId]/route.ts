import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { executeWorkspaceArtifactCommand } from '@/lib/creation-workspace/server-commands'
import type { WorkspaceArtifactCommand } from '@/lib/creation-workspace/commands'
import { listEpisodeSpeechPlans } from '@/lib/novel-promotion/speech-plan'
import { isPanelSpeechSchemaMissing } from '@/lib/novel-promotion/panel-speech'

function buildStageDataInclude() {
  const baseInclude = {
    clips: {
      orderBy: [{ start: 'asc' as const }, { createdAt: 'asc' as const }]
    },
    storyboards: {
      include: {
        clip: true,
        panels: {
          orderBy: { panelIndex: 'asc' as const },
          include: {
            panelSpeech: {
              include: {
                audio: true,
              },
            },
          },
        }
      },
      orderBy: { createdAt: 'asc' as const }
    },
    shots: {
      orderBy: { shotId: 'asc' as const }
    }
  }

  return {
    ...baseInclude,
  }
}

async function findEpisodeWithStageData(episodeId: string) {
  return await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: buildStageDataInclude(),
  })
}

function projectCanonicalSpeechState<T extends {
  id: string
  storyboards: Array<{
    id: string
    clipId: string
    createdAt: Date
    clip: { start: number | null; createdAt: Date } | null
    panels: Array<{
      id: string
      panelIndex: number
      panelSpeech: {
        id: string
        speaker: string
        originalContent: string
        deliveryContent: string | null
        estimatedDurationMs: number | null
        emotionPrompt: string | null
        emotionStrength: number | null
        updatedAt: Date
        audio: {
          audioUrl: string | null
          audioMediaId: string | null
          audioDuration: number | null
          voicePresetId: string | null
        } | null
      } | null
    }>
  }>
}>(episode: T, plans: Awaited<ReturnType<typeof listEpisodeSpeechPlans>>['plans']) {
  const planByPanelId = new Map(plans.map((plan) => [plan.panelId, plan]))
  const orderedStoryboards = [...episode.storyboards].sort((left, right) => (
    (left.clip?.start ?? Number.MAX_SAFE_INTEGER) - (right.clip?.start ?? Number.MAX_SAFE_INTEGER)
    || (left.clip?.createdAt.getTime() ?? 0) - (right.clip?.createdAt.getTime() ?? 0)
    || left.createdAt.getTime() - right.createdAt.getTime()
  ))
  let lineIndex = 1
  const voiceLines = orderedStoryboards.flatMap((storyboard) => (
    [...storyboard.panels]
      .sort((left, right) => left.panelIndex - right.panelIndex)
      .flatMap((panel) => {
        const speech = panel.panelSpeech
        if (!speech) return []
        const currentLineIndex = lineIndex
        lineIndex += 1
        return [{
          id: speech.id,
          speechId: speech.id,
          lineIndex: currentLineIndex,
          speaker: speech.speaker,
          content: speech.originalContent,
          deliveryContent: speech.deliveryContent,
          deliveryDurationMs: speech.deliveryContent ? speech.estimatedDurationMs : null,
          deliveryReason: null,
          deliveryUpdatedAt: speech.deliveryContent ? speech.updatedAt.toISOString() : null,
          emotionPrompt: speech.emotionPrompt,
          emotionStrength: speech.emotionStrength,
          audioUrl: speech.audio?.audioUrl || null,
          audioMediaId: speech.audio?.audioMediaId || null,
          audioDuration: speech.audio?.audioDuration || null,
          voicePresetId: speech.audio?.voicePresetId || null,
          matchedPanelId: panel.id,
          matchedStoryboardId: storyboard.id,
          matchedPanelIndex: panel.panelIndex,
          panelSpans: [],
        }]
      })
  ))
  const storyboards = episode.storyboards.map((storyboard) => ({
    ...storyboard,
    panels: storyboard.panels.map((panel) => ({
      ...panel,
      speechPlan: planByPanelId.get(panel.id) || null,
    })),
  }))

  return {
    ...episode,
    storyboards,
    voiceLines,
  }
}

/**
 * GET - 获取单个剧集的完整数据
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // 获取剧集及其关联数据
  let episode: Awaited<ReturnType<typeof findEpisodeWithStageData>>
  try {
    episode = await findEpisodeWithStageData(episodeId)
  } catch (error) {
    if (isPanelSpeechSchemaMissing(error)) {
      throw new ApiError('CONFLICT', {
        code: 'DB_SCHEMA_OUT_OF_DATE',
        message: '数据库缺少镜头级台词或配音产物表。请执行最新数据库迁移后重试。',
        table: 'novel_promotion_panel_speeches, novel_promotion_panel_speech_audios',
      })
    }
    throw error
  }

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  // 更新最后编辑的剧集ID（异步，不阻塞响应）
  prisma.novelPromotionProject.update({
    where: { projectId },
    data: { lastEpisodeId: episodeId }
  }).catch(err => _ulogError('更新 lastEpisodeId 失败:', err))

  const speechPlans = await listEpisodeSpeechPlans(episodeId)
  const episodeWithSpeechState = projectCanonicalSpeechState(episode, speechPlans.plans)

  // 转换为稳定媒体 URL（并保留兼容字段）
  const episodeWithSignedUrls = await attachMediaFieldsToProject(episodeWithSpeechState)

  return NextResponse.json({ episode: episodeWithSignedUrls })
})

/**
 * PATCH - 更新剧集信息
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  if (body?.workspaceCommand && typeof body.workspaceCommand === 'object') {
    try {
      const result = await executeWorkspaceArtifactCommand({
        projectId,
        episodeId,
        command: body.workspaceCommand as WorkspaceArtifactCommand,
        locale: request.headers.get('accept-language') || 'zh',
      })
      return NextResponse.json(result)
    } catch (error) {
      const message = error instanceof Error
        ? error.message.replace(/^WORKSPACE_COMMAND_INVALID:/, '')
        : 'Workspace command failed'
      throw new ApiError('INVALID_PARAMS', { message })
    }
  }
  const { name, description, novelText, audioUrl, srtContent } = body

  const updateData: Prisma.NovelPromotionEpisodeUncheckedUpdateInput = {}
  if (name !== undefined) updateData.name = name.trim()
  if (description !== undefined) updateData.description = description?.trim() || null
  if (novelText !== undefined) updateData.novelText = novelText
  if (audioUrl !== undefined) {
    updateData.audioUrl = audioUrl
    const media = await resolveMediaRefFromLegacyValue(audioUrl)
    updateData.audioMediaId = media?.id || null
  }
  if (srtContent !== undefined) updateData.srtContent = srtContent
  if (body.creativeBrief !== undefined) updateData.creativeBrief = body.creativeBrief
  if (body.contentPlan !== undefined) updateData.contentPlan = body.contentPlan
  if (body.contentReview !== undefined) updateData.contentReview = body.contentReview
  if (body.directorTreatment !== undefined) updateData.directorTreatment = body.directorTreatment
  if (body.productionBible !== undefined) updateData.productionBible = body.productionBible

  const episode = await prisma.novelPromotionEpisode.update({
    where: { id: episodeId },
    data: updateData
  })

  return NextResponse.json({ episode })
})

/**
 * DELETE - 删除剧集
 */
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // 删除剧集（关联数据会级联删除）
  await prisma.novelPromotionEpisode.delete({
    where: { id: episodeId }
  })

  // 如果删除的是最后编辑的剧集，更新 lastEpisodeId
  const novelPromotionProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId }
  })

  if (novelPromotionProject?.lastEpisodeId === episodeId) {
    // 找到另一个剧集作为默认
    const anotherEpisode = await prisma.novelPromotionEpisode.findFirst({
      where: { novelPromotionProjectId: novelPromotionProject.id },
      orderBy: { episodeNumber: 'asc' }
    })

    await prisma.novelPromotionProject.update({
      where: { id: novelPromotionProject.id },
      data: { lastEpisodeId: anotherEpisode?.id || null }
    })
  }

  return NextResponse.json({ success: true })
})

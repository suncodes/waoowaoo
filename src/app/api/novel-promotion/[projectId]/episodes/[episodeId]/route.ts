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
import { isPanelVoiceSpanTableMissing } from '@/lib/novel-promotion/panel-voice-spans'
import { isPanelSpeechPlanTableMissing } from '@/lib/novel-promotion/speech-plan'

function buildStageDataInclude(options: {
  includeVoiceSpans: boolean
  includeSpeechPlans: boolean
}) {
  const baseInclude = {
    clips: {
      orderBy: [{ start: 'asc' as const }, { createdAt: 'asc' as const }]
    },
    storyboards: {
      include: {
        clip: true,
        panels: {
          orderBy: { panelIndex: 'asc' as const },
          ...(options.includeSpeechPlans
            ? {
              include: {
                speechPlan: true,
              },
            }
            : {}),
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
    voiceLines: {
      orderBy: { lineIndex: 'asc' as const },
      ...(options.includeVoiceSpans
        ? {
          include: {
            panelSpans: {
              orderBy: { startMs: 'asc' as const },
              select: {
                panelId: true,
                startMs: true,
                endMs: true,
                voiceStartMs: true,
                voiceEndMs: true,
                segmentText: true,
                panel: {
                  select: {
                    storyboardId: true,
                    panelIndex: true
                  }
                }
              }
            }
          }
        }
        : {}),
    }
  }
}

async function findEpisodeWithStageData(episodeId: string) {
  try {
    return await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: buildStageDataInclude({ includeVoiceSpans: true, includeSpeechPlans: true })
    })
  } catch (error) {
    if (!isPanelSpeechPlanTableMissing(error) && !isPanelVoiceSpanTableMissing(error)) throw error
    const includeSpeechPlans = !isPanelSpeechPlanTableMissing(error)
    const includeVoiceSpans = !isPanelVoiceSpanTableMissing(error)
    try {
      return await prisma.novelPromotionEpisode.findUnique({
        where: { id: episodeId },
        include: buildStageDataInclude({ includeVoiceSpans, includeSpeechPlans })
      })
    } catch (fallbackError) {
      if (!isPanelSpeechPlanTableMissing(fallbackError) && !isPanelVoiceSpanTableMissing(fallbackError)) throw fallbackError
      return await prisma.novelPromotionEpisode.findUnique({
        where: { id: episodeId },
        include: buildStageDataInclude({ includeVoiceSpans: false, includeSpeechPlans: false })
      })
    }
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
  const episode = await findEpisodeWithStageData(episodeId)

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  // 更新最后编辑的剧集ID（异步，不阻塞响应）
  prisma.novelPromotionProject.update({
    where: { projectId },
    data: { lastEpisodeId: episodeId }
  }).catch(err => _ulogError('更新 lastEpisodeId 失败:', err))

  // 转换为稳定媒体 URL（并保留兼容字段）
  const episodeWithSignedUrls = await attachMediaFieldsToProject(episode)

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

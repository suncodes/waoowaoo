import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  ensureEpisodeSpeechPlans,
  listEpisodeSpeechPlans,
  rebuildEpisodeSpeechPlans,
} from '@/lib/novel-promotion/speech-plan'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

/**
 * GET /api/novel-promotion/[projectId]/speech-plans?episodeId=xxx
 * 获取镜头级台词与声音计划。若当前项目尚未生成计划，会基于现有台词和分镜做一次轻量重建。
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
  if (!episodeId) throw new ApiError('INVALID_PARAMS')

  await assertEpisodeBelongsToProject(projectId, episodeId)
  const result = await ensureEpisodeSpeechPlans(episodeId)
  return NextResponse.json(result)
})

/**
 * POST /api/novel-promotion/[projectId]/speech-plans
 * 基于已确认分镜和当前台词重建镜头级 SpeechPlan。
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
  if (!episodeId) throw new ApiError('INVALID_PARAMS')

  await assertEpisodeBelongsToProject(projectId, episodeId)
  const source = readTrimmedString(body?.source) || 'manual'
  const result = await rebuildEpisodeSpeechPlans(episodeId, source)
  if (!result.available) {
    throw new ApiError('CONFLICT', {
      code: 'DB_SCHEMA_OUT_OF_DATE',
      episodeId,
      message: '数据库结构不是最新版本，缺少镜头级台词计划表。请在部署环境执行 prisma db push 后重启应用。',
      table: 'novel_promotion_panel_speech_plans',
      available: false,
    })
  }

  const refreshed = await listEpisodeSpeechPlans(episodeId)
  return NextResponse.json({
    ...result,
    plans: refreshed.plans,
    summary: refreshed.summary,
  })
})

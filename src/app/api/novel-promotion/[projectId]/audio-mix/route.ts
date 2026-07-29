import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { hasPanelAudioMixOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { isPanelSpeechSchemaMissing } from '@/lib/novel-promotion/panel-speech'

type AudioMixBody = {
  all?: boolean
  force?: boolean
  episodeId?: string
  panelId?: string
  storyboardId?: string
  panelIndex?: number
  voiceLineIds?: unknown
}

type PanelCandidate = {
  id: string
  storyboardId: string
  panelIndex: number
  videoUrl: string | null
  videoMediaId: string | null
  audioMixedVideoUrl: string | null
  audioMixedVideoMediaId: string | null
  panelSpeech: {
    id: string
    audio: {
      audioUrl: string | null
      audioMediaId: string | null
    } | null
  } | null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter(isNonEmptyString).map((item) => item.trim())))
}

function hasVideo(panel: PanelCandidate): boolean {
  return isNonEmptyString(panel.videoUrl) || isNonEmptyString(panel.videoMediaId)
}

function hasAudioMixedOutput(panel: PanelCandidate): boolean {
  return isNonEmptyString(panel.audioMixedVideoUrl) || isNonEmptyString(panel.audioMixedVideoMediaId)
}

function buildSpeechDedupeSegment(speechIds: string[]) {
  if (speechIds.length === 0) return 'auto'
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([...speechIds].sort()))
    .digest('hex')
    .slice(0, 16)
}

function hasUsablePanelSpeechAudio(panel: PanelCandidate, speechIds: string[]): boolean {
  const speech = panel.panelSpeech
  if (!speech) return false
  if (speechIds.length > 0 && !speechIds.includes(speech.id)) return false
  return isNonEmptyString(speech.audio?.audioUrl) || isNonEmptyString(speech.audio?.audioMediaId)
}

async function assertPanelSpeechAudioSchemaAvailable() {
  try {
    await Promise.all([
      prisma.novelPromotionPanelSpeech.findFirst({ select: { id: true } }),
      prisma.novelPromotionPanelSpeechAudio.findFirst({ select: { id: true } }),
    ])
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
}

async function submitAudioMixTask(params: {
  request: NextRequest
  userId: string
  locale: ReturnType<typeof resolveRequiredTaskLocale>
  projectId: string
  episodeId: string
  panel: PanelCandidate
  speechIds: string[]
}) {
  const payload = {
    panelId: params.panel.id,
    speechIds: params.speechIds,
  }

  return await submitTask({
    userId: params.userId,
    locale: params.locale,
    requestId: getRequestId(params.request),
    projectId: params.projectId,
    episodeId: params.episodeId,
    type: TASK_TYPE.AUDIO_MIX,
    targetType: 'NovelPromotionPanel',
    targetId: params.panel.id,
    payload: withTaskUiPayload(payload, {
      hasOutputAtStart: await hasPanelAudioMixOutput(params.panel.id),
    }),
    dedupeKey: `audio_mix:${params.panel.id}:${buildSpeechDedupeSegment(params.speechIds)}`,
  })
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  await assertPanelSpeechAudioSchemaAvailable()

  const body = (await request.json()) as AudioMixBody
  const locale = resolveRequiredTaskLocale(request, body)
  const speechIds = normalizeStringArray(body.voiceLineIds)
  const force = body.force === true

  if (body.all === true) {
    const episodeId = isNonEmptyString(body.episodeId) ? body.episodeId.trim() : ''
    if (!episodeId) throw new ApiError('INVALID_PARAMS')

    const episode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: episodeId,
        novelPromotionProject: { projectId },
      },
      select: {
        id: true,
        storyboards: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            panels: {
              orderBy: { panelIndex: 'asc' },
              select: {
                id: true,
                storyboardId: true,
                panelIndex: true,
                videoUrl: true,
                videoMediaId: true,
                audioMixedVideoUrl: true,
                audioMixedVideoMediaId: true,
                panelSpeech: {
                  select: {
                    id: true,
                    audio: {
                      select: {
                        audioUrl: true,
                        audioMediaId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    if (!episode) throw new ApiError('NOT_FOUND')

    const reasonCounts: Record<string, number> = {}
    const skip = (reason: string) => {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
    }
    const targets: PanelCandidate[] = []

    for (const storyboard of episode.storyboards) {
      for (const panel of storyboard.panels) {
        if (!hasVideo(panel)) {
          skip('video_missing')
          continue
        }
        if (!force && hasAudioMixedOutput(panel)) {
          skip('audio_mix_exists')
          continue
        }
        if (!hasUsablePanelSpeechAudio(panel, [])) {
          skip('voice_audio_missing')
          continue
        }
        targets.push(panel)
      }
    }

    const tasks = await Promise.all(
      targets.map((panel) => submitAudioMixTask({
        request,
        userId: session.user.id,
        locale,
        projectId,
        episodeId: episode.id,
        panel,
        speechIds: [],
      })),
    )

    return NextResponse.json({
      success: true,
      async: true,
      tasks,
      total: targets.length,
      skipped: episode.storyboards.reduce((sum, storyboard) => sum + storyboard.panels.length, 0) - targets.length,
      reasonCounts,
    })
  }

  let panel: (PanelCandidate & { storyboard: { episodeId: string } }) | null = null
  if (isNonEmptyString(body.panelId)) {
    panel = await prisma.novelPromotionPanel.findFirst({
      where: {
        id: body.panelId.trim(),
        storyboard: {
          episode: {
            novelPromotionProject: { projectId },
          },
        },
      },
      select: {
        id: true,
        storyboardId: true,
        panelIndex: true,
        videoUrl: true,
        videoMediaId: true,
        audioMixedVideoUrl: true,
        audioMixedVideoMediaId: true,
        panelSpeech: {
          select: {
            id: true,
            audio: {
              select: {
                audioUrl: true,
                audioMediaId: true,
              },
            },
          },
        },
        storyboard: { select: { episodeId: true } },
      },
    })
  } else if (isNonEmptyString(body.storyboardId) && body.panelIndex !== undefined && body.panelIndex !== null) {
    panel = await prisma.novelPromotionPanel.findFirst({
      where: {
        storyboardId: body.storyboardId.trim(),
        panelIndex: Number(body.panelIndex),
        storyboard: {
          episode: {
            novelPromotionProject: { projectId },
          },
        },
      },
      select: {
        id: true,
        storyboardId: true,
        panelIndex: true,
        videoUrl: true,
        videoMediaId: true,
        audioMixedVideoUrl: true,
        audioMixedVideoMediaId: true,
        panelSpeech: {
          select: {
            id: true,
            audio: {
              select: {
                audioUrl: true,
                audioMediaId: true,
              },
            },
          },
        },
        storyboard: { select: { episodeId: true } },
      },
    })
  } else {
    throw new ApiError('INVALID_PARAMS')
  }

  if (!panel) throw new ApiError('NOT_FOUND')
  if (!hasVideo(panel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'AUDIO_MIX_VIDEO_MISSING',
      panelId: panel.id,
    })
  }

  if (!hasUsablePanelSpeechAudio(panel, speechIds)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'AUDIO_MIX_AUDIO_MISSING',
      panelId: panel.id,
    })
  }

  const result = await submitAudioMixTask({
    request,
    userId: session.user.id,
    locale,
    projectId,
    episodeId: panel.storyboard.episodeId,
    panel,
    speechIds,
  })

  return NextResponse.json(result)
})

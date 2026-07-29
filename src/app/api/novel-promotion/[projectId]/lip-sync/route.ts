import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { hasPanelLipSyncOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { composeModelKey, parseModelKeyStrict } from '@/lib/model-config-contract'
import { isPanelSpeechSchemaMissing } from '@/lib/novel-promotion/panel-speech'

const DEFAULT_LIPSYNC_MODEL_KEY = composeModelKey('fal', 'fal-ai/kling-video/lipsync/audio-to-video')

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

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  await assertPanelSpeechAudioSchemaAvailable()

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const storyboardId = body?.storyboardId
  const panelIndex = body?.panelIndex
  const speechId = typeof body?.speechId === 'string'
    ? body.speechId.trim()
    : typeof body?.voiceLineId === 'string'
      ? body.voiceLineId.trim()
      : ''
  const requestedLipSyncModel = typeof body?.lipSyncModel === 'string' ? body.lipSyncModel.trim() : ''

  if (!storyboardId || panelIndex === undefined || !speechId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (requestedLipSyncModel && !parseModelKeyStrict(requestedLipSyncModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'lipSyncModel',
    })
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { lipSyncModel: true },
  })
  const preferredLipSyncModel = typeof pref?.lipSyncModel === 'string' ? pref.lipSyncModel.trim() : ''
  const resolvedLipSyncModel = requestedLipSyncModel || preferredLipSyncModel || DEFAULT_LIPSYNC_MODEL_KEY
  if (!parseModelKeyStrict(resolvedLipSyncModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'lipSyncModel',
    })
  }

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId,
      panelIndex: Number(panelIndex),
      storyboard: {
        episode: {
          novelPromotionProject: { projectId },
        },
      },
    },
    select: { id: true },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }
  const speech = await prisma.novelPromotionPanelSpeech.findFirst({
    where: {
      id: speechId,
      panelId: panel.id,
      audio: {
        is: {
          OR: [
            { audioUrl: { not: null } },
            { audioMediaId: { not: null } },
          ],
        },
      },
    },
    select: { id: true },
  })
  if (!speech) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'LIP_SYNC_SPEECH_AUDIO_MISSING',
      message: '当前镜头缺少可用的镜头级台词音频。',
    })
  }

  const payload = {
    ...body,
    speechId: speech.id,
    lipSyncModel: resolvedLipSyncModel,
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.LIP_SYNC,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(payload, {
      hasOutputAtStart: await hasPanelLipSyncOutput(panel.id),
    }),
    dedupeKey: `lip_sync:${panel.id}:${speech.id}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.LIP_SYNC, payload),
  })

  return NextResponse.json(result)
})

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { estimateVoiceLineMaxSeconds } from '@/lib/voice/generate-voice-line'
import { hasPanelSpeechAudioOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import {
  isPanelSpeechSchemaMissing,
  resolvePanelSpeechText,
} from '@/lib/novel-promotion/panel-speech'
import {
  hasVoiceBindingForProvider,
  parseSpeakerVoiceMap,
  type CharacterVoiceFields,
  type SpeakerVoiceMap,
} from '@/lib/voice/provider-voice-binding'

type PanelSpeechRow = {
  id: string
  speaker: string
  originalContent: string
  deliveryContent: string | null
}

type CharacterRow = CharacterVoiceFields & {
  name: string
}

type VoiceBindingValidationResult =
  | { ok: true }
  | { ok: false; message: string }

function matchCharacterBySpeaker(speaker: string, characters: CharacterRow[]) {
  const normalizedSpeaker = speaker.trim().toLowerCase()
  return characters.find((character) => character.name.trim().toLowerCase() === normalizedSpeaker) || null
}

function validateSpeakerVoiceForProvider(
  speaker: string,
  characters: CharacterRow[],
  speakerVoices: SpeakerVoiceMap,
  providerKey: string,
): VoiceBindingValidationResult {
  const character = matchCharacterBySpeaker(speaker, characters)
  const speakerVoice = speakerVoices[speaker]

  if (hasVoiceBindingForProvider({
    providerKey,
    character,
    speakerVoice,
  })) {
    return { ok: true }
  }

  if (providerKey === 'bailian') {
    const hasUploadedReference =
      !!character?.customVoiceUrl ||
      (speakerVoice?.provider === 'fal' && !!speakerVoice.audioUrl)
    if (hasUploadedReference) {
      return {
        ok: false,
        message: '无音色ID，QwenTTS 必须使用 AI 设计音色',
      }
    }
    return {
      ok: false,
      message: '请先为该发言人绑定百炼音色',
    }
  }

  return {
    ok: false,
    message: '请先为该发言人设置参考音频',
  }
}

function hasSpeakerVoiceForProvider(
  speaker: string,
  characters: CharacterRow[],
  speakerVoices: SpeakerVoiceMap,
  providerKey: string,
): boolean {
  const character = matchCharacterBySpeaker(speaker, characters)
  const speakerVoice = speakerVoices[speaker]
  return hasVoiceBindingForProvider({
    providerKey,
    character,
    speakerVoice,
  })
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

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  await assertPanelSpeechAudioSchemaAvailable()

  const body = await request.json().catch(() => null)
  const locale = resolveRequiredTaskLocale(request, body)
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId : ''
  const lineId = typeof body?.lineId === 'string' ? body.lineId : ''
  const requestedAudioModel = typeof body?.audioModel === 'string' ? body.audioModel.trim() : ''
  const all = body?.all === true

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!all && !lineId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (requestedAudioModel && !parseModelKeyStrict(requestedAudioModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'audioModel'})
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { audioModel: true },
  })
  const preferredAudioModel = typeof pref?.audioModel === 'string' ? pref.audioModel.trim() : ''
  if (preferredAudioModel && !parseModelKeyStrict(preferredAudioModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'audioModel'})
  }
  const projectData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: {
      id: true,
      audioModel: true,
      characters: {
        select: {
          name: true,
          customVoiceUrl: true,
          voiceId: true,
        },
      },
    },
  })
  if (!projectData) {
    throw new ApiError('NOT_FOUND')
  }
  const projectAudioModel = typeof projectData.audioModel === 'string' ? projectData.audioModel.trim() : ''
  if (projectAudioModel && !parseModelKeyStrict(projectAudioModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'audioModel'})
  }
  const resolvedAudioModel = requestedAudioModel || projectAudioModel || preferredAudioModel
  const selectedResolvedAudioModel = await resolveModelSelectionOrSingle(
    session.user.id,
    resolvedAudioModel || null,
    'audio',
  )
  const selectedProviderKey = getProviderKey(selectedResolvedAudioModel.provider).toLowerCase()

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProjectId: projectData.id},
    select: {
      id: true,
      speakerVoices: true}})
  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const speakerVoices = parseSpeakerVoiceMap(episode.speakerVoices)
  const characters = projectData.characters || []

  let speeches: PanelSpeechRow[] = []
  if (all) {
    const allSpeeches = await prisma.novelPromotionPanelSpeech.findMany({
      where: {
        episodeId,
        status: 'ready',
        OR: [
          { audio: { is: null } },
          {
            audio: {
              is: {
                audioUrl: null,
                audioMediaId: null,
              },
            },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        speaker: true,
        originalContent: true,
        deliveryContent: true,
      },
    })
    speeches = allSpeeches.filter((speech) =>
      hasSpeakerVoiceForProvider(speech.speaker, characters, speakerVoices, selectedProviderKey),
    )
  } else {
    const speech = await prisma.novelPromotionPanelSpeech.findFirst({
      where: {
        id: lineId,
        episodeId,
      },
      select: {
        id: true,
        speaker: true,
        originalContent: true,
        deliveryContent: true,
      },
    })
    if (!speech) {
      throw new ApiError('NOT_FOUND')
    }
    const validation = validateSpeakerVoiceForProvider(
      speech.speaker,
      characters,
      speakerVoices,
      selectedProviderKey,
    )
    if (!validation.ok) {
      throw new ApiError('INVALID_PARAMS', {
        message: validation.message,
      })
    }
    speeches = [speech]
  }

  if (speeches.length === 0) {
    if (all) {
      const firstSpeechWithoutBinding = await prisma.novelPromotionPanelSpeech.findFirst({
        where: {
          episodeId,
          status: 'ready',
          OR: [
            { audio: { is: null } },
            {
              audio: {
                is: {
                  audioUrl: null,
                  audioMediaId: null,
                },
              },
            },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          speaker: true,
        },
      })
      const validation = firstSpeechWithoutBinding
        ? validateSpeakerVoiceForProvider(
          firstSpeechWithoutBinding.speaker,
          characters,
          speakerVoices,
          selectedProviderKey,
        )
        : { ok: false as const, message: '没有需要生成的台词' }
      return NextResponse.json({
        success: true,
        async: true,
        results: [],
        taskIds: [],
        total: 0,
        ...(validation.ok ? {} : { error: validation.message }),
      })
    }
    throw new ApiError('INVALID_PARAMS', {
      message: '没有需要生成的台词',
    })
  }

  const results = await Promise.all(
    speeches.map(async (speech) => {
      const payload = {
        episodeId,
        speechId: speech.id,
        maxSeconds: estimateVoiceLineMaxSeconds(resolvePanelSpeechText(speech)),
        audioModel: selectedResolvedAudioModel.modelKey,
      }
      const result = await submitTask({
        userId: session.user.id,
        locale,
        requestId: getRequestId(request),
        projectId,
        episodeId,
        type: TASK_TYPE.VOICE_LINE,
        targetType: 'NovelPromotionPanelSpeech',
        targetId: speech.id,
        payload: withTaskUiPayload(payload, {
          hasOutputAtStart: await hasPanelSpeechAudioOutput(speech.id),
        }),
        dedupeKey: `panel_speech_audio:${speech.id}`,
        billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, payload),
      })

      return {
        lineId: speech.id,
        taskId: result.taskId,
      }
    }),
  )

  if (all) {
    return NextResponse.json({
      success: true,
      async: true,
      results,
      taskIds: results.map((item) => item.taskId),
      total: results.length})
  }

  return NextResponse.json({
    success: true,
    async: true,
    taskId: results[0].taskId})
})

import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { buildImageBillingPayload } from '@/lib/config-service'
import {
  hasCharacterAppearanceOutput,
  hasLocationImageOutput
} from '@/lib/task/has-output'
import { PreparedPromptError, requirePreparedPrompt } from '@/lib/creative-quality/prepared-prompts'
import { prisma } from '@/lib/prisma'

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const type = body?.type
  const id = body?.id
  const appearanceId = body?.appearanceId
  const imageIndex = body?.imageIndex

  if (!type || !id || imageIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (type !== 'character' && type !== 'location') {
    throw new ApiError('INVALID_PARAMS')
  }

  const parsedImageIndex = toNumber(imageIndex)
  if (parsedImageIndex === null || parsedImageIndex < 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  const taskType = type === 'character' ? TASK_TYPE.IMAGE_CHARACTER : TASK_TYPE.IMAGE_LOCATION
  const targetType = type === 'character' ? 'CharacterAppearance' : 'LocationImage'
  const targetId = type === 'character' ? (appearanceId || id) : id
  let preparedTargetId = targetId
  let preparedRefId = `${targetId}:${Math.floor(parsedImageIndex)}`
  if (type === 'location') {
    const locationImage = await prisma.locationImage.findFirst({
      where: {
        locationId: id,
        imageIndex: Math.floor(parsedImageIndex),
        location: { novelPromotionProject: { projectId } },
      },
      select: { id: true },
    })
    if (!locationImage) throw new ApiError('NOT_FOUND')
    preparedTargetId = locationImage.id
    preparedRefId = locationImage.id
  }

  let preparedPrompt
  try {
    preparedPrompt = await requirePreparedPrompt({
      artifactId: typeof body?.preparedPromptArtifactId === 'string'
        ? body.preparedPromptArtifactId
        : type === 'character'
          ? body?.preparedPromptArtifactIds?.[String(Math.floor(parsedImageIndex))]
          : body?.preparedPromptArtifactIds?.[preparedTargetId],
      projectId,
      targetId: preparedTargetId,
      refId: preparedRefId,
      kind: 'asset_image',
      userId: session.user.id,
    })
  } catch (error) {
    if (error instanceof PreparedPromptError) {
      throw new ApiError('CONFLICT', { code: error.code, message: error.message })
    }
    throw error
  }

  const hasOutputAtStart = type === 'character'
    ? await hasCharacterAppearanceOutput({
      appearanceId: targetId,
      characterId: id
    })
    : await hasLocationImageOutput({
      locationId: id,
      imageIndex: parsedImageIndex
    })

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId,
      userId: session.user.id,
      imageModel: preparedPrompt.snapshot.modelKey,
      basePayload: {
        ...body,
        imageModel: preparedPrompt.snapshot.modelKey,
        generationOptions: preparedPrompt.generationOptions,
        preparedPromptArtifactIds: type === 'character'
          ? { [String(Math.floor(parsedImageIndex))]: preparedPrompt.artifactId }
          : { [preparedTargetId]: preparedPrompt.artifactId },
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }
  billingPayload = {
    ...billingPayload,
    imageModel: preparedPrompt.snapshot.modelKey,
    generationOptions: preparedPrompt.generationOptions,
    preparedPromptArtifactIds: type === 'character'
      ? { [String(Math.floor(parsedImageIndex))]: preparedPrompt.artifactId }
      : { [preparedTargetId]: preparedPrompt.artifactId },
  }
  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: taskType,
    targetType,
    targetId,
    payload: withTaskUiPayload(billingPayload, {
      intent: 'regenerate',
      hasOutputAtStart
    }),
    dedupeKey: `${taskType}:${targetId}:single:${imageIndex}:${preparedPrompt.artifactId}`,
    billingInfo: buildDefaultTaskBillingInfo(taskType, billingPayload)
  })

  return NextResponse.json(result)
})

import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { hasPanelImageOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { resolveModelSelection } from '@/lib/api-config'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { PreparedPromptError, requireCurrentPanelImagePreparedPrompt } from '@/lib/creative-quality/prepared-prompts'

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
  const panelId = body?.panelId
  const count = body?.count
  const candidateCount = normalizeImageGenerationCount('storyboard-candidates', count)
  const forceNoReference = body?.forceNoReference === true

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  let preparedPrompt
  try {
    preparedPrompt = await requireCurrentPanelImagePreparedPrompt({
      artifactId: body?.preparedPromptArtifactId,
      projectId,
      targetId: panelId,
      userId: session.user.id,
    })
  } catch (error) {
    if (error instanceof PreparedPromptError) {
      throw new ApiError('CONFLICT', { code: error.code, message: error.message })
    }
    throw error
  }

  try {
    await resolveModelSelection(session.user.id, preparedPrompt.snapshot.modelKey, 'image')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storyboard image model is invalid'
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_INVALID',
      message})
  }

  const billingPayload = {
    ...body,
    candidateCount,
    forceNoReference,
    preparedPromptArtifactId: preparedPrompt.artifactId,
    imageModel: preparedPrompt.snapshot.modelKey,
    generationOptions: preparedPrompt.generationOptions,
  }

  const hasOutputAtStart = await hasPanelImageOutput(panelId)

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.IMAGE_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: panelId,
    payload: withTaskUiPayload(billingPayload, {
      intent: 'regenerate',
      hasOutputAtStart}),
    dedupeKey: `image_panel:${panelId}:${preparedPrompt.artifactId}:${candidateCount}${forceNoReference ? ':force_no_reference' : ''}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload)})

  return NextResponse.json(result)
})

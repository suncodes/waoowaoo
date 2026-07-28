import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import {
  DELIVERY_LINES_ERROR,
  DeliveryLinesError,
  generateEpisodeDeliveryLines,
} from '@/lib/novel-promotion/delivery-lines'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapDeliveryLinesError(error: DeliveryLinesError): ApiError {
  if (error.code === DELIVERY_LINES_ERROR.EPISODE_NOT_FOUND) {
    return new ApiError('NOT_FOUND', { message: error.message })
  }
  if (error.code === DELIVERY_LINES_ERROR.MISSING_ANALYSIS_MODEL) {
    return new ApiError('MISSING_CONFIG', { message: error.message })
  }
  if (error.code === DELIVERY_LINES_ERROR.DB_SCHEMA_OUT_OF_DATE) {
    return new ApiError('CONFLICT', {
      code: 'DB_SCHEMA_OUT_OF_DATE',
      message: error.message,
      table: 'novel_promotion_panel_speech_plans',
      available: false,
    })
  }
  return new ApiError('EMPTY_RESPONSE', { message: error.message })
}

/**
 * POST /api/novel-promotion/[projectId]/delivery-lines
 * 基于当前镜头级台词计划生成口播版台词，只写入 speech plan 的 deliveryContent，不覆盖原始台词。
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => null)
  const episodeId = readTrimmedString(body?.episodeId)
  if (!episodeId) throw new ApiError('INVALID_PARAMS')

  try {
    const result = await generateEpisodeDeliveryLines({
      projectId,
      episodeId,
      userId: session.user.id,
      locale: request.headers.get('accept-language'),
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof DeliveryLinesError) {
      throw mapDeliveryLinesError(error)
    }
    throw error
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  buildPanelImageGenerationPromptPreview,
  buildPanelVideoGenerationPromptPreview,
  PanelPromptPreviewError,
  type PanelGenerationPromptPreviewMode,
} from '@/lib/novel-promotion/panel-generation-prompt-preview'

export const runtime = 'nodejs'

function readMode(value: unknown): PanelGenerationPromptPreviewMode {
  if (value === 'image' || value === 'video' || value === 'firstlastframe') return value
  throw new ApiError('INVALID_PARAMS', {
    code: 'PROMPT_PREVIEW_MODE_INVALID',
    field: 'mode',
  })
}

function hasPanelLocator(body: Record<string, unknown>): boolean {
  if (typeof body.panelId === 'string' && body.panelId.trim()) return true
  return typeof body.storyboardId === 'string'
    && body.storyboardId.trim().length > 0
    && body.panelIndex !== undefined
    && body.panelIndex !== null
}

function mapPromptPreviewError(error: unknown): never {
  if (error instanceof PanelPromptPreviewError) {
    if (error.code === 'PANEL_NOT_FOUND' || error.code === 'PROJECT_NOT_FOUND') {
      throw new ApiError('NOT_FOUND')
    }
  }
  throw error
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const mode = readMode(body.mode)
  if (!hasPanelLocator(body)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_PREVIEW_PANEL_LOCATOR_REQUIRED',
      field: 'panelId',
    })
  }
  const locale = resolveRequiredTaskLocale(request, body)

  try {
    const locator = {
      panelId: typeof body.panelId === 'string' ? body.panelId : null,
      storyboardId: typeof body.storyboardId === 'string' ? body.storyboardId : null,
      panelIndex: typeof body.panelIndex === 'number' || typeof body.panelIndex === 'string'
        ? body.panelIndex
        : null,
    }
    const overrides = body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)
      ? body.overrides
      : undefined

    if (mode === 'image') {
      const preview = await buildPanelImageGenerationPromptPreview({
        projectId,
        userId: session.user.id,
        locale,
        locator,
        overrides,
        forceNoReference: body.forceNoReference === true,
      })
      return NextResponse.json({ success: true, preview })
    }

    const preview = await buildPanelVideoGenerationPromptPreview({
      projectId,
      userId: session.user.id,
      locale,
      locator,
      mode,
      videoModel: typeof body.videoModel === 'string' ? body.videoModel : null,
      generationOptions: body.generationOptions,
      overrides,
    })
    return NextResponse.json({ success: true, preview })
  } catch (error) {
    mapPromptPreviewError(error)
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import {
  getLatestPreparedPrompts,
  type PreparedPromptKind,
  type PreparedPromptLookup,
} from '@/lib/creative-quality/prepared-prompts'

export const runtime = 'nodejs'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readKind(value: unknown): PreparedPromptKind | null {
  if (value === 'asset_image' || value === 'panel_image' || value === 'panel_video') return value
  return null
}

function readLookups(value: unknown): PreparedPromptLookup[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new ApiError('INVALID_PARAMS', { code: 'PREPARED_PROMPT_LOOKUPS_INVALID' })
  }

  const lookups: PreparedPromptLookup[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError('INVALID_PARAMS', { code: 'PREPARED_PROMPT_LOOKUP_INVALID' })
    }
    const record = item as Record<string, unknown>
    const kind = readKind(record.kind)
    const targetId = readString(record.targetId)
    if (!kind || !targetId) {
      throw new ApiError('INVALID_PARAMS', { code: 'PREPARED_PROMPT_LOOKUP_INVALID' })
    }
    const refId = readString(record.refId)
    const generationMode = readString(record.generationMode)
    lookups.push({
      kind,
      targetId,
      ...(refId ? { refId } : {}),
      ...(generationMode ? { generationMode } : {}),
    })
  }
  return lookups
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
  const lookups = readLookups(body?.lookups)
  const preparedPrompts = await getLatestPreparedPrompts({
    projectId,
    lookups,
    userId: session.user.id,
  })

  return NextResponse.json({
    preparedPrompts: preparedPrompts.map((prepared) => ({
      artifactId: prepared.artifactId,
      kind: prepared.kind,
      refId: prepared.refId,
      targetId: prepared.targetId,
      generationMode: prepared.generationMode,
      generationOptions: prepared.generationOptions,
      preparedAt: prepared.preparedAt,
    })),
  })
})

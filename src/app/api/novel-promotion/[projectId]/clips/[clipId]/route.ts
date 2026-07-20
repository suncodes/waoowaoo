import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { updateWorkspaceScriptClip } from '@/lib/creation-workspace/server-commands'

/**
 * PATCH /api/novel-promotion/[projectId]/clips/[clipId]
 * 更新单个 Clip 的信息
 * 支持更新：characters, location, props, content, screenplay
 */
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string; clipId: string }> }
) => {
    const { projectId, clipId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    let clip: unknown
    try {
        clip = await updateWorkspaceScriptClip({
            projectId,
            clipId,
            updates: body && typeof body === 'object' ? body : {},
        })
    } catch (error) {
        const message = error instanceof Error
            ? error.message.replace(/^WORKSPACE_COMMAND_INVALID:/, '')
            : 'Clip update failed'
        throw new ApiError('INVALID_PARAMS', { message })
    }

    return NextResponse.json({ success: true, clip })
})

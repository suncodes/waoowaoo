import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest } from 'next/server'
import { getSignedUrl, toFetchableUrl } from '@/lib/storage'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * 代理下载单个视频文件
 * 用于解决 COS 跨域下载问题
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const { searchParams } = new URL(request.url)
    const videoKey = searchParams.get('key')
    const download = searchParams.get('download') === '1'
    const filename = searchParams.get('filename')

    if (!videoKey) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    // 生成签名 URL 并下载
    let fetchUrl: string
    if (videoKey.startsWith('http://') || videoKey.startsWith('https://')) {
        fetchUrl = videoKey
    } else {
        fetchUrl = toFetchableUrl(getSignedUrl(videoKey, 3600))
    }

    _ulogInfo(`[视频代理] 下载: ${fetchUrl.substring(0, 100)}...`)

    const range = request.headers.get('range')
    const upstreamHeaders: HeadersInit = range ? { Range: range } : {}
    const response = await fetch(fetchUrl, { headers: upstreamHeaders })
    if (!response.ok && response.status !== 416) {
        throw new Error(`Failed to fetch video: ${response.statusText}`)
    }

    const headers = new Headers()
    headers.set('Content-Type', response.headers.get('content-type') || 'video/mp4')
    headers.set('Accept-Ranges', response.headers.get('accept-ranges') || 'bytes')
    headers.set('Vary', 'Range')
    headers.set('Cache-Control', download ? 'private, no-store' : 'private, max-age=3600')

    for (const headerName of ['content-length', 'content-range', 'etag', 'last-modified']) {
        const headerValue = response.headers.get(headerName)
        if (headerValue) headers.set(headerName, headerValue)
    }

    if (download) {
        const safeFilename = filename?.trim().replace(/[\\/:*?"<>|]/g, '_')
        if (safeFilename) {
            headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`)
        } else {
            headers.set('Content-Disposition', 'attachment')
        }
    }

    return new Response(response.body, { status: response.status, headers })
})

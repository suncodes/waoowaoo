import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  getEpisodeSubtitleTrackState,
  prepareEpisodeSubtitleTrack,
  type SubtitleTrackSnapshot,
} from '@/lib/novel-promotion/subtitle-track'

interface SubtitleTrackBody {
  episodeId?: string
  panelPreferences?: Record<string, boolean>
  style?: unknown
}

function normalizePanelPreferences(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, boolean> = {}
  for (const [key, selected] of Object.entries(value as Record<string, unknown>)) {
    if (typeof selected === 'boolean') result[key] = selected
  }
  return result
}

function downloadUrl(projectId: string, storageKey: string | null, fileName: string): string | null {
  if (!storageKey) return null
  return `/api/novel-promotion/${projectId}/video-proxy?key=${encodeURIComponent(storageKey)}&download=1&filename=${encodeURIComponent(fileName)}`
}

function serializeTrack(projectId: string, projectName: string, track: SubtitleTrackSnapshot | null) {
  if (!track) return null
  const safeName = projectName.trim().replace(/[\\/:*?"<>|]/g, '_') || 'subtitles'
  return {
    ...track,
    srtDownloadUrl: downloadUrl(projectId, track.srtStorageKey, `${safeName}_subtitles.srt`),
    assDownloadUrl: downloadUrl(projectId, track.assStorageKey, `${safeName}_subtitles.ass`),
    burnedVideoDownloadUrl: downloadUrl(projectId, track.burnedVideoStorageKey, `${safeName}_merged_subtitled.mp4`),
  }
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')?.trim() || ''
  if (!episodeId) throw new ApiError('INVALID_PARAMS')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const state = await getEpisodeSubtitleTrackState({ projectId, episodeId })
  return NextResponse.json({
    available: state.available,
    track: serializeTrack(projectId, state.projectName, state.track),
    stale: state.stale,
    preview: state.preview,
    message: state.available ? null : 'novel_promotion_subtitle_tracks table is not available; run database migrations.',
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = (await request.json()) as SubtitleTrackBody
  const episodeId = typeof body.episodeId === 'string' ? body.episodeId.trim() : ''
  if (!episodeId) throw new ApiError('INVALID_PARAMS')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const prepared = await prepareEpisodeSubtitleTrack({
    projectId,
    episodeId,
    panelPreferences: normalizePanelPreferences(body.panelPreferences),
    style: body.style,
  })
  return NextResponse.json({
    available: prepared.available,
    track: serializeTrack(projectId, prepared.source.projectName, prepared.track),
    preview: prepared.draft,
    stale: false,
    message: prepared.available ? null : 'novel_promotion_subtitle_tracks table is not available; run database migrations.',
  })
})

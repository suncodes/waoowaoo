import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import archiver from 'archiver'
import { getObjectBuffer, toFetchableUrl } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  buildVideoFileName,
  collectOrderedVideoCandidates,
  type VideoDownloadEpisodeData,
} from '@/lib/novel-promotion/video-download-candidates'

interface EpisodeQueryBody {
  episodeId?: string
  panelPreferences?: Record<string, boolean>
}

async function downloadVideoBuffer(videoUrl: string): Promise<Buffer> {
  const storageKey = await resolveStorageKeyFromMediaValue(videoUrl)

  if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
    const response = await fetch(toFetchableUrl(videoUrl))
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  if (storageKey) {
    return await getObjectBuffer(storageKey)
  }

  const response = await fetch(toFetchableUrl(videoUrl))
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = (await request.json()) as EpisodeQueryBody
  const { episodeId, panelPreferences } = body

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { project } = authResult

  let episodes: VideoDownloadEpisodeData[] = []

  if (episodeId) {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        storyboards: {
          include: {
            panels: { orderBy: { panelIndex: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        },
        clips: {
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (episode) {
      episodes = [episode]
    }
  } else {
    const npData = await prisma.novelPromotionProject.findFirst({
      where: { projectId },
      include: {
        episodes: {
          include: {
            storyboards: {
              include: {
                panels: { orderBy: { panelIndex: 'asc' } },
              },
              orderBy: { createdAt: 'asc' },
            },
            clips: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    })
    episodes = (npData?.episodes || []) as VideoDownloadEpisodeData[]
  }

  if (episodes.length === 0) {
    throw new ApiError('NOT_FOUND')
  }

  const candidates = collectOrderedVideoCandidates(episodes, panelPreferences)
  if (candidates.length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  const indexedVideos = candidates.map((candidate, index) => ({
    ...candidate,
    index: index + 1,
    fileName: buildVideoFileName(index + 1, candidate.description),
  }))

  _ulogInfo(`Preparing to download ${indexedVideos.length} videos for project ${projectId}`)

  const archive = archiver('zip', { zlib: { level: 9 } })
  const archiveFinished = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve())
    archive.on('error', (err) => {
      reject(err)
    })
  })

  const chunks: Uint8Array[] = []
  archive.on('data', (chunk) => {
    chunks.push(chunk)
  })

  for (const video of indexedVideos) {
    try {
      _ulogInfo(`Downloading video ${video.index}: ${video.videoUrl}`)
      const videoData = await downloadVideoBuffer(video.videoUrl)
      archive.append(videoData, { name: video.fileName })
      _ulogInfo(`Added ${video.fileName} to archive`)
    } catch (error) {
      _ulogError(`Failed to download video ${video.index}:`, error)
    }
  }

  await archive.finalize()
  _ulogInfo('Archive finalized')

  await archiveFinished

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return new Response(result, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(project.name)}_videos.zip"`,
    },
  })
})


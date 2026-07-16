import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
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
  const videos = candidates.map((candidate, index) => ({
    index: index + 1,
    fileName: buildVideoFileName(index + 1, candidate.description),
    videoUrl: `/api/novel-promotion/${projectId}/video-proxy?key=${encodeURIComponent(candidate.videoUrl)}`,
  }))

  if (videos.length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  return NextResponse.json({
    projectName: project.name,
    videos,
  })
})


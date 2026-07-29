import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import archiver from 'archiver'
import { getObjectBuffer, toFetchableUrl } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get('episodeId')

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { project } = authResult

  const panelSpeeches = await prisma.novelPromotionPanelSpeech.findMany({
    where: {
      ...(episodeId ? { episodeId } : {}),
      episode: {
        novelPromotionProject: { projectId },
      },
      audio: {
        is: {
          OR: [
            { audioUrl: { not: null } },
            { audioMediaId: { not: null } },
          ],
        },
      },
    },
    select: {
      id: true,
      speaker: true,
      originalContent: true,
      deliveryContent: true,
      audio: {
        select: {
          audioUrl: true,
          audioMedia: { select: { storageKey: true } },
        },
      },
      panel: {
        select: {
          panelIndex: true,
          storyboard: {
            select: {
              createdAt: true,
              clip: {
                select: {
                  start: true,
                  createdAt: true,
                },
              },
              episode: {
                select: { episodeNumber: true },
              },
            },
          },
        },
      },
    },
  })

  const speeches = [...panelSpeeches].sort((left, right) => (
    left.panel.storyboard.episode.episodeNumber - right.panel.storyboard.episode.episodeNumber
    || (left.panel.storyboard.clip?.start ?? Number.MAX_SAFE_INTEGER) - (right.panel.storyboard.clip?.start ?? Number.MAX_SAFE_INTEGER)
    || (left.panel.storyboard.clip?.createdAt.getTime() ?? 0) - (right.panel.storyboard.clip?.createdAt.getTime() ?? 0)
    || left.panel.storyboard.createdAt.getTime() - right.panel.storyboard.createdAt.getTime()
    || left.panel.panelIndex - right.panel.panelIndex
  ))

  if (speeches.length === 0) {
    throw new ApiError('NOT_FOUND')
  }

  _ulogInfo(`Preparing to download ${speeches.length} panel speech audio files for project ${projectId}`)

  const archive = archiver('zip', { zlib: { level: 9 } })

  const stream = new ReadableStream({
    start(controller) {
      archive.on('data', (chunk) => controller.enqueue(chunk))
      archive.on('end', () => controller.close())
      archive.on('error', (err) => controller.error(err))
      processVoices()
    }
  })

  async function processVoices() {
    for (const [index, speech] of speeches.entries()) {
      try {
        const audioUrl = speech.audio?.audioUrl
        const storageKey = speech.audio?.audioMedia?.storageKey
          || (audioUrl ? await resolveStorageKeyFromMediaValue(audioUrl) : null)
        if (!audioUrl && !storageKey) continue

        _ulogInfo(`Downloading panel speech ${speech.id}`)

        let audioData: Buffer

        if (storageKey) {
          audioData = await getObjectBuffer(storageKey)
        } else if (audioUrl?.startsWith('http://') || audioUrl?.startsWith('https://')) {
          const response = await fetch(toFetchableUrl(audioUrl))
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`)
          }
          const arrayBuffer = await response.arrayBuffer()
          audioData = Buffer.from(arrayBuffer)
        } else {
          const response = await fetch(toFetchableUrl(audioUrl!))
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`)
          }
          const arrayBuffer = await response.arrayBuffer()
          audioData = Buffer.from(arrayBuffer)
        }

        // 清理发言人名称中的非法字符
        const safeSpeaker = speech.speaker.replace(/[\\/:*?"<>|]/g, '_')

        const content = speech.deliveryContent || speech.originalContent
        const safeContent = content.slice(0, 15).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')

        const extSource = storageKey || audioUrl || ''
        const ext = extSource.endsWith('.wav') ? 'wav' : 'mp3'

        const fileName = `${String(index + 1).padStart(3, '0')}_${safeSpeaker}_${safeContent}.${ext}`

        archive.append(audioData, { name: fileName })
        _ulogInfo(`Added ${fileName} to archive`)
      } catch (error) {
        _ulogError(`Failed to download panel speech ${speech.id}:`, error)
      }
    }

    await archive.finalize()
    _ulogInfo('Archive finalized')
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(project.name)}_voices.zip"`
    }
  })
})

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer, toFetchableUrl, uploadObject } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import {
  collectOrderedVideoCandidates,
  type OrderedVideoCandidate,
  type VideoDownloadEpisodeData,
} from './video-download-candidates'

export interface MissingVideoPanel {
  storyboardId: string
  panelKey: string
  panelIndex: number
  description: string
}

export interface VideoMergeExportInput {
  projectId: string
  episodeId?: string | null
  panelPreferences?: Record<string, boolean> | null
}

export interface VideoMergeExportResult {
  outputKey: string
  outputUrl: string
  downloadUrl: string
  fileName: string
  videoCount: number
  sizeBytes: number
}

interface LoadedMergeSource {
  projectName: string
  videoRatio: string
  episodes: VideoDownloadEpisodeData[]
  candidates: OrderedVideoCandidate[]
  missingPanels: MissingVideoPanel[]
}

interface MergeProgressReporter {
  (progress: number, payload?: Record<string, unknown>): Promise<void>
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sanitizeFileName(value: string): string {
  const normalized = value.trim().slice(0, 80)
  return normalized.replace(/[\\/:*?"<>|]/g, '_') || 'videos'
}

function sanitizeStorageSegment(value: string): string {
  const normalized = value.trim().slice(0, 80)
  return normalized.replace(/[^a-zA-Z0-9_-]/g, '_') || 'video'
}

function normalizePanelIndex(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function buildPanelKey(storyboardId: string, panelIndex: number): string {
  return `${storyboardId}-${panelIndex}`
}

function resolveOutputSize(videoRatio: string): { width: number; height: number } {
  const normalized = videoRatio.trim()
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!match) return { width: 1280, height: 720 }

  const widthRatio = Number(match[1])
  const heightRatio = Number(match[2])
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return { width: 1280, height: 720 }
  }

  if (heightRatio > widthRatio) return { width: 720, height: 1280 }
  if (Math.abs(widthRatio - heightRatio) < 0.01) return { width: 1024, height: 1024 }
  return { width: 1280, height: 720 }
}

function buildStorageKey(projectId: string, episodeId: string | null | undefined): string {
  const timestamp = Date.now()
  const random = crypto.randomBytes(4).toString('hex')
  const scope = episodeId ? sanitizeStorageSegment(episodeId) : 'project'
  return `videos/merged/${sanitizeStorageSegment(projectId)}/${scope}-${timestamp}-${random}.mp4`
}

function toFfmpegConcatPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/')
}

async function downloadVideoBuffer(videoUrl: string): Promise<Buffer> {
  const storageKey = await resolveStorageKeyFromMediaValue(videoUrl)

  if (storageKey) {
    return await getObjectBuffer(storageKey)
  }

  const response = await fetch(toFetchableUrl(videoUrl), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; VideoMergeExporter/1.0)',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stderr)
        return
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`))
    })
  })
}

async function hasAudioStream(filePath: string, cwd: string): Promise<boolean> {
  try {
    const output = await runCommand('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      filePath,
    ], cwd)
    return output.trim().length > 0
  } catch {
    return false
  }
}

async function normalizeVideoSegment(params: {
  sourcePath: string
  outputPath: string
  tempDir: string
  width: number
  height: number
}) {
  const hasAudio = await hasAudioStream(params.sourcePath, params.tempDir)
  const videoFilter = `scale=${params.width}:${params.height}:force_original_aspect_ratio=decrease,pad=${params.width}:${params.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`

  const args = hasAudio
    ? [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        params.sourcePath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-vf',
        videoFilter,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-shortest',
        params.outputPath,
      ]
    : [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        params.sourcePath,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-vf',
        videoFilter,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-shortest',
        params.outputPath,
      ]

  await runCommand('ffmpeg', args, params.tempDir)
}

async function buildConcatFile(tempDir: string, inputFiles: string[]): Promise<string> {
  const concatPath = path.join(tempDir, 'concat.txt')
  const lines = inputFiles.map((filePath) => `file '${toFfmpegConcatPath(filePath)}'`)
  await writeFile(concatPath, `${lines.join('\n')}\n`, 'utf8')
  return concatPath
}

function collectMissingVideoPanels(episodes: VideoDownloadEpisodeData[]): MissingVideoPanel[] {
  const missingPanels: MissingVideoPanel[] = []
  const orderedPanels: Array<{
    storyboardId: string
    panelKey: string
    panelIndex: number
    description: string
    hasVideo: boolean
    linkedToNextPanel: boolean
    clipIndex: number
  }> = []

  for (const episode of episodes) {
    const clips = episode.clips || []
    for (const storyboard of episode.storyboards || []) {
      const clipIndex = clips.findIndex((clip) => clip.id === storyboard.clipId)
      for (const panel of storyboard.panels || []) {
        const panelIndex = normalizePanelIndex(panel.panelIndex)
        orderedPanels.push({
          storyboardId: storyboard.id,
          panelKey: buildPanelKey(storyboard.id, panelIndex),
          panelIndex,
          description: sanitizeFileName(panel.description || '镜头'),
          hasVideo: isNonEmptyString(panel.videoUrl)
            || isNonEmptyString(panel.audioMixedVideoUrl)
            || isNonEmptyString(panel.lipSyncVideoUrl),
          linkedToNextPanel: panel.linkedToNextPanel === true,
          clipIndex: clipIndex >= 0 ? clipIndex : 999,
        })
      }
    }
  }

  orderedPanels.sort((left, right) => {
    if (left.clipIndex !== right.clipIndex) return left.clipIndex - right.clipIndex
    return left.panelIndex - right.panelIndex
  })

  for (const [index, panel] of orderedPanels.entries()) {
    if (panel.hasVideo) continue

    const previousPanel = orderedPanels[index - 1]
    const coveredByPreviousFirstLastFrame = previousPanel?.linkedToNextPanel === true && previousPanel.hasVideo
    if (coveredByPreviousFirstLastFrame) continue

    missingPanels.push({
      storyboardId: panel.storyboardId,
      panelKey: panel.panelKey,
      panelIndex: panel.panelIndex,
      description: panel.description,
    })
  }

  return missingPanels
}

export async function loadVideoMergeSource(input: VideoMergeExportInput): Promise<LoadedMergeSource> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      name: true,
      novelPromotionData: {
        select: {
          videoRatio: true,
          episodes: input.episodeId
            ? false
            : {
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
      },
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }

  let episodes: VideoDownloadEpisodeData[] = []
  if (input.episodeId) {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: input.episodeId },
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
    episodes = (project.novelPromotionData?.episodes || []) as VideoDownloadEpisodeData[]
  }

  const panelPreferences = input.panelPreferences || {}
  const candidates = collectOrderedVideoCandidates(episodes, panelPreferences)
  return {
    projectName: project.name,
    videoRatio: project.novelPromotionData?.videoRatio || '16:9',
    episodes,
    candidates,
    missingPanels: collectMissingVideoPanels(episodes),
  }
}

export async function mergeProjectVideosToStorage(
  input: VideoMergeExportInput,
  reportProgress?: MergeProgressReporter,
): Promise<VideoMergeExportResult> {
  const source = await loadVideoMergeSource(input)
  if (source.episodes.length === 0) {
    throw new Error('No episode found for video merge export')
  }
  if (source.candidates.length === 0) {
    throw new Error('No videos available for merge export')
  }
  if (source.missingPanels.length > 0) {
    throw new Error(`Missing videos for ${source.missingPanels.length} panel(s); generate all videos before merge export`)
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'waoowaoo-merge-'))
  const normalizedFiles: string[] = []
  const outputSize = resolveOutputSize(source.videoRatio)

  try {
    await reportProgress?.(12, {
      stage: 'merge_download',
      videoCount: source.candidates.length,
    })

    for (const [index, candidate] of source.candidates.entries()) {
      const sourcePath = path.join(tempDir, `${String(index + 1).padStart(3, '0')}-source.mp4`)
      const normalizedPath = path.join(tempDir, `${String(index + 1).padStart(3, '0')}-normalized.mp4`)

      const videoData = await downloadVideoBuffer(candidate.videoUrl)
      await writeFile(sourcePath, videoData)

      const baseProgress = 15 + Math.floor((index / source.candidates.length) * 55)
      await reportProgress?.(baseProgress, {
        stage: 'merge_normalize',
        current: index + 1,
        total: source.candidates.length,
      })

      await normalizeVideoSegment({
        sourcePath,
        outputPath: normalizedPath,
        tempDir,
        width: outputSize.width,
        height: outputSize.height,
      })
      normalizedFiles.push(normalizedPath)
    }

    await reportProgress?.(75, {
      stage: 'merge_concat',
      total: normalizedFiles.length,
    })

    const concatFile = await buildConcatFile(tempDir, normalizedFiles)
    const outputPath = path.join(tempDir, 'merged.mp4')
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatFile,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      outputPath,
    ], tempDir)

    await reportProgress?.(88, {
      stage: 'merge_upload',
    })

    const outputBuffer = await readFile(outputPath)
    const outputKey = buildStorageKey(input.projectId, input.episodeId)
    await uploadObject(outputBuffer, outputKey, 1, 'video/mp4')

    const fileName = `${sanitizeFileName(source.projectName)}_merged.mp4`
    return {
      outputKey,
      outputUrl: outputKey,
      downloadUrl: `/api/novel-promotion/${input.projectId}/video-proxy?key=${encodeURIComponent(outputKey)}&download=1&filename=${encodeURIComponent(fileName)}`,
      fileName,
      videoCount: source.candidates.length,
      sizeBytes: outputBuffer.length,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

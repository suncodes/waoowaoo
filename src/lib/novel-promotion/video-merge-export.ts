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
import {
  prepareEpisodeSubtitleTrack,
  persistSubtitleTrack,
} from './subtitle-track'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

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
  audioStrategy?: 'timeline' | 'none' | null
  subtitleStrategy?: 'none' | 'burned' | null
  subtitleStyle?: unknown
}

export interface VideoMergeExportResult {
  outputKey: string
  outputUrl: string
  downloadUrl: string
  fileName: string
  videoCount: number
  sizeBytes: number
  audioTrackApplied?: boolean
  subtitleRequested?: boolean
  subtitleTrackApplied?: boolean
  subtitleCueCount?: number
  subtitleTrackId?: string | null
  subtitleSrtDownloadUrl?: string | null
  subtitleAssDownloadUrl?: string | null
}

export interface StoredVideoMergeExportResult extends VideoMergeExportResult {
  taskId: string
  mergedAt: string | null
}

interface LoadedMergeSource {
  projectName: string
  videoRatio: string
  episodes: VideoDownloadEpisodeData[]
  candidates: OrderedVideoCandidate[]
  missingPanels: MissingVideoPanel[]
  narrationLines: NarrationLineSource[]
}

interface NarrationVoiceLineData {
  id: string
  lineIndex: number
  content: string
  audioUrl: string | null
  audioDuration: number | null
  estimatedDurationMs?: number | null
  timelineStartMs?: number | null
  timelineEndMs?: number | null
  audioMedia?: { storageKey?: string | null } | null
}

interface NarrationEpisodeData {
  voiceLines?: NarrationVoiceLineData[]
}

interface NarrationLineSource {
  id: string
  lineIndex: number
  audioSource: string
  startMs: number
  durationMs: number
}

interface MergeProgressReporter {
  (progress: number, payload?: Record<string, unknown>): Promise<void>
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readOptionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readOptionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined
}

function readStoredOutputKey(result: Record<string, unknown>): string | null {
  const outputKey = readOptionalString(result.outputKey)
  if (outputKey) return outputKey

  const outputUrl = readOptionalString(result.outputUrl)
  if (!outputUrl) return null

  try {
    const parsedUrl = new URL(outputUrl, 'http://localhost')
    if (parsedUrl.pathname.endsWith('/video-proxy')) {
      return readOptionalString(parsedUrl.searchParams.get('key')) || null
    }
  } catch {
    return outputUrl
  }

  return outputUrl
}

function estimateNarrationDurationMs(content: string | null | undefined): number {
  const compactLength = typeof content === 'string' ? content.replace(/\s+/g, '').length : 0
  return Math.max(1200, Math.round(compactLength * 180))
}

function readMediaStorageKey(media: { storageKey?: string | null } | null | undefined): string | null {
  return isNonEmptyString(media?.storageKey) ? media.storageKey : null
}

function resolveVoiceLineDurationMs(line: NarrationVoiceLineData): number {
  if (typeof line.audioDuration === 'number' && Number.isFinite(line.audioDuration) && line.audioDuration > 0) {
    return Math.round(line.audioDuration)
  }
  if (typeof line.estimatedDurationMs === 'number' && Number.isFinite(line.estimatedDurationMs) && line.estimatedDurationMs > 0) {
    return Math.round(line.estimatedDurationMs)
  }
  if (
    typeof line.timelineStartMs === 'number'
    && typeof line.timelineEndMs === 'number'
    && line.timelineEndMs > line.timelineStartMs
  ) {
    return line.timelineEndMs - line.timelineStartMs
  }
  return estimateNarrationDurationMs(line.content)
}

function collectNarrationLines(episodes: NarrationEpisodeData[]): NarrationLineSource[] {
  const lines: NarrationLineSource[] = []
  let episodeOffsetMs = 0

  for (const episode of episodes) {
    const voiceLines = [...(episode.voiceLines || [])].sort((left, right) => left.lineIndex - right.lineIndex)
    let localCursorMs = 0
    let episodeEndMs = 0

    for (const line of voiceLines) {
      const audioSource = readMediaStorageKey(line.audioMedia) || line.audioUrl
      const durationMs = resolveVoiceLineDurationMs(line)
      const localStartMs = typeof line.timelineStartMs === 'number' && Number.isFinite(line.timelineStartMs)
        ? Math.max(0, line.timelineStartMs)
        : localCursorMs
      const localEndMs = typeof line.timelineEndMs === 'number' && Number.isFinite(line.timelineEndMs) && line.timelineEndMs > localStartMs
        ? line.timelineEndMs
        : localStartMs + durationMs
      localCursorMs = localEndMs
      episodeEndMs = Math.max(episodeEndMs, localEndMs)

      if (!isNonEmptyString(audioSource)) continue
      lines.push({
        id: line.id,
        lineIndex: line.lineIndex,
        audioSource,
        startMs: episodeOffsetMs + localStartMs,
        durationMs,
      })
    }

    episodeOffsetMs += episodeEndMs
  }

  return lines
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

function buildStorageKey(
  projectId: string,
  episodeId: string | null | undefined,
  variant: 'plain' | 'subtitled' = 'plain',
): string {
  const timestamp = Date.now()
  const random = crypto.randomBytes(4).toString('hex')
  const scope = episodeId ? sanitizeStorageSegment(episodeId) : 'project'
  const suffix = variant === 'subtitled' ? '-subtitled' : ''
  return `videos/merged/${sanitizeStorageSegment(projectId)}/${scope}-${timestamp}-${random}${suffix}.mp4`
}

export function buildMergedVideoAccessUrls(params: {
  projectId: string
  outputKey: string
  fileName: string
}): { outputUrl: string; downloadUrl: string } {
  const outputUrl = `/api/novel-promotion/${encodeURIComponent(params.projectId)}/video-proxy?key=${encodeURIComponent(params.outputKey)}`
  return {
    outputUrl,
    downloadUrl: `${outputUrl}&download=1&filename=${encodeURIComponent(params.fileName)}`,
  }
}

export function restoreStoredVideoMergeExportResult(params: {
  projectId: string
  taskId: string
  finishedAt: Date | null
  result: unknown
}): StoredVideoMergeExportResult | null {
  if (!isRecord(params.result)) return null

  const outputKey = readStoredOutputKey(params.result)
  if (!outputKey) return null

  const fileName = readOptionalString(params.result.fileName) || 'merged-video.mp4'
  const accessUrls = buildMergedVideoAccessUrls({
    projectId: params.projectId,
    outputKey,
    fileName,
  })

  return {
    outputKey,
    ...accessUrls,
    fileName,
    videoCount: readOptionalNonNegativeInteger(params.result.videoCount) || 0,
    sizeBytes: readOptionalNonNegativeInteger(params.result.sizeBytes) || 0,
    audioTrackApplied: readOptionalBoolean(params.result.audioTrackApplied),
    subtitleRequested: readOptionalBoolean(params.result.subtitleRequested),
    subtitleTrackApplied: readOptionalBoolean(params.result.subtitleTrackApplied),
    subtitleCueCount: readOptionalNonNegativeInteger(params.result.subtitleCueCount),
    subtitleTrackId: readOptionalString(params.result.subtitleTrackId) || null,
    subtitleSrtDownloadUrl: readOptionalString(params.result.subtitleSrtDownloadUrl) || null,
    subtitleAssDownloadUrl: readOptionalString(params.result.subtitleAssDownloadUrl) || null,
    taskId: params.taskId,
    mergedAt: params.finishedAt?.toISOString() || null,
  }
}

export async function getLatestEpisodeVideoMergeExport(params: {
  projectId: string
  episodeId: string
}): Promise<StoredVideoMergeExportResult | null> {
  const task = await prisma.task.findFirst({
    where: {
      projectId: params.projectId,
      episodeId: params.episodeId,
      type: TASK_TYPE.VIDEO_MERGE_EXPORT,
      status: TASK_STATUS.COMPLETED,
    },
    orderBy: [
      { finishedAt: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      id: true,
      result: true,
      finishedAt: true,
    },
  })

  if (!task) return null

  return restoreStoredVideoMergeExportResult({
    projectId: params.projectId,
    taskId: task.id,
    finishedAt: task.finishedAt,
    result: task.result,
  })
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
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout || stderr)
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

async function probeDurationMs(filePath: string, cwd: string): Promise<number> {
  const output = await runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], cwd)
  const seconds = Number.parseFloat(output.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('VIDEO_MERGE_DURATION_PROBE_FAILED')
  }
  return Math.round(seconds * 1000)
}

async function buildNarrationTrack(params: {
  lines: NarrationLineSource[]
  tempDir: string
  outputPath: string
}): Promise<number> {
  if (params.lines.length === 0) {
    throw new Error('VIDEO_MERGE_NARRATION_AUDIO_MISSING')
  }

  const inputPaths: string[] = []
  for (const [index, line] of params.lines.entries()) {
    const audioPath = path.join(params.tempDir, `${String(index + 1).padStart(3, '0')}-narration.input`)
    const audioData = await downloadVideoBuffer(line.audioSource)
    await writeFile(audioPath, audioData)
    inputPaths.push(audioPath)
  }

  const totalDurationMs = Math.max(
    ...params.lines.map((line) => line.startMs + Math.max(1, line.durationMs)),
  )
  const inputArgs = inputPaths.flatMap((inputPath) => ['-i', inputPath])
  const filters = params.lines.map((line, index) => {
    const delay = Math.max(0, Math.round(line.startMs))
    return `[${index}:a:0]aresample=48000,adelay=${delay}|${delay},atrim=0:${(totalDurationMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`
  })
  const labels = params.lines.map((_, index) => `[a${index}]`).join('')
  const filter = `${filters.join(';')};${labels}amix=inputs=${params.lines.length}:duration=longest:normalize=0[aout]`

  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputArgs,
    '-filter_complex',
    filter,
    '-map',
    '[aout]',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    params.outputPath,
  ], params.tempDir)

  return totalDurationMs
}

async function muxNarrationTrackIntoVideo(params: {
  videoPath: string
  audioPath: string
  outputPath: string
  tempDir: string
  videoDurationMs: number
  audioDurationMs: number
}) {
  const outputDurationSec = Math.max(0.1, Math.max(params.videoDurationMs, params.audioDurationMs) / 1000)
  const videoExtendSec = Math.max(0, (params.audioDurationMs - params.videoDurationMs) / 1000)

  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    params.videoPath,
    '-i',
    params.audioPath,
    '-filter_complex',
    `[0:v:0]tpad=stop_mode=clone:stop_duration=${videoExtendSec.toFixed(3)},trim=0:${outputDurationSec.toFixed(3)},setpts=PTS-STARTPTS[vout];[1:a]aresample=48000,apad,atrim=0:${outputDurationSec.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
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
    '-movflags',
    '+faststart',
    params.outputPath,
  ], params.tempDir)
}

function escapeFfmpegFilterPath(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

async function burnAssSubtitlesIntoVideo(params: {
  videoPath: string
  assPath: string
  outputPath: string
  tempDir: string
}) {
  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    params.videoPath,
    '-vf',
    `ass=${escapeFfmpegFilterPath(params.assPath)}`,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
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
    '-movflags',
    '+faststart',
    params.outputPath,
  ], params.tempDir)
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
                  voiceLines: {
                    orderBy: { lineIndex: 'asc' },
                    include: {
                      audioMedia: { select: { storageKey: true } },
                    },
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
        voiceLines: {
          orderBy: { lineIndex: 'asc' },
          include: {
            audioMedia: { select: { storageKey: true } },
          },
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
  const narrationLines = input.audioStrategy === 'none'
    ? []
    : collectNarrationLines(episodes as NarrationEpisodeData[])
  const candidates = collectOrderedVideoCandidates(episodes, panelPreferences, {
    preferRawVideo: narrationLines.length > 0,
  })
  return {
    projectName: project.name,
    videoRatio: project.novelPromotionData?.videoRatio || '16:9',
    episodes,
    candidates,
    missingPanels: collectMissingVideoPanels(episodes),
    narrationLines,
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
  const normalizedDurationsByPanelKey = new Map<string, number>()
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
      normalizedDurationsByPanelKey.set(
        `${candidate.storyboardId}:${candidate.panelIndex}`,
        await probeDurationMs(normalizedPath, tempDir),
      )
    }

    await reportProgress?.(75, {
      stage: 'merge_concat',
      total: normalizedFiles.length,
    })

    const concatFile = await buildConcatFile(tempDir, normalizedFiles)
    const mergedPath = path.join(tempDir, 'merged.mp4')
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
      mergedPath,
    ], tempDir)

    let outputPath = mergedPath
    let audioTrackApplied = false
    if (source.narrationLines.length > 0) {
      await reportProgress?.(82, {
        stage: 'merge_narration_audio',
        voiceLineCount: source.narrationLines.length,
      })
      const narrationTrackPath = path.join(tempDir, 'narration-track.m4a')
      const audioDurationMs = await buildNarrationTrack({
        lines: source.narrationLines,
        tempDir,
        outputPath: narrationTrackPath,
      })
      const videoDurationMs = await probeDurationMs(mergedPath, tempDir)
      const narratedPath = path.join(tempDir, 'merged-with-narration.mp4')
      await muxNarrationTrackIntoVideo({
        videoPath: mergedPath,
        audioPath: narrationTrackPath,
        outputPath: narratedPath,
        tempDir,
        videoDurationMs,
        audioDurationMs,
      })
      outputPath = narratedPath
      audioTrackApplied = true
    }

    let subtitleTrackApplied = false
    let subtitleCueCount = 0
    let subtitleTrackId: string | null = null
    let subtitleSrtDownloadUrl: string | null = null
    let subtitleAssDownloadUrl: string | null = null
    let preparedSubtitle: Awaited<ReturnType<typeof prepareEpisodeSubtitleTrack>> | null = null

    if (input.subtitleStrategy === 'burned') {
      if (!input.episodeId) {
        throw new Error('SUBTITLE_EPISODE_REQUIRED')
      }
      await reportProgress?.(88, {
        stage: 'subtitle_prepare',
      })
      preparedSubtitle = await prepareEpisodeSubtitleTrack({
        projectId: input.projectId,
        episodeId: input.episodeId,
        panelPreferences: input.panelPreferences || {},
        style: input.subtitleStyle,
        durationsByPanelKey: normalizedDurationsByPanelKey,
        outputSize,
      })
      subtitleCueCount = preparedSubtitle.draft.cues.length
      if (preparedSubtitle.srtStorageKey) {
        subtitleSrtDownloadUrl = `/api/novel-promotion/${input.projectId}/video-proxy?key=${encodeURIComponent(preparedSubtitle.srtStorageKey)}&download=1&filename=${encodeURIComponent(`${sanitizeFileName(source.projectName)}_subtitles.srt`)}`
      }
      if (preparedSubtitle.assStorageKey) {
        subtitleAssDownloadUrl = `/api/novel-promotion/${input.projectId}/video-proxy?key=${encodeURIComponent(preparedSubtitle.assStorageKey)}&download=1&filename=${encodeURIComponent(`${sanitizeFileName(source.projectName)}_subtitles.ass`)}`
      }
      if (preparedSubtitle.draft.cues.length > 0) {
        await reportProgress?.(92, {
          stage: 'subtitle_burn',
          cueCount: preparedSubtitle.draft.cues.length,
        })
        const assPath = path.join(tempDir, 'subtitles.ass')
        const subtitledPath = path.join(tempDir, 'merged-with-subtitles.mp4')
        await writeFile(assPath, preparedSubtitle.ass, 'utf8')
        await burnAssSubtitlesIntoVideo({
          videoPath: outputPath,
          assPath,
          outputPath: subtitledPath,
          tempDir,
        })
        outputPath = subtitledPath
        subtitleTrackApplied = true
      }
    }

    await reportProgress?.(95, {
      stage: 'merge_upload',
    })

    const outputBuffer = await readFile(outputPath)
    const outputKey = buildStorageKey(
      input.projectId,
      input.episodeId,
      subtitleTrackApplied ? 'subtitled' : 'plain',
    )
    await uploadObject(outputBuffer, outputKey, 1, 'video/mp4')

    if (preparedSubtitle) {
      const persisted = await persistSubtitleTrack({
        projectId: input.projectId,
        episodeId: input.episodeId as string,
        draft: preparedSubtitle.draft,
        srtStorageKey: preparedSubtitle.srtStorageKey,
        assStorageKey: preparedSubtitle.assStorageKey,
        burnedVideoStorageKey: subtitleTrackApplied ? outputKey : null,
      })
      subtitleTrackId = persisted.track?.id || null
    }

    const fileName = `${sanitizeFileName(source.projectName)}_${subtitleTrackApplied ? 'merged_subtitled' : 'merged'}.mp4`
    const accessUrls = buildMergedVideoAccessUrls({
      projectId: input.projectId,
      outputKey,
      fileName,
    })
    return {
      outputKey,
      ...accessUrls,
      fileName,
      videoCount: source.candidates.length,
      sizeBytes: outputBuffer.length,
      audioTrackApplied,
      subtitleRequested: input.subtitleStrategy === 'burned',
      subtitleTrackApplied,
      subtitleCueCount,
      subtitleTrackId,
      subtitleSrtDownloadUrl,
      subtitleAssDownloadUrl,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

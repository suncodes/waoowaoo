import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { ensureMediaObjectFromStorageKey, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { getObjectBuffer, toFetchableUrl, uploadObject } from '@/lib/storage'

export interface PanelAudioMixInput {
  projectId: string
  panelId: string
  speechIds?: string[] | null
}

export interface PanelAudioMixResult {
  panelId: string
  outputKey: string
  outputUrl: string
  videoDurationMs: number
  audioDurationMs: number
  outputDurationMs: number
  voiceLineCount: number
}

interface AudioMixProgressReporter {
  (progress: number, payload?: Record<string, unknown>): Promise<void>
}

type MediaLike = string | null | undefined

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sanitizeStorageSegment(value: string): string {
  const normalized = value.trim().slice(0, 80)
  return normalized.replace(/[^a-zA-Z0-9_-]/g, '_') || 'media'
}

function buildStorageKey(projectId: string, panelId: string): string {
  const timestamp = Date.now()
  const random = crypto.randomBytes(4).toString('hex')
  return `videos/audio-mixed/${sanitizeStorageSegment(projectId)}/${sanitizeStorageSegment(panelId)}-${timestamp}-${random}.mp4`
}

async function downloadMediaBuffer(mediaValue: MediaLike): Promise<Buffer> {
  if (!isNonEmptyString(mediaValue)) {
    throw new Error('AUDIO_MIX_INPUT_MISSING')
  }

  const storageKey = await resolveStorageKeyFromMediaValue(mediaValue)
  if (storageKey) {
    return await getObjectBuffer(storageKey)
  }

  const response = await fetch(toFetchableUrl(mediaValue), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AudioMixExporter/1.0)',
    },
  })
  if (!response.ok) {
    throw new Error(`AUDIO_MIX_FETCH_FAILED: ${response.status} ${response.statusText}`)
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
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout || stderr)
        return
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`))
    })
  })
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
    throw new Error('AUDIO_MIX_DURATION_PROBE_FAILED')
  }
  return Math.round(seconds * 1000)
}

async function buildVoiceTrack(inputPaths: string[], outputPath: string, cwd: string): Promise<void> {
  if (inputPaths.length === 0) {
    throw new Error('AUDIO_MIX_NO_AUDIO')
  }

  if (inputPaths.length === 1) {
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPaths[0],
      '-vn',
      '-map',
      '0:a:0',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
      outputPath,
    ], cwd)
    return
  }

  const inputArgs = inputPaths.flatMap((inputPath) => ['-i', inputPath])
  const normalizeFilters = inputPaths
    .map((_, index) => `[${index}:a:0]aresample=48000,atrim=start=0,asetpts=PTS-STARTPTS[a${index}]`)
    .join(';')
  const concatInputs = inputPaths.map((_, index) => `[a${index}]`).join('')
  const filter = `${normalizeFilters};${concatInputs}concat=n=${inputPaths.length}:v=0:a=1[aout]`

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
    outputPath,
  ], cwd)
}

async function mixAudioIntoVideo(params: {
  videoPath: string
  audioPath: string
  outputPath: string
  videoDurationMs: number
  audioDurationMs: number
  cwd: string
}): Promise<void> {
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
  ], params.cwd)
}

function readMediaStorageKey(media: { storageKey?: string | null } | null | undefined): string | null {
  return isNonEmptyString(media?.storageKey) ? media.storageKey : null
}

export async function mixPanelAudioToStorage(
  input: PanelAudioMixInput,
  reportProgress?: AudioMixProgressReporter,
): Promise<PanelAudioMixResult> {
  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: input.panelId,
      storyboard: {
        episode: {
          novelPromotionProject: {
            projectId: input.projectId,
          },
        },
      },
    },
    select: {
      id: true,
      videoUrl: true,
      videoMedia: { select: { storageKey: true } },
      panelSpeech: {
        select: {
          id: true,
          audio: {
            select: {
              audioUrl: true,
              audioMedia: { select: { storageKey: true } },
            },
          },
        },
      },
    },
  })
  if (!panel) {
    throw new Error('AUDIO_MIX_PANEL_NOT_FOUND')
  }

  const sourceVideo = readMediaStorageKey(panel.videoMedia) || panel.videoUrl
  if (!isNonEmptyString(sourceVideo)) {
    throw new Error('AUDIO_MIX_VIDEO_MISSING')
  }

  const requestedSpeechIds = Array.from(new Set((input.speechIds || []).filter(isNonEmptyString)))
  const speech = panel.panelSpeech
  if (!speech || (requestedSpeechIds.length > 0 && !requestedSpeechIds.includes(speech.id))) {
    throw new Error('AUDIO_MIX_AUDIO_MISSING')
  }
  const audioSource = readMediaStorageKey(speech.audio?.audioMedia) || speech.audio?.audioUrl
  if (!isNonEmptyString(audioSource)) throw new Error('AUDIO_MIX_AUDIO_MISSING')
  const audioSources = [audioSource]

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'waoowaoo-audio-mix-'))
  try {
    await reportProgress?.(12, { stage: 'audio_mix_prepare' })

    const videoPath = path.join(tempDir, 'source-video.mp4')
    await writeFile(videoPath, await downloadMediaBuffer(sourceVideo))

    const audioPaths: string[] = []
    for (const [index, audioSource] of audioSources.entries()) {
      const audioPath = path.join(tempDir, `${String(index + 1).padStart(3, '0')}-audio.input`)
      await writeFile(audioPath, await downloadMediaBuffer(audioSource))
      audioPaths.push(audioPath)
    }

    const voiceTrackPath = path.join(tempDir, 'voice-track.m4a')
    await buildVoiceTrack(audioPaths, voiceTrackPath, tempDir)

    const [videoDurationMs, audioDurationMs] = await Promise.all([
      probeDurationMs(videoPath, tempDir),
      probeDurationMs(voiceTrackPath, tempDir),
    ])
    const outputDurationMs = Math.max(videoDurationMs, audioDurationMs)

    await reportProgress?.(55, {
      stage: 'audio_mix_merge',
      videoDurationMs,
      audioDurationMs,
      outputDurationMs,
      voiceLineCount: 1,
    })

    const outputPath = path.join(tempDir, 'audio-mixed.mp4')
    await mixAudioIntoVideo({
      videoPath,
      audioPath: voiceTrackPath,
      outputPath,
      videoDurationMs,
      audioDurationMs,
      cwd: tempDir,
    })

    await reportProgress?.(88, { stage: 'audio_mix_upload' })

    const outputBuffer = await readFile(outputPath)
    const outputKey = buildStorageKey(input.projectId, panel.id)
    await uploadObject(outputBuffer, outputKey, 1, 'video/mp4')
    const media = await ensureMediaObjectFromStorageKey(outputKey, {
      mimeType: 'video/mp4',
      sizeBytes: outputBuffer.length,
      durationMs: outputDurationMs,
    })

    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        audioMixedVideoUrl: outputKey,
        audioMixedVideoMediaId: media.id,
      },
    })

    return {
      panelId: panel.id,
      outputKey,
      outputUrl: media.url,
      videoDurationMs,
      audioDurationMs,
      outputDurationMs,
      voiceLineCount: 1,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

import archiver from 'archiver'
import { PassThrough } from 'node:stream'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { extractStorageKey, getObjectBuffer, uploadObject } from '@/lib/storage'
import { readProjectLogs } from '@/lib/logging/file-writer'
import type { TaskJobData } from '@/lib/task/types'
import type { Job } from 'bullmq'
import {
  reviewRoughCutQuality,
  type RoughCutPanelInput,
  type RoughCutPromptSnapshotInput,
  type RoughCutStoryboardInput,
  type RoughCutVoiceLineInput,
} from '@/lib/creative-quality/rough-cut-review'
import {
  reviewScriptDraftQuality,
  type ScriptReviewClipInput,
  type ScriptReviewVoiceLineInput,
} from '@/lib/creative-quality/script-review'
import { reviewPromptSnapshotQuality } from '@/lib/creative-quality/prompt-review'

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_ARCHIVE_BYTES = 400 * 1024 * 1024
const DIAGNOSTIC_SCHEMA_VERSION = 7
const PROMPT_SNAPSHOT_ARTIFACT_TYPES = new Set(['prompt.panel_image.snapshot', 'prompt.panel_video.snapshot', 'prompt.asset_image.snapshot'])
const ASSET_BIBLE_REUSE_ARTIFACT_TYPES = new Set(['asset.bible.reuse'])
const CONTENT_QUALITY_REVIEW_ARTIFACT_TYPES = new Set(['content.quality.review'])
const CONTENT_PLAN_REUSE_ARTIFACT_TYPES = new Set(['content.plan.reuse'])
const VISUAL_QUALITY_REVIEW_ARTIFACT_TYPES = new Set(['visual.quality.review', 'visual.asset.quality.review'])
const VISUAL_PLAN_REUSE_ARTIFACT_TYPES = new Set(['visual.plan.reuse'])
const VISUAL_AUTO_REPAIR_ARTIFACT_TYPES = new Set(['visual.repair.candidate', 'visual.asset.repair.candidate'])
const VISUAL_BINDING_PLAN_ARTIFACT_TYPES = new Set(['visual.binding.plan'])
const VISUAL_BEAT_PLAN_ARTIFACT_TYPES = new Set(['visual.beat.plan'])
const ASSET_COVERAGE_AUDIT_ARTIFACT_TYPES = new Set(['asset.coverage.audit'])
const VISUAL_GENERATION_ROUTE_ARTIFACT_TYPES = new Set(['visual.generation.route'])
const STORYBOARD_QUALITY_REVIEW_ARTIFACT_TYPES = new Set(['storyboard.quality.review'])
const SCRIPT_QUALITY_REVIEW_ARTIFACT_TYPES = new Set(['script.quality.review'])

export type DiagnosticExportOptions = {
  episodeId?: string | null
  includeCandidates?: boolean
  includeVideos?: boolean
  includeAllVideos?: boolean
  includeReasoning?: boolean
}

type AnyRecord = Record<string, unknown>

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {}
}

function redact(value: unknown, key = ''): unknown {
  const normalizedKey = key.toLowerCase()
  if (/(^|_)(api[_-]?key|secret|token|cookie|authorization|password|access[_-]?token|refresh[_-]?token)(_|$)/.test(normalizedKey)) {
    return '[REDACTED]'
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as AnyRecord).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]))
}

function safeJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(safeJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as AnyRecord).map(([key, child]) => [key, safeJson(child)]))
  }
  return value
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(redact(safeJson(value)), null, 2)
}

function stringifyJsonLine(value: unknown): string {
  return JSON.stringify(redact(safeJson(value)))
}

function redactLogText(value: string): string {
  return value.split('\n').map((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) return line.replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    try {
      return JSON.stringify(redact(JSON.parse(line)))
    } catch {
      return line.replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    }
  }).join('\n')
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'media'
}

function isMediaField(key: string): boolean {
  return /(image|video|audio|media|storage|file|url)/i.test(key)
}

function collectMediaValues(value: unknown, trail: string[] = [], output = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectMediaValues(item, [...trail, String(index)], output))
    return output
  }
  if (!value || typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value as AnyRecord)) {
    const nextTrail = [...trail, key]
    if (typeof child === 'string' && isMediaField(key)) {
      try {
        const storageKey = extractStorageKey(child)
        if (storageKey) output.set(storageKey, nextTrail.join('.'))
      } catch {
        // A malformed legacy URL should not prevent the diagnostic archive.
      }
    } else {
      collectMediaValues(child, nextTrail, output)
    }
  }
  return output
}

function collectMediaIds(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMediaIds(item, output))
    return output
  }
  if (!value || typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value as AnyRecord)) {
    if (/mediaid$/i.test(key) && typeof child === 'string' && child.trim()) output.add(child.trim())
    else collectMediaIds(child, output)
  }
  return output
}

function isVideoMedia(mimeType: string | null, storageKey: string): boolean {
  return Boolean(mimeType?.startsWith('video/')) || /\.(mp4|mov|webm|m4v)$/i.test(storageKey)
}

function isCandidatePath(trail: string): boolean {
  return /(candidate|history|previous|variant|draft)/i.test(trail)
}

async function collectProjectData(projectId: string, episodeId?: string | null) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true, userId: true, createdAt: true, updatedAt: true },
  })
  if (!project) throw new Error('Project not found')

  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
  })
  if (!novelProject) throw new Error('Novel promotion project not found')

  const episodeWhere = {
    novelPromotionProjectId: novelProject.id,
    ...(episodeId ? { id: episodeId } : {}),
  }
  const episodes = await prisma.novelPromotionEpisode.findMany({ where: episodeWhere, orderBy: { episodeNumber: 'asc' } })
  const episodeIds = episodes.map((episode) => episode.id)
  const characters = await prisma.novelPromotionCharacter.findMany({
    where: { novelPromotionProjectId: novelProject.id },
    include: { appearances: true },
    orderBy: { createdAt: 'asc' },
  })
  const locations = await prisma.novelPromotionLocation.findMany({
    where: { novelPromotionProjectId: novelProject.id },
    include: { images: true },
    orderBy: { createdAt: 'asc' },
  })
  const clips = await prisma.novelPromotionClip.findMany({ where: { episodeId: { in: episodeIds } }, orderBy: { createdAt: 'asc' } })
  const shots = await prisma.novelPromotionShot.findMany({ where: { episodeId: { in: episodeIds } }, orderBy: { createdAt: 'asc' } })
  const storyboards = await prisma.novelPromotionStoryboard.findMany({
    where: { episodeId: { in: episodeIds } },
    include: { panels: true, supplementaryPanels: true },
    orderBy: { createdAt: 'asc' },
  })
  const voiceLines = await prisma.novelPromotionVoiceLine.findMany({ where: { episodeId: { in: episodeIds } }, orderBy: { createdAt: 'asc' } })
  const tasks = await prisma.task.findMany({
    where: { projectId, ...(episodeId ? { episodeId } : {}) },
    include: { events: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })
  const runs = await prisma.graphRun.findMany({
    where: { projectId, ...(episodeId ? { episodeId } : {}) },
    include: {
      steps: { include: { attempts: true }, orderBy: { stepIndex: 'asc' } },
      attempts: true,
      events: { orderBy: { seq: 'asc' } },
      checkpoints: true,
      artifacts: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const domain = { project, novelProject, episodes, characters, locations, clips, shots, storyboards, voiceLines }
  const mediaRoots = { domain, tasks, runs }
  const mediaIds = [...collectMediaIds(mediaRoots)]
  const media = mediaIds.length > 0
    ? await prisma.mediaObject.findMany({ where: { id: { in: [...new Set(mediaIds)] } } })
    : []
  const mediaById = new Map(media.map((item) => [item.id, item]))
  const linkedMedia = new Map<string, string>()
  for (const id of collectMediaIds(mediaRoots)) {
    const item = mediaById.get(id)
    if (item) linkedMedia.set(item.storageKey, `mediaId:${id}`)
  }
  for (const [storageKey, trail] of collectMediaValues(mediaRoots)) linkedMedia.set(storageKey, trail)
  return { project, domain, tasks, runs, media, linkedMedia }
}

function buildTimeline(tasks: AnyRecord[], runs: AnyRecord[]) {
  const events: AnyRecord[] = []
  for (const task of tasks) {
    events.push({ at: task.createdAt, kind: 'task.created', taskId: task.id, type: task.type, status: task.status })
    if (task.startedAt) events.push({ at: task.startedAt, kind: 'task.started', taskId: task.id, type: task.type })
    if (task.finishedAt) events.push({ at: task.finishedAt, kind: 'task.finished', taskId: task.id, type: task.type, status: task.status })
    for (const event of (Array.isArray(task.events) ? task.events : [])) {
      events.push({ at: event.createdAt, kind: event.eventType, taskId: task.id, payload: event.payload })
    }
  }
  for (const run of runs) {
    for (const event of (Array.isArray(run.events) ? run.events : [])) {
      events.push({ at: event.createdAt, kind: event.eventType, runId: run.id, stepKey: event.stepKey, payload: event.payload })
    }
  }
  return events.sort((a, b) => String(a.at).localeCompare(String(b.at))).map((event, index) => ({ seq: index + 1, ...event }))
}

function buildArtifactRecords(runs: AnyRecord[]): AnyRecord[] {
  const records: AnyRecord[] = []
  for (const run of runs) {
    const artifacts = Array.isArray(run.artifacts) ? run.artifacts as AnyRecord[] : []
    for (const artifact of artifacts) {
      const artifactData = Object.fromEntries(
        Object.entries(artifact).filter(([key]) => key !== 'runId'),
      )
      records.push({ runId: run.id, ...artifactData })
    }
  }
  return records
}

function filterArtifactsByType(artifacts: AnyRecord[], types: Set<string>): AnyRecord[] {
  return artifacts.filter((artifact) => (
    typeof artifact.artifactType === 'string'
    && types.has(artifact.artifactType)
  ))
}

function collectRepairLineageRecords(artifacts: AnyRecord[]): AnyRecord[] {
  const records = new Map<string, AnyRecord>()
  for (const artifact of artifacts) {
    const payload = asRecord(artifact.payload)
    const lineageValue = payload.repairLineage
    const lineageItems = Array.isArray(lineageValue) ? lineageValue : lineageValue ? [lineageValue] : []
    for (const item of lineageItems) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const lineageRecord = item as AnyRecord
      const keyParts = [
        lineageRecord.targetType,
        lineageRecord.targetId,
        lineageRecord.attempt,
        lineageRecord.repairVersionHash,
      ].map((part) => String(part || ''))
      const key = keyParts.join('|') || `${records.size}`
      const nextRecord: AnyRecord = {
        runId: artifact.runId || null,
        artifactId: artifact.id || null,
        artifactType: artifact.artifactType || null,
        stepKey: artifact.stepKey || null,
        refId: artifact.refId || null,
        versionHash: artifact.versionHash || null,
        ...lineageRecord,
      }
      const existing = records.get(key)
      const nextReviewed = Boolean(nextRecord.reviewedAt || nextRecord.scoreAfter !== null && nextRecord.scoreAfter !== undefined)
      const existingReviewed = Boolean(existing?.reviewedAt || existing?.scoreAfter !== null && existing?.scoreAfter !== undefined)
      if (!existing || (nextReviewed && !existingReviewed)) records.set(key, nextRecord)
    }
  }
  return [...records.values()]
}

function collectAssetBibleRecords(episodes: AnyRecord[]): AnyRecord[] {
  const records: AnyRecord[] = []
  for (const episode of episodes) {
    const contentPlan = asRecord(episode.contentPlan)
    const workspace = asRecord(contentPlan._workspace)
    const assetRequirements = asRecord(workspace.assetRequirements)
    const assetBible = Array.isArray(assetRequirements.assetBible) ? assetRequirements.assetBible : []
    for (const item of assetBible) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      records.push({
        episodeId: episode.id || null,
        contentRevision: workspace.revision || null,
        assetRequirementStatus: assetRequirements.status || null,
        analyzedAt: assetRequirements.analyzedAt || null,
        ...(item as AnyRecord),
      })
    }
  }
  return records
}

function collectAssetBibleReviewRecords(episodes: AnyRecord[]): AnyRecord[] {
  const records: AnyRecord[] = []
  for (const episode of episodes) {
    const contentPlan = asRecord(episode.contentPlan)
    const workspace = asRecord(contentPlan._workspace)
    const assetRequirements = asRecord(workspace.assetRequirements)
    const review = asRecord(assetRequirements.review)
    if (Object.keys(review).length === 0) continue
    records.push({
      episodeId: episode.id || null,
      contentRevision: workspace.revision || null,
      assetRequirementStatus: assetRequirements.status || null,
      analyzedAt: assetRequirements.analyzedAt || null,
      ...review,
    })
  }
  return records
}

function readTimeMs(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value !== 'string' || !value.trim()) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function extractScriptReviewArtifact(artifact: AnyRecord): AnyRecord | null {
  const payload = asRecord(artifact.payload)
  const nestedReview = asRecord(payload.review)
  const review = Object.keys(nestedReview).length > 0 ? nestedReview : payload
  if (review.targetType !== 'script' || typeof review.targetId !== 'string' || !review.targetId.trim()) {
    return null
  }
  return {
    ...review,
    reviewSource: 'runtime_artifact',
    artifactId: artifact.id || null,
    artifactRunId: artifact.runId || null,
    artifactStepKey: artifact.stepKey || null,
    artifactCreatedAt: artifact.createdAt || null,
  }
}

function buildLatestScriptReviewArtifactMap(artifacts: AnyRecord[]): Map<string, AnyRecord> {
  const reviews = artifacts
    .map(extractScriptReviewArtifact)
    .filter((review): review is AnyRecord => review !== null)
    .sort((left, right) => readTimeMs(left.artifactCreatedAt) - readTimeMs(right.artifactCreatedAt))
  const byEpisodeId = new Map<string, AnyRecord>()
  for (const review of reviews) {
    byEpisodeId.set(String(review.targetId), review)
  }
  return byEpisodeId
}

function collectScriptReviewRecords(params: {
  episodes: AnyRecord[]
  clips: AnyRecord[]
  voiceLines: AnyRecord[]
  scriptQualityReviews: AnyRecord[]
  generatedAt: Date
}) {
  const artifactReviewsByEpisodeId = buildLatestScriptReviewArtifactMap(params.scriptQualityReviews)
  return params.episodes.map((episode) => {
    const episodeId = String(episode.id || '')
    const artifactReview = artifactReviewsByEpisodeId.get(episodeId)
    if (artifactReview) return artifactReview
    const clips = params.clips
      .filter((clip) => clip.episodeId === episodeId)
      .map((clip): ScriptReviewClipInput => ({
        id: String(clip.id || ''),
        episodeId,
        content: typeof clip.content === 'string' ? clip.content : null,
        summary: typeof clip.summary === 'string' ? clip.summary : null,
        screenplay: typeof clip.screenplay === 'string' ? clip.screenplay : null,
      }))
    const voiceLines = params.voiceLines
      .filter((line) => line.episodeId === episodeId)
      .map((line): ScriptReviewVoiceLineInput => ({
        id: String(line.id || ''),
        episodeId,
        lineIndex: typeof line.lineIndex === 'number' ? line.lineIndex : 0,
        speaker: typeof line.speaker === 'string' ? line.speaker : null,
        content: typeof line.content === 'string' ? line.content : '',
        matchedPanelId: typeof line.matchedPanelId === 'string' ? line.matchedPanelId : null,
      }))
    return reviewScriptDraftQuality({
      episodeId,
      clips,
      voiceLines,
      reviewedAt: params.generatedAt.toISOString(),
    })
  }).map((review): AnyRecord => {
    const record = review as AnyRecord
    return record.reviewSource
      ? record
      : {
        ...record,
        reviewSource: 'export_fallback',
      }
  })
}

function collectRoughCutReviewRecords(params: {
  episodes: AnyRecord[]
  storyboards: AnyRecord[]
  voiceLines: AnyRecord[]
  promptSnapshots: AnyRecord[]
  generatedAt: Date
}) {
  return params.episodes.map((episode) => {
    const episodeId = String(episode.id || '')
    const storyboards = params.storyboards.filter((storyboard) => storyboard.episodeId === episodeId)
    const panelIds = new Set(storyboards.flatMap((storyboard) => {
      const panels = Array.isArray(storyboard.panels) ? storyboard.panels as AnyRecord[] : []
      return panels.flatMap((panel) => typeof panel.id === 'string' ? [panel.id] : [])
    }))
    const voiceLines = params.voiceLines.filter((line) => line.episodeId === episodeId)
    const promptSnapshots = params.promptSnapshots.filter((snapshot) => (
      typeof snapshot.refId === 'string' && panelIds.has(snapshot.refId)
    ))
    return reviewRoughCutQuality({
      episodeId,
      storyboards: storyboards.map((storyboard): RoughCutStoryboardInput => ({
        id: String(storyboard.id || ''),
        panels: (Array.isArray(storyboard.panels) ? storyboard.panels as AnyRecord[] : []).map((panel): RoughCutPanelInput => ({
          id: String(panel.id || ''),
          storyboardId: typeof panel.storyboardId === 'string' ? panel.storyboardId : null,
          panelIndex: typeof panel.panelIndex === 'number' ? panel.panelIndex : 0,
          panelNumber: typeof panel.panelNumber === 'number' ? panel.panelNumber : null,
          description: typeof panel.description === 'string' ? panel.description : null,
          imagePrompt: typeof panel.imagePrompt === 'string' ? panel.imagePrompt : null,
          videoPrompt: typeof panel.videoPrompt === 'string' ? panel.videoPrompt : null,
          imageUrl: typeof panel.imageUrl === 'string' ? panel.imageUrl : null,
          videoUrl: typeof panel.videoUrl === 'string' ? panel.videoUrl : null,
          lipSyncVideoUrl: typeof panel.lipSyncVideoUrl === 'string' ? panel.lipSyncVideoUrl : null,
          duration: typeof panel.duration === 'number' ? panel.duration : null,
          candidateImages: typeof panel.candidateImages === 'string' ? panel.candidateImages : null,
          visualQualityState: panel.visualQualityState,
        })),
      })),
      voiceLines: voiceLines.map((line): RoughCutVoiceLineInput => ({
        id: String(line.id || ''),
        lineIndex: typeof line.lineIndex === 'number' ? line.lineIndex : 0,
        content: typeof line.content === 'string' ? line.content : '',
        audioUrl: typeof line.audioUrl === 'string' ? line.audioUrl : null,
        audioMediaId: typeof line.audioMediaId === 'string' ? line.audioMediaId : null,
        audioDuration: typeof line.audioDuration === 'number' ? line.audioDuration : null,
        matchedPanelId: typeof line.matchedPanelId === 'string' ? line.matchedPanelId : null,
        matchedPanelIndex: typeof line.matchedPanelIndex === 'number' ? line.matchedPanelIndex : null,
      })),
      promptSnapshots: promptSnapshots.map((snapshot): RoughCutPromptSnapshotInput => ({
        artifactType: typeof snapshot.artifactType === 'string' ? snapshot.artifactType : null,
        refId: typeof snapshot.refId === 'string' ? snapshot.refId : null,
        payload: snapshot.payload,
      })),
      reviewedAt: params.generatedAt.toISOString(),
    })
  })
}

function collectPromptQualityReviewRecords(params: {
  promptSnapshots: AnyRecord[]
  generatedAt: Date
}) {
  return params.promptSnapshots.map((artifact) => reviewPromptSnapshotQuality({
    reviewedAt: params.generatedAt.toISOString(),
    snapshot: {
      artifactId: typeof artifact.id === 'string' ? artifact.id : null,
      runId: typeof artifact.runId === 'string' ? artifact.runId : null,
      stepKey: typeof artifact.stepKey === 'string' ? artifact.stepKey : null,
      artifactType: typeof artifact.artifactType === 'string' ? artifact.artifactType : null,
      refId: typeof artifact.refId === 'string' ? artifact.refId : null,
      payload: artifact.payload,
      createdAt: artifact.createdAt instanceof Date || typeof artifact.createdAt === 'string' ? artifact.createdAt : null,
    },
  }))
}

function stringifyJsonLines(records: AnyRecord[]): string {
  return records.map((item) => stringifyJsonLine(item)).join('\n')
}

function buildQualityArtifactViews(artifacts: AnyRecord[]) {
  const promptSnapshots = filterArtifactsByType(artifacts, PROMPT_SNAPSHOT_ARTIFACT_TYPES)
  const assetBibleReuses = filterArtifactsByType(artifacts, ASSET_BIBLE_REUSE_ARTIFACT_TYPES)
  const contentQualityReviews = filterArtifactsByType(artifacts, CONTENT_QUALITY_REVIEW_ARTIFACT_TYPES)
  const contentPlanReuses = filterArtifactsByType(artifacts, CONTENT_PLAN_REUSE_ARTIFACT_TYPES)
  const visualQualityReviews = filterArtifactsByType(artifacts, VISUAL_QUALITY_REVIEW_ARTIFACT_TYPES)
  const visualPlanReuses = filterArtifactsByType(artifacts, VISUAL_PLAN_REUSE_ARTIFACT_TYPES)
  const visualAutoRepairs = filterArtifactsByType(artifacts, VISUAL_AUTO_REPAIR_ARTIFACT_TYPES)
  const visualBindingPlans = filterArtifactsByType(artifacts, VISUAL_BINDING_PLAN_ARTIFACT_TYPES)
  const visualBeatPlans = filterArtifactsByType(artifacts, VISUAL_BEAT_PLAN_ARTIFACT_TYPES)
  const assetCoverageAudits = filterArtifactsByType(artifacts, ASSET_COVERAGE_AUDIT_ARTIFACT_TYPES)
  const visualGenerationRoutes = filterArtifactsByType(artifacts, VISUAL_GENERATION_ROUTE_ARTIFACT_TYPES)
  const storyboardQualityReviews = filterArtifactsByType(artifacts, STORYBOARD_QUALITY_REVIEW_ARTIFACT_TYPES)
  const scriptQualityReviews = filterArtifactsByType(artifacts, SCRIPT_QUALITY_REVIEW_ARTIFACT_TYPES)
  const visualRepairLineage = collectRepairLineageRecords([
    ...visualQualityReviews,
    ...visualAutoRepairs,
  ])
  return {
    promptSnapshots,
    assetBibleReuses,
    contentQualityReviews,
    contentPlanReuses,
    scriptQualityReviews,
    storyboardQualityReviews,
    visualQualityReviews,
    visualPlanReuses,
    visualAutoRepairs,
    visualBindingPlans,
    visualBeatPlans,
    assetCoverageAudits,
    visualGenerationRoutes,
    visualRepairLineage,
  }
}

function parseProjectLlmInvocations(logText: string, includeReasoning: boolean): AnyRecord[] {
  const records: AnyRecord[] = []
  const pending = new Map<string, AnyRecord[]>()
  const lines = logText.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event: AnyRecord
    try {
      event = asRecord(JSON.parse(trimmed))
    } catch {
      continue
    }
    const action = typeof event.action === 'string' ? event.action : ''
    if (action !== 'llm.raw.input' && action !== 'llm.raw.output' && action !== 'llm.raw.error') continue
    const details = asRecord(event.details)
    const model = asRecord(details.model)
    const provider = typeof event.provider === 'string' ? event.provider : typeof model.provider === 'string' ? model.provider : null
    const modelKey = typeof model.key === 'string' ? model.key : null
    const step = asRecord(details.step)
    const invocationId = typeof details.invocationId === 'string' ? details.invocationId : null
    const attempt = typeof details.attempt === 'number' ? details.attempt : null
    const fallbackKey = [provider || '', modelKey || '', typeof step.id === 'string' ? step.id : '', typeof details.action === 'string' ? details.action : ''].join('|')
    const key = invocationId ? `invocation:${invocationId}` : `legacy:${fallbackKey}`

    if (action === 'llm.raw.input') {
      const invocation: AnyRecord = {
        source: 'project-log',
        invocationId,
        attempt,
        at: event.ts || null,
        action: details.action || null,
        provider,
        modelId: typeof model.id === 'string' ? model.id : null,
        modelKey,
        step: Object.keys(step).length > 0 ? step : null,
        input: {
          messages: Array.isArray(details.messages) ? details.messages : [],
          options: details.options || null,
          imageCount: typeof details.imageCount === 'number' ? details.imageCount : 0,
        },
        outputText: null,
        outputReasoning: includeReasoning ? null : '[OMITTED]',
        usageJson: null,
        errors: [],
        status: 'input_logged',
        startedAt: event.ts || null,
        finishedAt: null,
      }
      records.push(invocation)
      const queue = pending.get(key) || []
      queue.push(invocation)
      pending.set(key, queue)
      continue
    }

    if (action === 'llm.raw.error') {
      const queue = pending.get(key) || []
      const invocation = queue[0]
      const errorRecord = {
        at: event.ts || null,
        attempt,
        retryable: event.retryable === true,
        durationMs: event.durationMs || null,
        error: details.error || null,
      }
      if (!invocation) {
        records.push({
          source: 'project-log',
          invocationId,
          attempt,
          at: event.ts || null,
          action: details.action || null,
          provider,
          modelId: typeof model.id === 'string' ? model.id : null,
          modelKey,
          step: Object.keys(step).length > 0 ? step : null,
          input: null,
          outputText: null,
          outputReasoning: includeReasoning ? null : '[OMITTED]',
          usageJson: null,
          errors: [errorRecord],
          status: 'failed',
          startedAt: null,
          finishedAt: event.ts || null,
        })
      } else {
        const errors = Array.isArray(invocation.errors) ? invocation.errors : []
        errors.push(errorRecord)
        invocation.errors = errors
        invocation.status = event.retryable === true ? 'retrying' : 'failed'
        invocation.finishedAt = event.retryable === true ? null : event.ts || null
      }
      continue
    }

    const queue = pending.get(key) || []
    const invocation = queue.shift()
    const output = asRecord(details.output)
    if (!invocation) {
      records.push({
        source: 'project-log',
        invocationId,
        attempt,
        at: event.ts || null,
        action: details.action || null,
        provider,
        modelId: typeof model.id === 'string' ? model.id : null,
        modelKey,
        step: Object.keys(step).length > 0 ? step : null,
        input: null,
        outputText: typeof output.text === 'string' ? output.text : null,
        outputReasoning: includeReasoning ? (typeof output.reasoning === 'string' ? output.reasoning : null) : '[OMITTED]',
        usageJson: details.usage || null,
        errors: [],
        status: 'output_logged_without_input',
        startedAt: null,
        finishedAt: event.ts || null,
      })
    } else {
      invocation.outputText = typeof output.text === 'string' ? output.text : null
      invocation.outputReasoning = includeReasoning ? (typeof output.reasoning === 'string' ? output.reasoning : null) : '[OMITTED]'
      invocation.usageJson = details.usage || null
      invocation.status = 'completed'
      invocation.finishedAt = event.ts || null
      invocation.attempt = attempt ?? invocation.attempt
    }
    if (queue.length > 0) pending.set(key, queue)
    else pending.delete(key)
  }

  for (const queue of pending.values()) {
    for (const invocation of queue) {
      if (Array.isArray(invocation.errors) && invocation.errors.length > 0 && invocation.status !== 'completed') {
        invocation.status = 'failed'
      }
    }
  }

  return records
}

function mergeInvocationSources(graphInvocations: AnyRecord[], logInvocations: AnyRecord[]): AnyRecord[] {
  const merged = [...graphInvocations]
  for (const logInvocation of logInvocations) {
    const step = asRecord(logInvocation.step)
    const stepId = typeof step.id === 'string' ? step.id : null
    const attempt = typeof logInvocation.attempt === 'number' ? logInvocation.attempt : null
    const modelKey = typeof logInvocation.modelKey === 'string' ? logInvocation.modelKey : null
    const match = merged.find((candidate) => {
      if (candidate.source !== 'graph' || (stepId && candidate.stepKey !== stepId)) return false
      if (attempt && candidate.attempt !== attempt) return false
      if (modelKey && candidate.modelKey && candidate.modelKey !== modelKey) return false
      return true
    })
    if (!match) {
      merged.push(logInvocation)
      continue
    }
    match.invocationId = logInvocation.invocationId || match.invocationId || null
    match.rawLog = {
      source: 'project-log',
      input: logInvocation.input,
      outputText: logInvocation.outputText,
      outputReasoning: logInvocation.outputReasoning,
      status: logInvocation.status,
      startedAt: logInvocation.startedAt,
      finishedAt: logInvocation.finishedAt,
    }
    if (!match.input && logInvocation.input) match.input = logInvocation.input
    if (!match.outputText && logInvocation.outputText) match.outputText = logInvocation.outputText
    if (!match.usageJson && logInvocation.usageJson) match.usageJson = logInvocation.usageJson
  }
  return merged
}

function buildValidationChecks(tasks: AnyRecord[], runs: AnyRecord[], mediaIndex: AnyRecord[]): AnyRecord[] {
  const checks: AnyRecord[] = []
  for (const task of tasks) {
    const status = typeof task.status === 'string' ? task.status : 'unknown'
    checks.push({
      checkId: `task:${String(task.id)}`,
      kind: 'task_terminal_state',
      status: ['completed', 'failed', 'cancelled'].includes(status) ? 'passed' : 'attention',
      taskId: task.id,
      actual: status,
    })
  }
  for (const run of runs) {
    const steps = Array.isArray(run.steps) ? run.steps as AnyRecord[] : []
    for (const step of steps) {
      const status = typeof step.status === 'string' ? step.status : 'unknown'
      checks.push({
        checkId: `step:${String(run.id)}:${String(step.stepKey)}`,
        kind: 'graph_step_terminal_state',
        status: ['completed', 'failed', 'cancelled'].includes(status) ? 'passed' : 'attention',
        runId: run.id,
        stepKey: step.stepKey,
        actual: status,
      })
    }
  }
  for (const media of mediaIndex) {
    checks.push({
      checkId: `media:${String(media.storageKey)}`,
      kind: 'media_archive_integrity',
      status: media.included === true ? 'passed' : 'attention',
      storageKey: media.storageKey,
      reason: media.omittedReason || null,
    })
  }
  return checks
}

function buildQualitySignals(params: {
  tasks: AnyRecord[]
  runs: AnyRecord[]
  invocations: AnyRecord[]
  mediaIndex: AnyRecord[]
  assetBibleReuses: AnyRecord[]
  contentPlanReuses: AnyRecord[]
  visualPlanReuses: AnyRecord[]
  scriptReviews: AnyRecord[]
  promptQualityReviews: AnyRecord[]
  roughCutReviews: AnyRecord[]
  pickupList: AnyRecord[]
}): AnyRecord {
  const failedTasks = params.tasks.filter((task) => task.status === 'failed').length
  const failedRuns = params.runs.filter((run) => run.status === 'failed').length
  const failedAttempts = params.runs.flatMap((run) => {
    const steps = Array.isArray(run.steps) ? run.steps as AnyRecord[] : []
    return steps.flatMap((step) => Array.isArray(step.attempts) ? step.attempts as AnyRecord[] : [])
  }).filter((attempt) => attempt.status === 'failed' || attempt.errorCode || attempt.errorMessage).length
  const omittedMedia = params.mediaIndex.filter((media) => media.included !== true).length
  const signals: AnyRecord[] = []
  if (failedTasks || failedRuns || failedAttempts) {
    signals.push({
      code: 'workflow_failures',
      severity: 'high',
      category: 'workflow',
      counts: { failedTasks, failedRuns, failedAttempts },
      interpretation: '优先检查任务顺序、状态转换、重试和模型错误。',
    })
  }
  if (omittedMedia) {
    signals.push({
      code: 'media_omitted',
      severity: 'medium',
      category: 'media',
      count: omittedMedia,
      interpretation: '媒体可能因导出选项、文件大小或存储读取失败而未进入压缩包。',
    })
  }
  const incompleteInvocations = params.invocations.filter((item) => item.status === 'input_logged' || item.status === 'output_logged_without_input').length
  if (incompleteInvocations) {
    signals.push({
      code: 'incomplete_model_trace',
      severity: 'high',
      category: 'observability',
      count: incompleteInvocations,
      interpretation: '模型调用输入输出未完整关联，不能直接判断提示词质量。',
    })
  }
  if (params.assetBibleReuses.length > 0) {
    signals.push({
      code: 'asset_bible_reuse',
      severity: 'info',
      category: 'stability',
      count: params.assetBibleReuses.length,
      revisions: params.assetBibleReuses.map((artifact) => {
        const payload = asRecord(artifact.payload)
        return {
          episodeId: artifact.refId || null,
          contentRevision: payload.contentRevision || null,
          analyzedRevision: payload.analyzedRevision || null,
          assetCount: payload.assetCount || null,
          reason: payload.reason || null,
        }
      }),
      interpretation: '资产需求复用了已批准 AssetBible，本次未重新调用模型提取资产。',
    })
  }
  if (params.contentPlanReuses.length > 0) {
    signals.push({
      code: 'content_plan_reuse',
      severity: 'info',
      category: 'stability',
      count: params.contentPlanReuses.length,
      revisions: params.contentPlanReuses.map((artifact) => {
        const payload = asRecord(artifact.payload)
        return {
          episodeId: artifact.refId || null,
          revision: payload.revision || null,
          approvedRevision: payload.approvedRevision || null,
          reason: payload.reason || null,
        }
      }),
      interpretation: '内容计划复用了已批准版本，本次未重新调用模型生成 ContentPlan。',
    })
  }
  if (params.visualPlanReuses.length > 0) {
    signals.push({
      code: 'visual_plan_reuse',
      severity: 'info',
      category: 'stability',
      count: params.visualPlanReuses.length,
      revisions: params.visualPlanReuses.map((artifact) => {
        const payload = asRecord(artifact.payload)
        return {
          episodeId: artifact.refId || null,
          revision: payload.revision || null,
          approvedRevision: payload.approvedRevision || null,
          visualUnitCount: payload.visualUnitCount || null,
          reason: payload.reason || null,
        }
      }),
      interpretation: '视觉计划复用了已批准版本，本次未重新调用模型生成 ShotPlan/VisualUnits。',
    })
  }
  const scriptAttention = params.scriptReviews.filter((review) => (
    review.status === 'repairable'
    || review.status === 'human_required'
    || review.status === 'failed'
  ))
  if (scriptAttention.length > 0) {
    signals.push({
      code: 'script_review_attention',
      severity: scriptAttention.some((review) => review.status === 'human_required' || review.status === 'failed') ? 'high' : 'medium',
      category: 'script',
      count: scriptAttention.length,
      reviewScores: scriptAttention.map((review) => ({
        episodeId: review.targetId || null,
        score: review.score || null,
        status: review.status || null,
      })),
      interpretation: '最终文稿/剧本存在修订风险，请优先查看 quality/script-reviews.jsonl。',
    })
  }
  const promptAttention = params.promptQualityReviews.filter((review) => (
    review.status === 'repairable'
    || review.status === 'human_required'
    || review.status === 'failed'
  ))
  if (promptAttention.length > 0) {
    signals.push({
      code: 'prompt_review_attention',
      severity: promptAttention.some((review) => review.status === 'human_required' || review.status === 'failed') ? 'high' : 'medium',
      category: 'prompt',
      count: promptAttention.length,
      reviewScores: promptAttention.map((review) => ({
        targetId: review.targetId || null,
        snapshotType: review.snapshotType || null,
        score: review.score || null,
        status: review.status || null,
      })),
      interpretation: '最终 compiled prompt 存在结构或版本化风险，请优先查看 quality/prompt-quality-reviews.jsonl。',
    })
  }
  const blockingPickupCount = params.pickupList.filter((item) => item.severity === 'blocking').length
  if (params.pickupList.length > 0) {
    signals.push({
      code: 'rough_cut_pickups',
      severity: blockingPickupCount > 0 ? 'high' : 'medium',
      category: 'rough_cut',
      count: params.pickupList.length,
      blockingCount: blockingPickupCount,
      reviewScores: params.roughCutReviews.map((review) => ({
        episodeId: review.targetId || null,
        score: review.score || null,
        status: review.status || null,
      })),
      interpretation: '成片预演发现返工项，请优先查看 quality/pickup-list.jsonl。',
    })
  }
  return {
    generatedAt: new Date(),
    summary: {
      workflowFailureCount: failedTasks + failedRuns + failedAttempts,
      incompleteInvocationCount: incompleteInvocations,
      omittedMediaCount: omittedMedia,
      assetBibleReuseCount: params.assetBibleReuses.length,
      contentPlanReuseCount: params.contentPlanReuses.length,
      visualPlanReuseCount: params.visualPlanReuses.length,
      scriptReviewAttentionCount: scriptAttention.length,
      promptReviewAttentionCount: promptAttention.length,
      roughCutPickupCount: params.pickupList.length,
      roughCutBlockingPickupCount: blockingPickupCount,
    },
    signals,
  }
}

async function createArchive(params: {
  taskId: string
  projectId: string
  options: DiagnosticExportOptions
}): Promise<{ buffer: Buffer; manifest: AnyRecord }> {
  const options = {
    episodeId: params.options.episodeId || null,
    includeCandidates: params.options.includeCandidates !== false,
    includeVideos: params.options.includeVideos !== false,
    includeAllVideos: params.options.includeAllVideos === true,
    includeReasoning: params.options.includeReasoning !== false,
  }
  const data = await collectProjectData(params.projectId, options.episodeId)
  const timeline = buildTimeline(data.tasks as unknown as AnyRecord[], data.runs as unknown as AnyRecord[])
  const artifactRecords = buildArtifactRecords(data.runs as unknown as AnyRecord[])
  const qualityArtifacts = buildQualityArtifactViews(artifactRecords)
  const assetBibleRecords = collectAssetBibleRecords(data.domain.episodes as unknown as AnyRecord[])
  const assetBibleReviewRecords = collectAssetBibleReviewRecords(data.domain.episodes as unknown as AnyRecord[])
  const generatedAt = new Date()
  const scriptReviewRecords = collectScriptReviewRecords({
    episodes: data.domain.episodes as unknown as AnyRecord[],
    clips: data.domain.clips as unknown as AnyRecord[],
    voiceLines: data.domain.voiceLines as unknown as AnyRecord[],
    scriptQualityReviews: qualityArtifacts.scriptQualityReviews,
    generatedAt,
  })
  const roughCutReviewRecords = collectRoughCutReviewRecords({
    episodes: data.domain.episodes as unknown as AnyRecord[],
    storyboards: data.domain.storyboards as unknown as AnyRecord[],
    voiceLines: data.domain.voiceLines as unknown as AnyRecord[],
    promptSnapshots: qualityArtifacts.promptSnapshots,
    generatedAt,
  })
  const promptQualityReviewRecords = collectPromptQualityReviewRecords({
    promptSnapshots: qualityArtifacts.promptSnapshots,
    generatedAt,
  })
  const pickupListRecords = roughCutReviewRecords.flatMap((review) => (
    review.pickupItems.map((item) => ({
      episodeId: review.targetId,
      reviewScore: review.score,
      reviewStatus: review.status,
      reviewedAt: review.reviewedAt,
      ...item,
    }))
  ))
  const archive = archiver('zip', { zlib: { level: 6 } })
  const output = new PassThrough()
  const chunks: Buffer[] = []
  const maxFileBytes = Number(process.env.DIAGNOSTIC_MAX_MEDIA_FILE_BYTES) || DEFAULT_MAX_FILE_BYTES
  const maxArchiveBytes = Number(process.env.DIAGNOSTIC_MAX_ARCHIVE_BYTES) || DEFAULT_MAX_ARCHIVE_BYTES
  output.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<void>((resolve, reject) => {
    output.on('end', resolve)
    output.on('error', reject)
    archive.on('error', reject)
  })
  archive.pipe(output)

  const redactedTasks = data.tasks.map((task) => ({
    ...task,
    events: task.events,
    result: options.includeReasoning ? task.result : redactReasoning(task.result),
    payload: options.includeReasoning ? task.payload : redactReasoning(task.payload),
  }))
  const redactedRuns = data.runs.map((run) => options.includeReasoning ? run : redactReasoning(run))
  archive.append(stringifyJson({ project: data.project, domain: data.domain }), { name: 'snapshots/project.json' })
  archive.append(stringifyJson(redactedTasks), { name: 'tasks/tasks.json' })
  archive.append(stringifyJson(redactedRuns), { name: 'runs/runs.json' })
  archive.append(stringifyJson(timeline), { name: 'summary/timeline.json' })
  archive.append(stringifyJson([ 
    ...data.tasks.filter((task) => task.errorCode || task.errorMessage).map((task) => ({ source: 'task', taskId: task.id, type: task.type, errorCode: task.errorCode, errorMessage: task.errorMessage })),
    ...data.runs.filter((run) => run.errorCode || run.errorMessage).map((run) => ({ source: 'graph_run', runId: run.id, errorCode: run.errorCode, errorMessage: run.errorMessage })),
    ...data.runs.flatMap((run) => run.steps.flatMap((step) => step.attempts.filter((attempt) => attempt.errorCode || attempt.errorMessage).map((attempt) => ({ source: 'model_attempt', runId: run.id, stepKey: step.stepKey, attempt: attempt.attempt, errorCode: attempt.errorCode, errorMessage: attempt.errorMessage })))),
  ]), { name: 'errors/errors.json' })
  const graphInvocations = data.runs.flatMap((run) => run.steps.flatMap((step) => step.attempts.map((attempt) => ({
    source: 'graph',
    runId: run.id,
    stepKey: step.stepKey,
    attempt: attempt.attempt,
    provider: attempt.provider,
    modelKey: attempt.modelKey,
    input: attempt.input,
    outputText: attempt.outputText,
    outputReasoning: options.includeReasoning ? attempt.outputReasoning : '[OMITTED]',
    usageJson: attempt.usageJson,
    status: attempt.status,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
  }))))
  const projectLogs = await readProjectLogs(data.project.name, data.project.id)
  const logInvocations = parseProjectLlmInvocations(projectLogs, options.includeReasoning)
  const promptInvocations = mergeInvocationSources(graphInvocations, logInvocations)
  archive.append(promptInvocations.map((item) => stringifyJsonLine(item)).join('\n'), { name: 'prompts/invocations.jsonl' })
  if (projectLogs) archive.append(redactLogText(projectLogs), { name: 'system/project-logs.txt' })
  archive.append(stringifyJson({
    workflow: data.domain.novelProject,
    taskTypes: [...new Set(data.tasks.map((task) => task.type))],
    mediaReferences: Object.fromEntries(collectMediaValues({ domain: data.domain, tasks: data.tasks, runs: data.runs })),
  }), { name: 'system/runtime-snapshot.json' })

  const mediaIndex: AnyRecord[] = []
  let totalBytes = 0
  for (const [storageKey, trail] of data.linkedMedia) {
    const media = data.media.find((item) => item.storageKey === storageKey)
    const isVideo = isVideoMedia(media?.mimeType || null, storageKey)
    const candidate = isCandidatePath(trail)
    const shouldInclude = (!candidate || options.includeCandidates) && (!isVideo || options.includeVideos) && (!isVideo || options.includeAllVideos || !candidate)
    const item: AnyRecord = {
      storageKey,
      source: trail,
      mediaId: media?.id || null,
      mimeType: media?.mimeType || null,
      sizeBytes: media?.sizeBytes ? String(media.sizeBytes) : null,
      candidate,
      lifecycle: candidate ? 'candidate_or_history' : 'current_or_final',
      included: false,
    }
    if (!shouldInclude) {
      item.omittedReason = 'export_options'
      mediaIndex.push(item)
      continue
    }
    if (media?.sizeBytes && Number(media.sizeBytes) > maxFileBytes) {
      item.omittedReason = 'file_size_limit'
      mediaIndex.push(item)
      continue
    }
    try {
      const buffer = await getObjectBuffer(storageKey)
      if (buffer.length > maxFileBytes || totalBytes + buffer.length > maxArchiveBytes) {
        item.omittedReason = totalBytes + buffer.length > maxArchiveBytes ? 'archive_size_limit' : 'file_size_limit'
        mediaIndex.push(item)
        continue
      }
      const extension = path.extname(storageKey) || (media?.mimeType?.split('/')[1] ? `.${media.mimeType.split('/')[1]}` : '')
      const name = `media/${sanitizeFilePart(media?.id || 'object')}${sanitizeFilePart(extension)}`
      archive.append(buffer, { name })
      totalBytes += buffer.length
      item.included = true
      item.archivePath = name
    } catch (error) {
      item.omittedReason = 'storage_read_failed'
      item.error = error instanceof Error ? error.message : String(error)
    }
    mediaIndex.push(item)
  }
  archive.append(stringifyJson(mediaIndex), { name: 'media/media-index.json' })
  archive.append(stringifyJson(artifactRecords), { name: 'snapshots/artifacts.json' })
  archive.append(stringifyJsonLines(assetBibleRecords), { name: 'quality/asset-bible.jsonl' })
  archive.append(stringifyJsonLines(assetBibleReviewRecords), { name: 'quality/asset-bible-reviews.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.assetBibleReuses), { name: 'quality/asset-bible-reuse.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.contentQualityReviews), { name: 'quality/content-quality-reviews.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.contentPlanReuses), { name: 'quality/content-plan-reuse.jsonl' })
  archive.append(stringifyJsonLines(scriptReviewRecords as unknown as AnyRecord[]), { name: 'quality/script-reviews.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.storyboardQualityReviews), { name: 'quality/storyboard-quality-reviews.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.promptSnapshots), { name: 'quality/prompt-snapshots.jsonl' })
  archive.append(stringifyJsonLines(promptQualityReviewRecords as unknown as AnyRecord[]), { name: 'quality/prompt-quality-reviews.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.visualQualityReviews), { name: 'quality/visual-quality-reviews.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.visualPlanReuses), { name: 'quality/visual-plan-reuse.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.visualBeatPlans), { name: 'quality/visual-beat-plans.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.assetCoverageAudits), { name: 'quality/asset-coverage-audits.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.visualBindingPlans), { name: 'quality/visual-binding-plans.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.visualGenerationRoutes), { name: 'quality/visual-generation-routes.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.visualAutoRepairs), { name: 'quality/visual-auto-repairs.jsonl' })
  archive.append(stringifyJsonLines(qualityArtifacts.visualRepairLineage), { name: 'quality/visual-repair-lineage.jsonl' })
  archive.append(stringifyJsonLines(roughCutReviewRecords as unknown as AnyRecord[]), { name: 'quality/rough-cut-reviews.jsonl' })
  archive.append(stringifyJsonLines(pickupListRecords), { name: 'quality/pickup-list.jsonl' })
  archive.append(stringifyJson({
    promptSnapshotCount: qualityArtifacts.promptSnapshots.length,
    assetBibleCount: assetBibleRecords.length,
    assetBibleReviewCount: assetBibleReviewRecords.length,
    assetBibleReuseCount: qualityArtifacts.assetBibleReuses.length,
    contentQualityReviewCount: qualityArtifacts.contentQualityReviews.length,
    contentPlanReuseCount: qualityArtifacts.contentPlanReuses.length,
    scriptReviewCount: scriptReviewRecords.length,
    storyboardQualityReviewCount: qualityArtifacts.storyboardQualityReviews.length,
    visualQualityReviewCount: qualityArtifacts.visualQualityReviews.length,
    promptQualityReviewCount: promptQualityReviewRecords.length,
    visualPlanReuseCount: qualityArtifacts.visualPlanReuses.length,
    visualBeatPlanCount: qualityArtifacts.visualBeatPlans.length,
    assetCoverageAuditCount: qualityArtifacts.assetCoverageAudits.length,
    visualBindingPlanCount: qualityArtifacts.visualBindingPlans.length,
    visualGenerationRouteCount: qualityArtifacts.visualGenerationRoutes.length,
    visualAutoRepairCount: qualityArtifacts.visualAutoRepairs.length,
    visualRepairLineageCount: qualityArtifacts.visualRepairLineage.length,
    roughCutReviewCount: roughCutReviewRecords.length,
    pickupItemCount: pickupListRecords.length,
    files: {
      assetBible: 'quality/asset-bible.jsonl',
      assetBibleReviews: 'quality/asset-bible-reviews.jsonl',
      assetBibleReuse: 'quality/asset-bible-reuse.jsonl',
      contentQualityReviews: 'quality/content-quality-reviews.jsonl',
      contentPlanReuse: 'quality/content-plan-reuse.jsonl',
      scriptReviews: 'quality/script-reviews.jsonl',
      storyboardQualityReviews: 'quality/storyboard-quality-reviews.jsonl',
      promptSnapshots: 'quality/prompt-snapshots.jsonl',
      promptQualityReviews: 'quality/prompt-quality-reviews.jsonl',
      visualQualityReviews: 'quality/visual-quality-reviews.jsonl',
      visualPlanReuse: 'quality/visual-plan-reuse.jsonl',
      visualBeatPlans: 'quality/visual-beat-plans.jsonl',
      assetCoverageAudits: 'quality/asset-coverage-audits.jsonl',
      visualBindingPlans: 'quality/visual-binding-plans.jsonl',
      visualGenerationRoutes: 'quality/visual-generation-routes.jsonl',
      visualAutoRepairs: 'quality/visual-auto-repairs.jsonl',
      visualRepairLineage: 'quality/visual-repair-lineage.jsonl',
      roughCutReviews: 'quality/rough-cut-reviews.jsonl',
      pickupList: 'quality/pickup-list.jsonl',
    },
  }), { name: 'quality/quality-index.json' })
  const validationChecks = buildValidationChecks(data.tasks as unknown as AnyRecord[], data.runs as unknown as AnyRecord[], mediaIndex)
  archive.append(stringifyJson(validationChecks), { name: 'validation/checks.json' })
  archive.append(stringifyJson(buildQualitySignals({
    tasks: data.tasks as unknown as AnyRecord[],
    runs: data.runs as unknown as AnyRecord[],
    invocations: promptInvocations,
    mediaIndex,
    assetBibleReuses: qualityArtifacts.assetBibleReuses,
    contentPlanReuses: qualityArtifacts.contentPlanReuses,
    visualPlanReuses: qualityArtifacts.visualPlanReuses,
    scriptReviews: scriptReviewRecords as unknown as AnyRecord[],
    promptQualityReviews: promptQualityReviewRecords as unknown as AnyRecord[],
    roughCutReviews: roughCutReviewRecords as unknown as AnyRecord[],
    pickupList: pickupListRecords,
  })), { name: 'summary/quality-signals.json' })
  const includedMedia = mediaIndex.filter((item) => item.included === true).length
  const manifest = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    generatedAt,
    taskId: params.taskId,
    projectId: params.projectId,
    options,
    counts: {
      tasks: data.tasks.length,
      runs: data.runs.length,
      mediaReferences: data.linkedMedia.size,
      mediaIncluded: includedMedia,
      mediaOmitted: mediaIndex.length - includedMedia,
      timelineEvents: timeline.length,
      modelInvocations: promptInvocations.length,
      artifacts: artifactRecords.length,
      assetBibleRecords: assetBibleRecords.length,
      assetBibleReviews: assetBibleReviewRecords.length,
      assetBibleReuses: qualityArtifacts.assetBibleReuses.length,
      contentQualityReviews: qualityArtifacts.contentQualityReviews.length,
      contentPlanReuses: qualityArtifacts.contentPlanReuses.length,
      scriptReviews: scriptReviewRecords.length,
      storyboardQualityReviews: qualityArtifacts.storyboardQualityReviews.length,
      promptSnapshots: qualityArtifacts.promptSnapshots.length,
      promptQualityReviews: promptQualityReviewRecords.length,
      visualQualityReviews: qualityArtifacts.visualQualityReviews.length,
      visualPlanReuses: qualityArtifacts.visualPlanReuses.length,
      visualBeatPlans: qualityArtifacts.visualBeatPlans.length,
      assetCoverageAudits: qualityArtifacts.assetCoverageAudits.length,
      visualBindingPlans: qualityArtifacts.visualBindingPlans.length,
      visualGenerationRoutes: qualityArtifacts.visualGenerationRoutes.length,
      visualAutoRepairs: qualityArtifacts.visualAutoRepairs.length,
      visualRepairLineageRecords: qualityArtifacts.visualRepairLineage.length,
      roughCutReviews: roughCutReviewRecords.length,
      pickupItems: pickupListRecords.length,
    },
    limits: {
      maxMediaFileBytes: maxFileBytes,
      maxArchiveMediaBytes: maxArchiveBytes,
    },
  }
  archive.append(stringifyJson(manifest), { name: 'manifest.json' })
  archive.append([
    '# Waoowaoo Project Diagnostic Package',
    '',
    'This package is intended for offline analysis of the complete creation workflow.',
    'It contains project snapshots, task and Graph events, correlated model invocation records, validation checks, media indexes and selected media files.',
    'Quality-focused traces are also grouped under quality/: content, script, asset, storyboard, prompt, visual and rough-cut reviews, prompt snapshots, asset/content/visual plan reuse, auto repairs, repair lineage and pickup lists.',
    'Use invocationId, runId, stepKey and artifact references to distinguish prompt/model issues from workflow/state issues.',
    'Secrets and credentials are redacted during export.',
    `Reasoning included: ${options.includeReasoning ? 'yes' : 'no'}.`,
  ].join('\n'), { name: 'README.md' })
  await archive.finalize()
  await finished
  const buffer = Buffer.concat(chunks)
  return { buffer, manifest: { ...manifest, archiveBytes: buffer.length, mediaBytes: totalBytes } }
}

function redactReasoning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactReasoning)
  if (!value || typeof value !== 'object') return value
  const record = value as AnyRecord
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, /reasoning|think/i.test(key) ? '[OMITTED]' : redactReasoning(child)]))
}

export async function buildDiagnosticExport(job: Job<TaskJobData>): Promise<Record<string, unknown>> {
  const payload = asRecord(job.data.payload)
  const options = asRecord(payload.options) as DiagnosticExportOptions
  const { buffer, manifest } = await createArchive({
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    options,
  })
  const storageKey = await uploadObject(buffer, `diagnostics/${job.data.projectId}/${job.data.taskId}.zip`, 2, 'application/zip')
  return {
    artifactType: 'diagnostic_archive',
    storageKey,
    fileName: `waoowaoo-diagnostic-${job.data.projectId}-${job.data.taskId}.zip`,
    ...manifest,
  }
}

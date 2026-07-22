import archiver from 'archiver'
import { PassThrough } from 'node:stream'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { extractStorageKey, getObjectBuffer, uploadObject } from '@/lib/storage'
import { readProjectLogs } from '@/lib/logging/file-writer'
import type { TaskJobData } from '@/lib/task/types'
import type { Job } from 'bullmq'

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_ARCHIVE_BYTES = 400 * 1024 * 1024
const DIAGNOSTIC_SCHEMA_VERSION = 2

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
  return {
    generatedAt: new Date(),
    summary: {
      workflowFailureCount: failedTasks + failedRuns + failedAttempts,
      incompleteInvocationCount: incompleteInvocations,
      omittedMediaCount: omittedMedia,
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
  const generatedAt = new Date()
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
  archive.append(stringifyJson(data.runs.flatMap((run) => Array.isArray(run.artifacts)
    ? run.artifacts.map((artifact) => {
      const artifactData = Object.fromEntries(
        Object.entries(artifact as AnyRecord).filter(([key]) => key !== 'runId'),
      )
      return { runId: run.id, ...artifactData }
    })
    : [])), { name: 'snapshots/artifacts.json' })
  const validationChecks = buildValidationChecks(data.tasks as unknown as AnyRecord[], data.runs as unknown as AnyRecord[], mediaIndex)
  archive.append(stringifyJson(validationChecks), { name: 'validation/checks.json' })
  archive.append(stringifyJson(buildQualitySignals({
    tasks: data.tasks as unknown as AnyRecord[],
    runs: data.runs as unknown as AnyRecord[],
    invocations: promptInvocations,
    mediaIndex,
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

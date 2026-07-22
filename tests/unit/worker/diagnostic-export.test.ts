import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import JSZip from 'jszip'
import { prisma } from '@/lib/prisma'
import { extractStorageKey, getObjectBuffer, uploadObject } from '@/lib/storage'
import { buildDiagnosticExport } from '@/lib/diagnostics/exporter'
import { TASK_TYPE } from '@/lib/task/types'
import { readProjectLogs } from '@/lib/logging/file-writer'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    novelPromotionProject: { findUnique: vi.fn() },
    novelPromotionEpisode: { findMany: vi.fn() },
    novelPromotionCharacter: { findMany: vi.fn() },
    novelPromotionLocation: { findMany: vi.fn() },
    novelPromotionClip: { findMany: vi.fn() },
    novelPromotionShot: { findMany: vi.fn() },
    novelPromotionStoryboard: { findMany: vi.fn() },
    novelPromotionVoiceLine: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    graphRun: { findMany: vi.fn() },
    mediaObject: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/storage', () => ({
  extractStorageKey: vi.fn(() => null),
  getObjectBuffer: vi.fn(),
  uploadObject: vi.fn(async (_buffer: Buffer, key: string) => key),
}))

vi.mock('@/lib/logging/file-writer', () => ({
  readProjectLogs: vi.fn(async () => ''),
}))

describe('diagnostic export task contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'project-1',
      name: 'Diagnostic Project',
      description: null,
      userId: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastAccessedAt: null,
    })
    vi.mocked(prisma.novelPromotionProject.findUnique).mockResolvedValue({ id: 'novel-1', projectId: 'project-1' } as never)
    const emptyModels = [
      prisma.novelPromotionEpisode,
      prisma.novelPromotionCharacter,
      prisma.novelPromotionLocation,
      prisma.novelPromotionClip,
      prisma.novelPromotionShot,
      prisma.novelPromotionStoryboard,
      prisma.novelPromotionVoiceLine,
      prisma.task,
      prisma.graphRun,
      prisma.mediaObject,
    ] as const
    emptyModels.forEach((model) => vi.mocked(model.findMany).mockResolvedValue([] as never))
  })

  it('builds and uploads a zip artifact for the project workflow', async () => {
    const job = {
      data: {
        taskId: 'task-1',
        type: TASK_TYPE.DIAGNOSTIC_EXPORT,
        locale: 'zh',
        projectId: 'project-1',
        targetType: 'NovelPromotionProject',
        targetId: 'project-1',
        userId: 'user-1',
        payload: { options: { includeCandidates: true, includeVideos: true } },
      },
    } as Job

    const result = await buildDiagnosticExport(job)

    expect(uploadObject).toHaveBeenCalledOnce()
    const [archiveBuffer, storageKey] = vi.mocked(uploadObject).mock.calls[0]
    expect(archiveBuffer.subarray(0, 2).toString('utf8')).toBe('PK')
    expect(storageKey).toBe('diagnostics/project-1/task-1.zip')
    expect(result).toMatchObject({ artifactType: 'diagnostic_archive', storageKey })
  })

  it('writes strict jsonl and redacts sensitive model input', async () => {
    vi.mocked(prisma.graphRun.findMany).mockResolvedValue([{
      id: 'run-1',
      events: [],
      steps: [{
        stepKey: 'script',
        attempts: [{
          attempt: 1,
          provider: 'test',
          modelKey: 'test-model',
          input: { prompt: 'hello', apiKey: 'secret-value' },
          outputText: '{"ok":true}',
          outputReasoning: null,
          usageJson: { totalTokens: 12 },
          status: 'completed',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          finishedAt: new Date('2026-01-01T00:00:01.000Z'),
        }],
      }],
      attempts: [],
      checkpoints: [],
      artifacts: [],
      workflowType: 'story_to_script',
      taskType: 'story_to_script',
      status: 'completed',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }] as never)

    const job = {
      data: {
        taskId: 'task-2',
        type: TASK_TYPE.DIAGNOSTIC_EXPORT,
        locale: 'zh',
        projectId: 'project-1',
        targetType: 'NovelPromotionProject',
        targetId: 'project-1',
        userId: 'user-1',
        payload: { options: { includeReasoning: false } },
      },
    } as Job

    await buildDiagnosticExport(job)
    const [archiveBuffer] = vi.mocked(uploadObject).mock.calls[0]
    const zip = await JSZip.loadAsync(archiveBuffer)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { schemaVersion: number }
    const lines = (await zip.file('prompts/invocations.jsonl')!.async('string')).split('\n').filter(Boolean)
    const invocation = JSON.parse(lines[0]) as { input: { apiKey: string }; outputReasoning: string }

    expect(manifest.schemaVersion).toBe(2)
    expect(lines).toHaveLength(1)
    expect(invocation.input.apiKey).toBe('[REDACTED]')
    expect(invocation.outputReasoning).toBe('[OMITTED]')
    expect(await zip.file('README.md')!.async('string')).toContain('offline analysis')
  })

  it('correlates raw project-log input and output by invocationId', async () => {
    vi.mocked(readProjectLogs).mockResolvedValue([
      JSON.stringify({
        ts: '2026-01-01T00:00:00.000Z',
        action: 'llm.raw.input',
        provider: 'test',
        details: {
          invocationId: 'invocation-1',
          action: 'script.generate',
          model: { id: 'model-1', key: 'test-model' },
          step: { id: 'script', attempt: 1 },
          messages: [{ role: 'user', content: '输入' }],
          options: { apiKey: 'secret' },
        },
      }),
      JSON.stringify({
        ts: '2026-01-01T00:00:01.000Z',
        action: 'llm.raw.output',
        provider: 'test',
        details: {
          invocationId: 'invocation-1',
          attempt: 1,
          action: 'script.generate',
          model: { id: 'model-1', key: 'test-model' },
          step: { id: 'script', attempt: 1 },
          output: { text: '输出', reasoning: 'reasoning' },
          usage: { promptTokens: 3, completionTokens: 4 },
        },
      }),
    ].join('\n'))

    const job = {
      data: {
        taskId: 'task-3',
        type: TASK_TYPE.DIAGNOSTIC_EXPORT,
        locale: 'zh',
        projectId: 'project-1',
        targetType: 'NovelPromotionProject',
        targetId: 'project-1',
        userId: 'user-1',
        payload: { options: { includeReasoning: false } },
      },
    } as Job

    await buildDiagnosticExport(job)
    const [archiveBuffer] = vi.mocked(uploadObject).mock.calls[0]
    const zip = await JSZip.loadAsync(archiveBuffer)
    const lines = (await zip.file('prompts/invocations.jsonl')!.async('string')).split('\n').filter(Boolean)
    const invocation = JSON.parse(lines[0]) as { invocationId: string; status: string; input: { options: { apiKey: string } }; outputText: string }

    expect(lines).toHaveLength(1)
    expect(invocation.invocationId).toBe('invocation-1')
    expect(invocation.status).toBe('completed')
    expect(invocation.input.options.apiKey).toBe('[REDACTED]')
    expect(invocation.outputText).toBe('输出')
  })

  it('archives media referenced only by task results', async () => {
    vi.mocked(extractStorageKey).mockImplementation((value: string | null | undefined) => value?.startsWith('tasks/') ? value : null)
    vi.mocked(getObjectBuffer).mockResolvedValue(Buffer.from('video-data'))
    vi.mocked(prisma.task.findMany).mockResolvedValue([{
      id: 'generation-task',
      type: 'panel_video',
      status: 'completed',
      result: { videoUrl: 'tasks/generated-video.mp4' },
      payload: null,
      events: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      finishedAt: new Date('2026-01-01T00:00:01.000Z'),
      errorCode: null,
      errorMessage: null,
    }] as never)

    const job = {
      data: {
        taskId: 'task-4',
        type: TASK_TYPE.DIAGNOSTIC_EXPORT,
        locale: 'zh',
        projectId: 'project-1',
        targetType: 'NovelPromotionProject',
        targetId: 'project-1',
        userId: 'user-1',
        payload: { options: { includeVideos: true } },
      },
    } as Job

    await buildDiagnosticExport(job)
    const [archiveBuffer] = vi.mocked(uploadObject).mock.calls[0]
    const zip = await JSZip.loadAsync(archiveBuffer)
    const mediaIndex = JSON.parse(await zip.file('media/media-index.json')!.async('string')) as Array<{ storageKey: string; included: boolean; archivePath: string }>

    expect(mediaIndex).toHaveLength(1)
    expect(mediaIndex[0]).toMatchObject({ storageKey: 'tasks/generated-video.mp4', included: true })
    expect(zip.file(mediaIndex[0].archivePath)).not.toBeNull()
  })

  it('keeps retry and terminal model errors in the invocation record', async () => {
    vi.mocked(readProjectLogs).mockResolvedValue([
      JSON.stringify({
        ts: '2026-01-01T00:00:00.000Z',
        action: 'llm.raw.input',
        provider: 'test',
        details: { invocationId: 'invocation-error', action: 'script.generate', model: { id: 'm', key: 'k' }, messages: [] },
      }),
      JSON.stringify({
        ts: '2026-01-01T00:00:01.000Z',
        action: 'llm.raw.error',
        provider: 'test',
        retryable: true,
        details: { invocationId: 'invocation-error', attempt: 1, action: 'script.generate', model: { id: 'm', key: 'k' }, error: { message: 'timeout' } },
      }),
      JSON.stringify({
        ts: '2026-01-01T00:00:02.000Z',
        action: 'llm.raw.error',
        provider: 'test',
        retryable: false,
        details: { invocationId: 'invocation-error', attempt: 2, action: 'script.generate', model: { id: 'm', key: 'k' }, error: { message: 'invalid response' } },
      }),
    ].join('\n'))

    const job = {
      data: {
        taskId: 'task-5',
        type: TASK_TYPE.DIAGNOSTIC_EXPORT,
        locale: 'zh',
        projectId: 'project-1',
        targetType: 'NovelPromotionProject',
        targetId: 'project-1',
        userId: 'user-1',
        payload: { options: { includeReasoning: false } },
      },
    } as Job

    await buildDiagnosticExport(job)
    const [archiveBuffer] = vi.mocked(uploadObject).mock.calls[0]
    const zip = await JSZip.loadAsync(archiveBuffer)
    const lines = (await zip.file('prompts/invocations.jsonl')!.async('string')).split('\n').filter(Boolean)
    const invocation = JSON.parse(lines[0]) as { status: string; errors: Array<{ error: { message: string } }> }

    expect(invocation.status).toBe('failed')
    expect(invocation.errors).toHaveLength(2)
    expect(invocation.errors[1].error.message).toBe('invalid response')
  })
})

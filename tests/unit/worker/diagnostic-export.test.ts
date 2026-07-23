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

    expect(manifest.schemaVersion).toBe(7)
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

  it('groups prompt snapshots, visual reviews and auto repairs for quality analysis', async () => {
    const repairLineage = {
      schemaVersion: 1,
      targetType: 'panel',
      targetId: 'panel-1',
      attempt: 1,
      action: 'regenerate',
      sourceCandidateUrl: 'candidate-old.png',
      candidateUrls: ['candidate-new.png'],
      previousVersionHash: 'version-old',
      repairVersionHash: 'version-new',
      scoreBefore: 58,
      scoreAfter: null,
      accepted: null,
      acceptedCandidateUrl: null,
      stopReason: null,
      promptPatch: { preserve: [], add: ['fix subject'], remove: [], negative: [], rationale: 'subject mismatch' },
      changedVariables: ['add'],
      imageModel: 'image::storyboard',
      createdAt: '2026-01-01T00:00:00.000Z',
      reviewedAt: null,
    }
    vi.mocked(prisma.novelPromotionEpisode.findMany).mockResolvedValue([{
      id: 'episode-asset-bible',
      contentPlan: {
        planType: 'guide',
        _workspace: {
          revision: 2,
          assetRequirements: {
            status: 'needs_review',
            analyzedAt: '2026-01-01T00:00:00.000Z',
            review: {
              schemaVersion: 1,
              targetId: 'episode-asset-bible',
              targetType: 'asset',
              reviewKind: 'asset_bible',
              specVersion: 'asset-bible-review.v1',
              score: 82,
              confidence: 0.88,
              status: 'passed',
              dimensions: [],
              criticalIssues: [],
              route: 'NONE',
              evidence: [],
              assetCount: 1,
              mustLockCount: 1,
              reviewedAt: '2026-01-01T00:00:00.000Z',
            },
            assetBible: [{
              id: 'char-nemo',
              kind: 'character',
              canonicalName: '尼摩船长',
              priority: 'must_lock',
              generationNeed: 'reference_required',
            }],
          },
        },
      },
    }] as never)
    vi.mocked(prisma.graphRun.findMany).mockResolvedValue([{
      id: 'run-quality',
      events: [],
      steps: [],
      attempts: [],
      checkpoints: [],
      artifacts: [
        {
          id: 'artifact-prompt',
          runId: 'run-quality',
          stepKey: 'panel_image_prompt',
          artifactType: 'prompt.panel_image.snapshot',
          refId: 'panel-1',
          versionHash: 'prompt-hash',
          payload: { promptHash: 'prompt-hash', promptSpec: { primarySubject: 'Hero' }, compiledPrompt: 'full prompt' },
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 'artifact-video-prompt',
          runId: 'run-quality',
          stepKey: 'panel_video_prompt',
          artifactType: 'prompt.panel_video.snapshot',
          refId: 'panel-1',
          versionHash: 'video-prompt-hash',
          payload: { promptHash: 'video-prompt-hash', promptSpec: { primaryMotion: 'slow push' }, compiledPrompt: 'compiled video prompt' },
          createdAt: new Date('2026-01-01T00:00:00.100Z'),
        },
        {
          id: 'artifact-content-review',
          runId: 'run-quality',
          stepKey: 'content_quality_review',
          artifactType: 'content.quality.review',
          refId: 'episode-asset-bible',
          versionHash: 'content-review',
          payload: {
            review: {
              schemaVersion: 1,
              targetId: 'episode-asset-bible',
              targetType: 'content',
              reviewKind: 'content_plan',
              specVersion: 'content-plan-quality.v1',
              score: 84,
              confidence: 0.84,
              status: 'passed',
              dimensions: [],
              criticalIssues: [],
              route: 'NONE',
              evidence: [],
              planType: 'guide',
              unitCount: 3,
              reviewedAt: '2026-01-01T00:00:00.000Z',
            },
          },
          createdAt: new Date('2026-01-01T00:00:00.250Z'),
        },
        {
          id: 'artifact-asset-reuse',
          runId: 'run-quality',
          stepKey: 'asset_bible_reuse',
          artifactType: 'asset.bible.reuse',
          refId: 'episode-asset-bible',
          versionHash: 'asset-reuse',
          payload: {
            reason: 'approved_asset_requirements_reused',
            contentRevision: 2,
            analyzedRevision: 2,
            assetCount: 1,
          },
          createdAt: new Date('2026-01-01T00:00:00.260Z'),
        },
        {
          id: 'artifact-content-reuse',
          runId: 'run-quality',
          stepKey: 'content_plan_reuse',
          artifactType: 'content.plan.reuse',
          refId: 'episode-asset-bible',
          versionHash: 'content-reuse',
          payload: {
            reason: 'approved_content_plan_reused',
            revision: 2,
            approvedRevision: 2,
          },
          createdAt: new Date('2026-01-01T00:00:00.275Z'),
        },
        {
          id: 'artifact-script-review',
          runId: 'run-quality',
          stepKey: 'script_quality_review',
          artifactType: 'script.quality.review',
          refId: 'episode-asset-bible',
          versionHash: 'script-review',
          payload: {
            review: {
              schemaVersion: 1,
              targetId: 'episode-asset-bible',
              targetType: 'script',
              reviewKind: 'script_draft',
              specVersion: 'script-draft-review.v1',
              score: 92,
              confidence: 0.88,
              status: 'passed',
              dimensions: [],
              criticalIssues: [],
              route: 'NONE',
              evidence: [],
              clipCount: 1,
              screenplayCount: 1,
              voiceLineCount: 1,
              issues: [],
              reviewedAt: '2026-01-01T00:00:00.300Z',
            },
          },
          createdAt: new Date('2026-01-01T00:00:00.300Z'),
        },
        {
          id: 'artifact-storyboard-review',
          runId: 'run-quality',
          stepKey: 'storyboard_review',
          artifactType: 'storyboard.quality.review',
          refId: 'episode-asset-bible',
          versionHash: 'storyboard-review',
          payload: {
            review: {
              schemaVersion: 1,
              targetId: 'episode-asset-bible',
              targetType: 'storyboard',
              reviewKind: 'storyboard_plan',
              specVersion: 'storyboard-review.v1',
              score: 88,
              confidence: 0.86,
              status: 'passed',
              dimensions: [],
              criticalIssues: [],
              route: 'NONE',
              evidence: [],
              visualUnitCount: 3,
              reviewedAt: '2026-01-01T00:00:00.000Z',
            },
          },
          createdAt: new Date('2026-01-01T00:00:00.500Z'),
        },
        {
          id: 'artifact-visual-reuse',
          runId: 'run-quality',
          stepKey: 'visual_plan_reuse',
          artifactType: 'visual.plan.reuse',
          refId: 'episode-asset-bible',
          versionHash: 'visual-reuse',
          payload: {
            reason: 'approved_visual_plan_reused',
            revision: 3,
            approvedRevision: 3,
            visualUnitCount: 2,
          },
          createdAt: new Date('2026-01-01T00:00:00.750Z'),
        },
        {
          id: 'artifact-repair',
          runId: 'run-quality',
          stepKey: 'visual_auto_repair',
          artifactType: 'visual.repair.candidate',
          refId: 'panel-1',
          versionHash: 'version-new',
          payload: { repairLineage },
          createdAt: new Date('2026-01-01T00:00:01.000Z'),
        },
        {
          id: 'artifact-review',
          runId: 'run-quality',
          stepKey: 'visual_quality_review',
          artifactType: 'visual.quality.review',
          refId: 'panel-1',
          versionHash: 'version-new',
          payload: {
            repairLineage: [{
              ...repairLineage,
              scoreAfter: 91,
              accepted: true,
              acceptedCandidateUrl: 'candidate-new.png',
              stopReason: 'approved',
              reviewedAt: '2026-01-01T00:00:02.000Z',
            }],
          },
          createdAt: new Date('2026-01-01T00:00:02.000Z'),
        },
      ],
      workflowType: 'story_to_video',
      taskType: 'story_to_video',
      status: 'completed',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }] as never)

    const job = {
      data: {
        taskId: 'task-quality-export',
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
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { counts: Record<string, number> }
    const qualityIndex = JSON.parse(await zip.file('quality/quality-index.json')!.async('string')) as Record<string, number>
    const promptLines = (await zip.file('quality/prompt-snapshots.jsonl')!.async('string')).split('\n').filter(Boolean)
    const assetBibleLines = (await zip.file('quality/asset-bible.jsonl')!.async('string')).split('\n').filter(Boolean)
    const assetReviewLines = (await zip.file('quality/asset-bible-reviews.jsonl')!.async('string')).split('\n').filter(Boolean)
    const assetReuseLines = (await zip.file('quality/asset-bible-reuse.jsonl')!.async('string')).split('\n').filter(Boolean)
    const contentReviewLines = (await zip.file('quality/content-quality-reviews.jsonl')!.async('string')).split('\n').filter(Boolean)
    const contentReuseLines = (await zip.file('quality/content-plan-reuse.jsonl')!.async('string')).split('\n').filter(Boolean)
    const scriptReviewLines = (await zip.file('quality/script-reviews.jsonl')!.async('string')).split('\n').filter(Boolean)
    const storyboardReviewLines = (await zip.file('quality/storyboard-quality-reviews.jsonl')!.async('string')).split('\n').filter(Boolean)
    const reviewLines = (await zip.file('quality/visual-quality-reviews.jsonl')!.async('string')).split('\n').filter(Boolean)
    const visualReuseLines = (await zip.file('quality/visual-plan-reuse.jsonl')!.async('string')).split('\n').filter(Boolean)
    const promptQualityReviewLines = (await zip.file('quality/prompt-quality-reviews.jsonl')!.async('string')).split('\n').filter(Boolean)
    const repairLines = (await zip.file('quality/visual-auto-repairs.jsonl')!.async('string')).split('\n').filter(Boolean)
    const lineageLines = (await zip.file('quality/visual-repair-lineage.jsonl')!.async('string')).split('\n').filter(Boolean)
    const roughCutLines = (await zip.file('quality/rough-cut-reviews.jsonl')!.async('string')).split('\n').filter(Boolean)
    const pickupLines = (await zip.file('quality/pickup-list.jsonl')!.async('string')).split('\n').filter(Boolean)
    const assetBible = JSON.parse(assetBibleLines[0]) as { episodeId: string; canonicalName: string; contentRevision: number }
    const scriptReview = JSON.parse(scriptReviewLines[0]) as { score: number; reviewSource: string; artifactId: string }
    const lineage = JSON.parse(lineageLines[0]) as { scoreAfter: number; accepted: boolean; artifactType: string }

    expect(promptLines).toHaveLength(2)
    expect(assetBibleLines).toHaveLength(1)
    expect(assetReviewLines).toHaveLength(1)
    expect(assetReuseLines).toHaveLength(1)
    expect(contentReviewLines).toHaveLength(1)
    expect(contentReuseLines).toHaveLength(1)
    expect(scriptReviewLines).toHaveLength(1)
    expect(storyboardReviewLines).toHaveLength(1)
    expect(promptQualityReviewLines).toHaveLength(2)
    expect(assetBible).toMatchObject({
      episodeId: 'episode-asset-bible',
      canonicalName: '尼摩船长',
      contentRevision: 2,
    })
    expect(scriptReview).toMatchObject({
      score: 92,
      reviewSource: 'runtime_artifact',
      artifactId: 'artifact-script-review',
    })
    expect(reviewLines).toHaveLength(1)
    expect(visualReuseLines).toHaveLength(1)
    expect(repairLines).toHaveLength(1)
    expect(lineageLines).toHaveLength(1)
    expect(roughCutLines).toHaveLength(1)
    expect(pickupLines.length).toBeGreaterThan(0)
    expect(lineage).toMatchObject({ scoreAfter: 91, accepted: true, artifactType: 'visual.quality.review' })
    expect(qualityIndex).toMatchObject({
      promptSnapshotCount: 2,
      assetBibleCount: 1,
      assetBibleReviewCount: 1,
      assetBibleReuseCount: 1,
      contentQualityReviewCount: 1,
      contentPlanReuseCount: 1,
      scriptReviewCount: 1,
      storyboardQualityReviewCount: 1,
      promptQualityReviewCount: 2,
      visualQualityReviewCount: 1,
      visualPlanReuseCount: 1,
      visualAutoRepairCount: 1,
      visualRepairLineageCount: 1,
      roughCutReviewCount: 1,
      pickupItemCount: pickupLines.length,
    })
    expect(manifest.counts).toMatchObject({
      assetBibleRecords: 1,
      assetBibleReviews: 1,
      assetBibleReuses: 1,
      contentQualityReviews: 1,
      contentPlanReuses: 1,
      scriptReviews: 1,
      storyboardQualityReviews: 1,
      promptSnapshots: 2,
      promptQualityReviews: 2,
      visualQualityReviews: 1,
      visualPlanReuses: 1,
      visualAutoRepairs: 1,
      visualRepairLineageRecords: 1,
      roughCutReviews: 1,
      pickupItems: pickupLines.length,
    })
  })
})

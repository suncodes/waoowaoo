import type { Prisma } from '@prisma/client'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { createArtifact } from '@/lib/run-runtime/service'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import {
  attachPreparedPromptToSnapshot,
  requireCurrentPanelImagePreparedPrompt,
} from '@/lib/creative-quality/prepared-prompts'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
} from '../utils'
import { type AnyObj, pickFirstString } from './image-task-handler-shared'
import { persistPanelCandidatesAndScheduleReview } from './panel-visual-quality-trigger'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readOptionalTaskRunId(job: Job<TaskJobData>): string | null {
  const payload = asRecord(job.data.payload)
  const meta = asRecord(payload.meta)
  return pickFirstString(payload.runId, meta.runId)
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function handlePanelImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const panelId = pickFirstString(payload.panelId, job.data.targetId)
  if (!panelId) throw new Error('panelId missing')

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
  })
  if (!panel) throw new Error('Panel not found')

  const preparedPromptArtifactId = pickFirstString(payload.preparedPromptArtifactId)
  if (!preparedPromptArtifactId) {
    throw new Error('PREPARED_PROMPT_REQUIRED: panel image generation requires a prepared prompt')
  }
  const prepared = await requireCurrentPanelImagePreparedPrompt({
    artifactId: preparedPromptArtifactId,
    projectId: job.data.projectId,
    targetId: panel.id,
    userId: job.data.userId,
  })

  const candidateCount = normalizeImageGenerationCount('storyboard-candidates', payload.candidateCount ?? payload.count)
  const snapshot = attachPreparedPromptToSnapshot(prepared.snapshot, prepared.artifactId)
  const referenceImages = snapshot.referenceImages.flatMap((referenceImage) => {
    const signed = toSignedUrlIfCos(referenceImage, 3600)
    return signed ? [signed] : []
  })
  const aspectRatio = typeof prepared.generationOptions.aspectRatio === 'string'
    ? prepared.generationOptions.aspectRatio
    : '9:16'
  const runId = readOptionalTaskRunId(job)
  let promptSnapshotArtifactId: string | null = null
  if (runId) {
    const artifact = await createArtifact({
      runId,
      stepKey: 'panel_image_prompt',
      artifactType: 'prompt.panel_image.snapshot',
      refId: panel.id,
      versionHash: snapshot.promptHash,
      payload: toJsonRecord(snapshot),
    })
    promptSnapshotArtifactId = artifact.id || null
  }

  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: { promptSpec: asInputJson(snapshot.promptSpec) },
  })

  const candidates: string[] = []
  for (let index = 0; index < candidateCount; index += 1) {
    await reportTaskProgress(job, 18 + Math.floor((index / Math.max(candidateCount, 1)) * 58), {
      stage: 'generate_panel_candidate',
      candidateIndex: index,
    })
    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: snapshot.modelKey,
      prompt: snapshot.compiledPrompt,
      options: {
        referenceImages,
        aspectRatio,
        generationOptions: prepared.generationOptions,
      },
      allowTaskExternalIdResume: candidateCount === 1,
      pollProgress: { start: 30, end: 90 },
    })
    candidates.push(await uploadImageSourceToCos(source, 'panel-candidate', `${panel.id}-${index}`))
  }

  await assertTaskActive(job, 'persist_panel_image')
  const quality = await persistPanelCandidatesAndScheduleReview({
    job,
    panel,
    candidates,
    isFirstGeneration: !panel.imageUrl,
    promptSnapshot: runId && promptSnapshotArtifactId
      ? {
        artifactId: promptSnapshotArtifactId,
        runId,
        promptHash: snapshot.promptHash,
        inputHash: snapshot.inputHash,
        preparationHash: snapshot.preparationHash || null,
        createdAt: snapshot.createdAt,
      }
      : null,
  })

  return {
    panelId: panel.id,
    candidateCount: candidates.length,
    imageUrl: quality.imageUrl,
    visualQualityMode: quality.mode,
    visualQualityVersionHash: quality.versionHash,
    visualQualityReviewScheduled: quality.reviewScheduled,
    visualQualityReviewTaskId: quality.reviewTaskId,
    preparedPromptArtifactId: prepared.artifactId,
    promptSnapshot: snapshot,
  }
}

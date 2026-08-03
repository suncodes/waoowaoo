import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { prependStyleReferenceImage } from '@/lib/constants'
import { resolveArtStyleForGeneration } from '@/lib/art-style-generation'
import { createScopedLogger } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '../utils'
import {
  AnyObj,
  collectPanelVisualReferences,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import { createArtifact } from '@/lib/run-runtime/service'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { persistPanelCandidatesAndScheduleReview } from './panel-visual-quality-trigger'
import { createCreativeQualityHash } from '@/lib/creative-quality/contracts'
import {
  buildPanelImageGenerationSnapshot,
} from '@/lib/prompt-compiler/panel-image-prompt-compiler'
import {
  panelVisualBindingsFromPlan,
  resolvePanelAssetBindingPlan,
  type PanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'
import {
  assertPanelGenerationRouteAllowed,
  decidePanelGenerationRoute,
} from '@/lib/visual-production/panel-generation-router'
import {
  applyBackfillRequestsToRequirementPlan,
  ensureMissingAssetBackfill,
} from '@/lib/visual-production/missing-asset-backfill'
import {
  visualReferencesForPrompt,
  visualReferencesToImageUrls,
} from '@/lib/visual-production/references'
import {
  buildPanelImagePromptFromResolvedInputs,
  buildPanelReferencePlan,
} from '@/lib/novel-promotion/panel-generation-prompt-preview'
import { resolvePanelVisualFactsWithAI } from '@/lib/prompt-compiler/panel-visual-fact-extractor'
import type { Prisma } from '@prisma/client'

function parseJsonUnknown(raw: string | null | undefined): unknown | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
function asJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function mergeBackfillRequirementPlanIntoPhotographyRules(params: {
  raw: string | null
  requirementPlan: unknown
  bindingPlan: PanelAssetBindingPlan
}) {
  const rules = asJsonRecord(parseJsonUnknown(params.raw))
  const next: Record<string, unknown> = {
    ...rules,
    ...(params.requirementPlan ? { shotAssetRequirementPlan: params.requirementPlan } : {}),
    assetBindingPlan: params.bindingPlan,
  }
  return JSON.stringify(next)
}

function readOptionalTaskRunId(job: Job<TaskJobData>): string | null {
  const payload = asJsonRecord(job.data.payload)
  const meta = asJsonRecord(payload.meta)
  return pickFirstString(payload.runId, meta.runId)
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function refreshBindingPlanWithRequirementPlan(params: {
  panel: Parameters<typeof resolvePanelAssetBindingPlan>[0]
  requirementPlan: unknown
}): PanelAssetBindingPlan {
  const rules = asJsonRecord(parseJsonUnknown(
    typeof params.panel.photographyRules === 'string' ? params.panel.photographyRules : null,
  ))
  const rulesWithoutBindingPlan = { ...rules }
  delete rulesWithoutBindingPlan.assetBindingPlan
  return resolvePanelAssetBindingPlan({
    ...params.panel,
    photographyRules: {
      ...rulesWithoutBindingPlan,
      shotAssetRequirementPlan: params.requirementPlan,
    },
    shotAssetRequirementPlan: params.requirementPlan,
  })
}

export async function handlePanelImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const panelId = pickFirstString(payload.panelId, job.data.targetId)
  if (!panelId) throw new Error('panelId missing')

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
  })

  if (!panel) throw new Error('Panel not found')

  let projectData = await resolveNovelData(job.data.projectId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const modelKey = modelConfig.storyboardModel
  if (!modelKey) throw new Error('Storyboard model not configured')

  const candidateCount = normalizeImageGenerationCount('storyboard-candidates', payload.candidateCount ?? payload.count)
  const resolvedArtStyle = resolveArtStyleForGeneration({
    artStyleMode: modelConfig.artStyleMode,
    artStyle: modelConfig.artStyle,
    artStylePrompt: modelConfig.artStylePrompt,
    customArtStyleReferenceImage: modelConfig.customArtStyleReferenceImage,
    artStyleReferenceEnabled: modelConfig.artStyleReferenceEnabled,
    locale: job.data.locale,
  })
  let panelForGeneration = panel
  let visualBindingPlan = resolvePanelAssetBindingPlan(panelForGeneration)
  let visualBindings = panelVisualBindingsFromPlan(visualBindingPlan)
  let visualReferences = await collectPanelVisualReferences(projectData, panelForGeneration)
  let structuredReferences = visualReferencesForPrompt(visualReferences)
  const forceNoReference = payload.forceNoReference === true
  let generationRouteDecision = decidePanelGenerationRoute({
    panel: panelForGeneration,
    bindingPlan: visualBindingPlan,
    references: visualReferences,
    forceNoReference,
  })
  let refs = visualReferencesToImageUrls(visualReferences)
  let referenceImages = prependStyleReferenceImage(
    refs,
    resolvedArtStyle.referenceImage,
    resolvedArtStyle.referenceEnabled,
  )
  const runId = readOptionalTaskRunId(job)

  const logger = createScopedLogger({
    module: 'worker.panel-image',
    action: 'panel_image_generate',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
  logger.info({
    message: 'panel image generation started',
    details: {
      panelId,
      modelKey,
      candidateCount,
      referenceImagesRawCount: refs.length,
      referenceImagesFinalCount: referenceImages.length,
      visualBindings,
      visualBindingPlan,
      visualReferences: structuredReferences,
      generationRouteDecision,
      artStyleReferenceEnabled: modelConfig.artStyleReferenceEnabled,
      rawUrls: refs.map((u) => u.substring(0, 100)),
      referenceUrls: referenceImages.map((u) => u.substring(0, 100)),
      panelCharacters: panel.characters,
      panelLocation: panel.location,
      artStyle: modelConfig.artStyle,
      artStyleMode: modelConfig.artStyleMode,
    },
  })

  if (generationRouteDecision.route === 'asset_backfill' || generationRouteDecision.route === 'human_required') {
    const backfillPlan = await ensureMissingAssetBackfill({
      projectId: job.data.projectId,
      userId: job.data.userId,
      locale: job.data.locale,
      panelId: panel.id,
      bindingPlan: visualBindingPlan,
      decision: generationRouteDecision,
    })
    const updatedRequirementPlan = applyBackfillRequestsToRequirementPlan(
      visualBindingPlan.requirementPlan,
      backfillPlan.requests,
    )
    const updatedBindingPlan = refreshBindingPlanWithRequirementPlan({
      panel: panelForGeneration,
      requirementPlan: updatedRequirementPlan || visualBindingPlan.requirementPlan || null,
    })
    const blockedReferencePlan = buildPanelReferencePlan({
      bindingPlan: updatedBindingPlan,
      references: structuredReferences,
      decision: generationRouteDecision,
      backfill: backfillPlan,
    })
    const updatedPhotographyRules = mergeBackfillRequirementPlanIntoPhotographyRules({
      raw: panelForGeneration.photographyRules,
      requirementPlan: updatedBindingPlan.requirementPlan || null,
      bindingPlan: updatedBindingPlan,
    })
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        generationRoute: generationRouteDecision.route,
        noReferenceReason: generationRouteDecision.noReferenceReason,
        referencePlan: asInputJson(blockedReferencePlan),
        photographyRules: updatedPhotographyRules,
      },
    })

    if (backfillPlan.status === 'queued' || backfillPlan.status === 'human_required') {
      if (runId) {
        try {
          await createArtifact({
            runId,
            stepKey: 'visual_binding_plan',
            artifactType: 'visual.binding.plan',
            refId: panel.id,
            versionHash: createCreativeQualityHash(updatedBindingPlan),
            payload: toJsonRecord(updatedBindingPlan),
          })
          await createArtifact({
            runId,
            stepKey: 'panel_generation_route',
            artifactType: 'visual.generation.route',
            refId: panel.id,
            versionHash: createCreativeQualityHash(generationRouteDecision),
            payload: toJsonRecord(generationRouteDecision),
          })
          await createArtifact({
            runId,
            stepKey: 'missing_asset_backfill',
            artifactType: 'visual.missing_asset_backfill',
            refId: panel.id,
            versionHash: createCreativeQualityHash(backfillPlan),
            payload: toJsonRecord(backfillPlan),
          })
        } catch (error) {
          logger.warn({
            message: 'missing asset backfill artifact failed',
            details: { panelId: panel.id, runId },
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return {
        panelId: panel.id,
        candidateCount: 0,
        imageUrl: panel.imageUrl,
        status: backfillPlan.status === 'human_required' ? 'human_required' : 'waiting_asset_backfill',
        generationRouteDecision,
        backfillPlan,
      }
    }

    panelForGeneration = {
      ...panelForGeneration,
      photographyRules: updatedPhotographyRules,
    }
    projectData = await resolveNovelData(job.data.projectId)
    visualBindingPlan = updatedBindingPlan
    visualBindings = panelVisualBindingsFromPlan(visualBindingPlan)
    visualReferences = await collectPanelVisualReferences(projectData, panelForGeneration)
    structuredReferences = visualReferencesForPrompt(visualReferences)
    generationRouteDecision = decidePanelGenerationRoute({
      panel: panelForGeneration,
      bindingPlan: visualBindingPlan,
      references: visualReferences,
      forceNoReference: forceNoReference || backfillPlan.status === 'not_needed',
    })
    if (generationRouteDecision.route === 'asset_backfill' || generationRouteDecision.route === 'human_required') {
      generationRouteDecision = decidePanelGenerationRoute({
        panel: panelForGeneration,
        bindingPlan: visualBindingPlan,
        references: visualReferences,
        forceNoReference: true,
      })
    }
    refs = visualReferencesToImageUrls(visualReferences)
    referenceImages = prependStyleReferenceImage(
      refs,
      resolvedArtStyle.referenceImage,
      resolvedArtStyle.referenceEnabled,
    )
  }

  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const provisionalCompilation = buildPanelImagePromptFromResolvedInputs({
    panel: {
      id: panelForGeneration.id,
      storyboardId: panelForGeneration.storyboardId,
      panelIndex: panelForGeneration.panelIndex,
      shotType: panelForGeneration.shotType,
      cameraMove: panelForGeneration.cameraMove,
      description: panelForGeneration.description,
      imagePrompt: panelForGeneration.imagePrompt,
      videoPrompt: panelForGeneration.videoPrompt,
      location: panelForGeneration.location,
      characters: panelForGeneration.characters,
      props: panelForGeneration.props,
      sourceAnchor: panelForGeneration.sourceAnchor,
      srtSegment: panelForGeneration.srtSegment,
      photographyRules: panelForGeneration.photographyRules,
      actingNotes: panelForGeneration.actingNotes,
      visualType: panelForGeneration.visualType,
      renderMode: panelForGeneration.renderMode,
      onScreenText: panelForGeneration.onScreenText,
      sketchImageUrl: panelForGeneration.sketchImageUrl,
      duration: panelForGeneration.duration,
      promptSpec: panelForGeneration.promptSpec,
      referencePlan: panelForGeneration.referencePlan,
      continuityGroupId: panelForGeneration.continuityGroupId,
      generationRoute: panelForGeneration.generationRoute,
      primarySubject: panelForGeneration.primarySubject,
      imageUrl: panelForGeneration.imageUrl,
    },
    projectData,
    locale: job.data.locale,
    resolvedArtStyle,
    visualBindings,
    visualBindingPlan,
    visualReferences,
    generationRouteDecision,
    referenceImages,
  })
  const visualFacts = await resolvePanelVisualFactsWithAI({
    userId: job.data.userId,
    projectId: job.data.projectId,
    input: {
      ...provisionalCompilation.factPreparationInput,
      model: modelConfig.analysisModel || null,
    },
    reusableOptimization: asJsonRecord(panelForGeneration.promptSpec).promptOptimization,
  })
  const imagePromptCompilation = buildPanelImagePromptFromResolvedInputs({
    panel: {
      id: panelForGeneration.id,
      storyboardId: panelForGeneration.storyboardId,
      panelIndex: panelForGeneration.panelIndex,
      shotType: panelForGeneration.shotType,
      cameraMove: panelForGeneration.cameraMove,
      description: panelForGeneration.description,
      imagePrompt: panelForGeneration.imagePrompt,
      videoPrompt: panelForGeneration.videoPrompt,
      location: panelForGeneration.location,
      characters: panelForGeneration.characters,
      props: panelForGeneration.props,
      sourceAnchor: panelForGeneration.sourceAnchor,
      srtSegment: panelForGeneration.srtSegment,
      photographyRules: panelForGeneration.photographyRules,
      actingNotes: panelForGeneration.actingNotes,
      visualType: panelForGeneration.visualType,
      renderMode: panelForGeneration.renderMode,
      onScreenText: panelForGeneration.onScreenText,
      sketchImageUrl: panelForGeneration.sketchImageUrl,
      duration: panelForGeneration.duration,
      promptSpec: panelForGeneration.promptSpec,
      referencePlan: panelForGeneration.referencePlan,
      continuityGroupId: panelForGeneration.continuityGroupId,
      generationRoute: panelForGeneration.generationRoute,
      primarySubject: panelForGeneration.primarySubject,
      imageUrl: panelForGeneration.imageUrl,
    },
    projectData,
    locale: job.data.locale,
    resolvedArtStyle,
    visualBindings,
    visualBindingPlan,
    visualReferences,
    generationRouteDecision,
    referenceImages,
    optimizedFacts: visualFacts.facts,
    promptOptimization: visualFacts.optimization,
  })
  const aspectRatio = imagePromptCompilation.aspectRatio
  const prompt = imagePromptCompilation.compiledPrompt
  const panelPromptSpec = imagePromptCompilation.promptSpec
  const referencePlan = imagePromptCompilation.referencePlan
  logger.info({
    message: 'panel image prompt resolved',
    details: {
      promptLength: prompt.length,
    },
  })
  const promptSnapshot = buildPanelImageGenerationSnapshot({
    targetId: panel.id,
    modelKey,
    promptTemplateId: imagePromptCompilation.promptTemplateId,
    referenceImages,
    structuredReferences: imagePromptCompilation.structuredReferences,
    bindingPlan: visualBindingPlan,
    promptSpec: panelPromptSpec,
    compiledPrompt: prompt,
    assetVersionHash: imagePromptCompilation.assetVersionHash,
  })
  let promptSnapshotArtifactId: string | null = null
  if (runId) {
    try {
      await createArtifact({
        runId,
        stepKey: 'visual_binding_plan',
        artifactType: 'visual.binding.plan',
        refId: panel.id,
        versionHash: createCreativeQualityHash(visualBindingPlan),
        payload: toJsonRecord(visualBindingPlan),
      })
      await createArtifact({
        runId,
        stepKey: 'panel_generation_route',
        artifactType: 'visual.generation.route',
        refId: panel.id,
        versionHash: createCreativeQualityHash(generationRouteDecision),
        payload: toJsonRecord(generationRouteDecision),
      })
      const promptSnapshotArtifact = await createArtifact({
        runId,
        stepKey: 'panel_image_prompt',
        artifactType: 'prompt.panel_image.snapshot',
        refId: panel.id,
        versionHash: promptSnapshot.promptHash,
        payload: toJsonRecord(promptSnapshot),
      })
      promptSnapshotArtifactId = promptSnapshotArtifact.id || null
    } catch (error) {
      logger.warn({
        message: 'panel image prompt snapshot artifact failed',
        details: { panelId: panel.id, runId },
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      generationRoute: generationRouteDecision.route,
      noReferenceReason: generationRouteDecision.noReferenceReason,
      promptSpec: asInputJson(panelPromptSpec),
      referencePlan: asInputJson(referencePlan),
    },
  })

  assertPanelGenerationRouteAllowed(generationRouteDecision)

  const candidates: string[] = []

  for (let i = 0; i < candidateCount; i++) {
    await reportTaskProgress(job, 18 + Math.floor((i / Math.max(candidateCount, 1)) * 58), {
      stage: 'generate_panel_candidate',
      candidateIndex: i,
    })

    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: modelKey,
      prompt,
      options: {
        referenceImages,
        aspectRatio,
      },
      // 单个任务内会串行生成多候选，若允许按 task.externalId 续接会复用上一候选外部任务结果。
      allowTaskExternalIdResume: candidateCount === 1,
      pollProgress: { start: 30, end: 90 },
    })

    const cosKey = await uploadImageSourceToCos(source, 'panel-candidate', `${panel.id}-${i}`)
    candidates.push(cosKey)
  }

  const isFirstGeneration = !panelForGeneration.imageUrl

  await assertTaskActive(job, 'persist_panel_image')
  const quality = await persistPanelCandidatesAndScheduleReview({
    job,
    panel: panelForGeneration,
    candidates,
    isFirstGeneration,
    promptSnapshot: runId && promptSnapshotArtifactId
      ? {
        artifactId: promptSnapshotArtifactId,
        runId,
        promptHash: promptSnapshot.promptHash,
        inputHash: promptSnapshot.inputHash,
        preparationHash: promptSnapshot.preparationHash || null,
        createdAt: promptSnapshot.createdAt,
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
    promptSnapshot,
  }
}

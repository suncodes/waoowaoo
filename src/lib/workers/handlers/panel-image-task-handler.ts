import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { joinPromptSegments, prependStyleReferenceImage } from '@/lib/constants'
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
  findCharacterByName,
  parsePanelCharacterReferences,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { createArtifact } from '@/lib/run-runtime/service'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { parseLocationAvailableSlots } from '@/lib/location-available-slots'
import { persistPanelCandidatesAndScheduleReview } from './panel-visual-quality-trigger'
import { createCreativeQualityHash } from '@/lib/creative-quality/contracts'
import {
  buildPanelImageGenerationSnapshot,
  buildPanelImagePromptSpec,
} from '@/lib/prompt-compiler/panel-image-prompt-compiler'
import {
  type PanelVisualBindings,
} from '@/lib/visual-production/bindings'
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
  visualReferencesForPrompt,
  visualReferencesToImageUrls,
  type VisualReference,
} from '@/lib/visual-production/references'
import type { Prisma } from '@prisma/client'

function parseJsonUnknown(raw: string | null | undefined): unknown | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
function parseDescriptionList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function pickAppearanceDescription(appearance: {
  descriptions?: string | null
  description?: string | null
  selectedIndex?: number | null
}): string {
  const descriptions = parseDescriptionList(appearance.descriptions || null)
  if (descriptions.length > 0) {
    const selectedIndex = typeof appearance.selectedIndex === 'number' ? appearance.selectedIndex : 0
    const selected = descriptions[selectedIndex] || descriptions[0]
    if (selected && selected.trim()) return selected.trim()
  }
  if (typeof appearance.description === 'string' && appearance.description.trim()) {
    return appearance.description.trim()
  }
  return '无描述'
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
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

function buildPanelPromptContext(params: {
  panel: {
    id: string
    shotType: string | null
    cameraMove: string | null
    description: string | null
    imagePrompt: string | null
    videoPrompt: string | null
    location: string | null
    characters: string | null
    props: string | null
    sourceAnchor: unknown
    srtSegment: string | null
    photographyRules: string | null
    actingNotes: string | null
    visualType: string | null
    renderMode: string | null
    onScreenText: string | null
  }
  projectData: Awaited<ReturnType<typeof resolveNovelData>>
  visualBindings?: PanelVisualBindings
  visualBindingPlan?: PanelAssetBindingPlan
  visualReferences?: VisualReference[]
}) {
  const legacyPanelCharacters = parsePanelCharacterReferences(params.panel.characters)
  const legacyCharacterByName = new Map(
    legacyPanelCharacters.map((item) => [item.name.toLowerCase(), item]),
  )
  const bindingCharacters = params.visualBindings?.visibleAssets
    .filter((asset) => asset.kind === 'character')
    .map((asset) => {
      const legacy = legacyCharacterByName.get(asset.name.toLowerCase())
      return {
        name: asset.name,
        appearance: legacy?.appearance,
        slot: legacy?.slot,
      }
    }) || []
  const panelCharacters = bindingCharacters.length > 0 ? bindingCharacters : legacyPanelCharacters
  const characterContexts = panelCharacters.map((reference) => {
    const character = findCharacterByName(params.projectData.characters || [], reference.name)
    if (!character) {
      return {
        id: null,
        name: reference.name,
        appearance: reference.appearance || null,
        description: '无角色外貌数据',
        slot: reference.slot || null,
      }
    }

    const appearances = character.appearances || []
    const matchedAppearance =
      (reference.appearance
        ? appearances.find((appearance) => (appearance.changeReason || '').toLowerCase() === reference.appearance!.toLowerCase())
        : null) || appearances[0] || null

    return {
      id: character.id,
      name: character.name,
      appearance: matchedAppearance?.changeReason || null,
      description: matchedAppearance ? pickAppearanceDescription(matchedAppearance) : '无角色外貌数据',
      slot: reference.slot || null,
    }
  })

  const locationContext = (() => {
    const boundLocation = params.visualBindings?.visibleAssets.find((asset) => asset.kind === 'location')
    const locationName = boundLocation?.name || params.panel.location
    if (!locationName) return null
    const matchedLocation = (params.projectData.locations || []).find(
      (item) => item.id === boundLocation?.id || item.name.toLowerCase() === locationName.toLowerCase(),
    )
    if (!matchedLocation) return null
    const selectedImage = (matchedLocation.images || []).find((item) => item.isSelected) || matchedLocation.images?.[0]
    return {
      id: matchedLocation.id,
      name: matchedLocation.name,
      description: selectedImage?.description || null,
      available_slots: parseLocationAvailableSlots(selectedImage?.availableSlots),
    }
  })()

  const boundProps = params.visualBindings?.visibleAssets
    .filter((asset) => asset.kind === 'prop')
    .map((asset) => asset.name) || []
  const panelProps = boundProps.length > 0 ? boundProps : parseDescriptionList(params.panel.props)
  const propContexts = panelProps.map((name) => {
    const matchedProp = (params.projectData.locations || []).find(
      (item) => item.assetKind === 'prop' && item.name.toLowerCase() === name.toLowerCase(),
    )
    const selectedImage = (matchedProp?.images || []).find((item) => item.isSelected) || matchedProp?.images?.[0]
    return {
      id: matchedProp?.id || null,
      name,
      description: selectedImage?.description || null,
    }
  })

  return {
    panel: {
      panel_id: params.panel.id,
      shot_type: params.panel.shotType || '',
      camera_move: params.panel.cameraMove || '',
      description: params.panel.description || '',
      image_prompt: params.panel.imagePrompt || '',
      video_prompt: params.panel.videoPrompt || '',
      location: params.panel.location || '',
      characters: panelCharacters,
      props: parseDescriptionList(params.panel.props),
      source_anchor: params.panel.sourceAnchor || null,
      source_text: params.panel.srtSegment || '',
      photography_rules: parseJsonUnknown(params.panel.photographyRules),
      acting_notes: parseJsonUnknown(params.panel.actingNotes),
      visual_type: params.panel.visualType || 'illustration',
      render_mode: params.panel.renderMode || 'generated_image',
      on_screen_text_for_downstream_composition: params.panel.onScreenText || '',
      image_text_policy: 'The generated image must contain no text. Exact copy is rendered downstream.',
      visual_bindings: params.visualBindings || null,
      visual_binding_plan: params.visualBindingPlan || null,
    },
    context: {
      character_appearances: characterContexts,
      location_reference: locationContext,
      prop_references: propContexts,
      visual_references: visualReferencesForPrompt(params.visualReferences || []),
    },
  }
}

function buildPanelPrompt(params: {
  locale: TaskJobData['locale']
  aspectRatio: string
  styleText: string
  sourceText: string
  contextJson: string
}) {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_SINGLE_PANEL_IMAGE,
    locale: params.locale,
    variables: {
      aspect_ratio: params.aspectRatio,
      storyboard_text_json_input: params.contextJson,
      source_text: params.sourceText || '无',
      style: params.styleText,
    },
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

  const projectData = await resolveNovelData(job.data.projectId)
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
  const visualBindingPlan = resolvePanelAssetBindingPlan(panel)
  const visualBindings = panelVisualBindingsFromPlan(visualBindingPlan)
  const visualReferences = await collectPanelVisualReferences(projectData, panel)
  const structuredReferences = visualReferencesForPrompt(visualReferences)
  const generationRouteDecision = decidePanelGenerationRoute({
    panel,
    bindingPlan: visualBindingPlan,
    references: visualReferences,
  })
  const refs = visualReferencesToImageUrls(visualReferences)
  const referenceImages = prependStyleReferenceImage(
    refs,
    resolvedArtStyle.referenceImage,
    resolvedArtStyle.referenceEnabled,
  )

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

  const styleText = joinPromptSegments([
    resolvedArtStyle.prompt,
    resolvedArtStyle.referenceInstruction,
  ], job.data.locale)
  const fallbackStyleText = job.data.locale === 'en'
    ? 'consistent with the provided reference images'
    : '与参考图风格一致'
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const aspectRatio = projectData.videoRatio
  const promptContext = buildPanelPromptContext({
    panel: {
      id: panel.id,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      imagePrompt: panel.imagePrompt,
      videoPrompt: panel.videoPrompt,
      location: panel.location,
      characters: panel.characters,
      props: panel.props,
      sourceAnchor: panel.sourceAnchor,
      srtSegment: panel.srtSegment,
      photographyRules: panel.photographyRules,
      actingNotes: panel.actingNotes,
      visualType: panel.visualType,
      renderMode: panel.renderMode,
      onScreenText: panel.onScreenText,
    },
    projectData,
    visualBindings,
    visualBindingPlan,
    visualReferences,
  })
  const resolvedStyleText = styleText || fallbackStyleText
  const assetVersionHash = createCreativeQualityHash({
    characters: promptContext.context.character_appearances.map((item) => ({
      id: item.id,
      name: item.name,
      appearance: item.appearance,
      description: item.description,
      slot: item.slot,
    })),
    location: promptContext.context.location_reference,
    props: promptContext.context.prop_references,
    referenceImages,
    visualReferences: structuredReferences,
    visualBindingPlan,
  })
  const panelPromptSpec = buildPanelImagePromptSpec({
    context: promptContext,
    aspectRatio,
    styleText: resolvedStyleText,
    generationRoute: generationRouteDecision.route,
    noReferenceReason: generationRouteDecision.noReferenceReason,
    referencePlan: {
      schemaVersion: 1,
      references: structuredReferences,
      decision: generationRouteDecision,
    },
  })
  const contextJson = JSON.stringify({
    ...promptContext,
    prompt_spec: panelPromptSpec,
  }, null, 2)
  const prompt = buildPanelPrompt({
    locale: job.data.locale,
    aspectRatio,
    styleText: resolvedStyleText,
    sourceText: panel.srtSegment || panel.description || '',
    contextJson,
  })
  logger.info({
    message: 'panel image prompt resolved',
    details: {
      promptLength: prompt.length,
    },
  })
  const promptSnapshot = buildPanelImageGenerationSnapshot({
    targetId: panel.id,
    modelKey,
    promptTemplateId: PROMPT_IDS.NP_SINGLE_PANEL_IMAGE,
    referenceImages,
    structuredReferences,
    bindingPlan: visualBindingPlan,
    promptSpec: panelPromptSpec,
    compiledPrompt: prompt,
    assetVersionHash,
  })
  const runId = readOptionalTaskRunId(job)
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
      await createArtifact({
        runId,
        stepKey: 'panel_image_prompt',
        artifactType: 'prompt.panel_image.snapshot',
        refId: panel.id,
        versionHash: promptSnapshot.promptHash,
        payload: toJsonRecord(promptSnapshot),
      })
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
      referencePlan: asInputJson({
        schemaVersion: 1,
        references: structuredReferences,
        decision: generationRouteDecision,
      }),
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

  const isFirstGeneration = !panel.imageUrl

  await assertTaskActive(job, 'persist_panel_image')
  const quality = await persistPanelCandidatesAndScheduleReview({
    job,
    panel,
    candidates,
    isFirstGeneration,
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

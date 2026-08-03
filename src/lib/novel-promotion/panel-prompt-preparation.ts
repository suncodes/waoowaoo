import {
  persistPreparedPrompt,
  type PreparedGenerationPrompt,
} from '@/lib/creative-quality/prepared-prompts'
import {
  buildPanelImageGenerationSnapshot,
} from '@/lib/prompt-compiler/panel-image-prompt-compiler'
import {
  buildPanelVideoGenerationSnapshot,
  type PanelVideoPromptSpec,
} from '@/lib/prompt-compiler/panel-video-prompt-compiler'
import type { PanelImagePromptSpec } from '@/lib/prompt-compiler/panel-image-prompt-compiler'
import {
  buildPanelImageGenerationPromptPreview,
  buildPanelVideoGenerationPromptPreview,
  type PanelGenerationPromptPreview,
  type PanelGenerationPromptPreviewMode,
  type PanelGenerationPromptPreviewOverrides,
} from './panel-generation-prompt-preview'
import { assertPanelGenerationRouteAllowed } from '@/lib/visual-production/panel-generation-router'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'

type PanelLocator = {
  panelId?: string | null
  storyboardId?: string | null
  panelIndex?: number | string | null
}

export class PanelPromptPreparationError extends Error {
  code: 'MODEL_REQUIRED' | 'FIRSTLASTFRAME_MODEL_UNSUPPORTED'

  constructor(code: PanelPromptPreparationError['code'], message: string) {
    super(message)
    this.name = 'PanelPromptPreparationError'
    this.code = code
  }
}

function toGenerationOptions(value: Record<string, unknown>): Record<string, string | number | boolean> {
  const options: Record<string, string | number | boolean> = {}
  for (const [key, option] of Object.entries(value)) {
    if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
      options[key] = option
    }
  }
  return options
}

function requireModelKey(preview: PanelGenerationPromptPreview) {
  if (preview.modelKey) return preview.modelKey
  throw new PanelPromptPreparationError('MODEL_REQUIRED', '请先配置生成模型，再固定提示词。')
}

function assertFirstLastFrameModel(modelKey: string) {
  if (resolveBuiltinCapabilitiesByModelKey('video', modelKey)?.video?.firstlastframe === true) return
  throw new PanelPromptPreparationError(
    'FIRSTLASTFRAME_MODEL_UNSUPPORTED',
    '当前模型不支持首尾帧视频，请选择支持首尾帧的模型后再固定提示词。',
  )
}

export async function preparePanelGenerationPrompt(params: {
  projectId: string
  userId: string
  locale?: string
  mode: PanelGenerationPromptPreviewMode
  locator: PanelLocator
  videoModel?: string | null
  generationOptions?: unknown
  overrides?: PanelGenerationPromptPreviewOverrides
  forceNoReference?: boolean
}): Promise<{
  preview: PanelGenerationPromptPreview
  prepared: PreparedGenerationPrompt
}> {
  if (params.mode === 'image') {
    const preview = await buildPanelImageGenerationPromptPreview({
      projectId: params.projectId,
      userId: params.userId,
      locale: params.locale,
      locator: params.locator,
      overrides: params.overrides,
      forceNoReference: params.forceNoReference === true,
    })
    if (preview.generationRouteDecision) {
      assertPanelGenerationRouteAllowed(
        preview.generationRouteDecision as Parameters<typeof assertPanelGenerationRouteAllowed>[0],
      )
    }
    const snapshot = buildPanelImageGenerationSnapshot({
      targetId: preview.panelId,
      modelKey: requireModelKey(preview),
      promptTemplateId: preview.promptTemplateId,
      referenceImages: preview.referenceImages,
      structuredReferences: preview.structuredReferences,
      bindingPlan: preview.bindingPlan,
      promptSpec: preview.promptSpec as PanelImagePromptSpec,
      compiledPrompt: preview.compiledPrompt,
      assetVersionHash: preview.assetVersionHash || null,
    })
    const prepared = await persistPreparedPrompt({
      userId: params.userId,
      projectId: params.projectId,
      kind: 'panel_image',
      targetType: 'NovelPromotionPanel',
      targetId: preview.panelId,
      generationOptions: toGenerationOptions(preview.generationOptions),
      snapshot,
      metadata: {
        storyboardId: preview.storyboardId,
        panelIndex: preview.panelIndex,
        referencePlan: preview.referencePlan || null,
        referenceSelection: preview.referenceSelection || null,
        generationRouteDecision: preview.generationRouteDecision || null,
      },
    })
    return { preview, prepared }
  }

  const preview = await buildPanelVideoGenerationPromptPreview({
    projectId: params.projectId,
    userId: params.userId,
    locale: params.locale,
    locator: params.locator,
    mode: params.mode === 'firstlastframe' ? 'firstlastframe' : 'video',
    videoModel: params.videoModel,
    generationOptions: params.generationOptions,
    overrides: params.overrides,
  })
  const generationOptions = toGenerationOptions(preview.generationOptions)
  const modelKey = requireModelKey(preview)
  if (params.mode === 'firstlastframe') assertFirstLastFrameModel(modelKey)
  const generationMode = typeof generationOptions.generationMode === 'string'
    ? generationOptions.generationMode
    : (preview.mode === 'firstlastframe' ? 'firstlastframe' : 'normal')
  const snapshot = buildPanelVideoGenerationSnapshot({
    targetId: preview.panelId,
    modelKey,
    promptTemplateId: preview.promptTemplateId,
    referenceImages: preview.referenceImages,
    promptSpec: preview.promptSpec as PanelVideoPromptSpec,
    compiledPrompt: preview.compiledPrompt,
    assetVersionHash: preview.assetVersionHash || null,
  })
  const prepared = await persistPreparedPrompt({
    userId: params.userId,
    projectId: params.projectId,
    kind: 'panel_video',
    targetType: 'NovelPromotionPanel',
    targetId: preview.panelId,
    generationMode,
    generationOptions,
    snapshot,
    metadata: {
      storyboardId: preview.storyboardId,
      panelIndex: preview.panelIndex,
      mode: preview.mode,
    },
  })
  return { preview, prepared }
}

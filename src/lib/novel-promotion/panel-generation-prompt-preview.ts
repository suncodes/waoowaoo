import { prisma } from '@/lib/prisma'
import { joinPromptSegments, prependStyleReferenceImage } from '@/lib/constants'
import { resolveArtStyleForGeneration, type ArtStyleGenerationResult } from '@/lib/art-style-generation'
import { createCreativeQualityHash } from '@/lib/creative-quality/contracts'
import { getProjectModelConfig } from '@/lib/config-service'
import type { CapabilityValue } from '@/lib/model-config-contract'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import type { PromptLocale } from '@/lib/prompt-i18n/types'
import {
  buildPanelImagePromptSpec,
  compilePanelImageRenderBrief,
  type PanelImagePromptSpec,
} from '@/lib/prompt-compiler/panel-image-prompt-compiler'
import {
  buildPanelVideoPromptSpec,
  compilePanelVideoPrompt,
  type PanelVideoPromptSpec,
} from '@/lib/prompt-compiler/panel-video-prompt-compiler'
import {
  compilePanelSpeechPromptSection,
  panelSpeechHasContent,
  validatePanelSpeechReadyForVideo,
} from '@/lib/novel-promotion/panel-speech'
import { getSignedUrl } from '@/lib/storage'
import {
  type PanelVisualBindings,
} from '@/lib/visual-production/bindings'
import {
  panelVisualBindingsFromPlan,
  resolvePanelAssetBindingPlan,
  type PanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'
import {
  decidePanelGenerationRoute,
} from '@/lib/visual-production/panel-generation-router'
import {
  resolvePanelVisualReferences,
  visualReferencesForPrompt,
  visualReferencesToImageUrls,
  type VisualReference,
} from '@/lib/visual-production/references'

type PromptPreviewLocale = PromptLocale
type VideoOptionValue = string | number | boolean
export type VideoOptionMap = Record<string, VideoOptionValue>
export type PanelGenerationPromptPreviewMode = 'image' | 'video' | 'firstlastframe'

interface PromptPreviewPanelLocator {
  panelId?: string | null
  storyboardId?: string | null
  panelIndex?: number | string | null
}

export interface PanelPromptPreviewPanelOverrides {
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  firstLastFramePrompt?: string | null
  location?: string | null
  characters?: string | Array<{ name: string; appearance?: string; slot?: string }> | null
  props?: string | string[] | null
  duration?: number | null
  photographyRules?: string | null
  actingNotes?: string | null
}

export interface PanelPromptPreviewFirstLastFrameOverrides {
  lastFrameStoryboardId?: string | null
  lastFramePanelIndex?: number | string | null
  flModel?: string | null
  customPrompt?: string | null
}

export interface PanelGenerationPromptPreviewOverrides {
  panel?: PanelPromptPreviewPanelOverrides
  firstLastFrame?: PanelPromptPreviewFirstLastFrameOverrides
}

export interface PanelGenerationPromptPreview {
  mode: PanelGenerationPromptPreviewMode
  panelId: string
  storyboardId: string
  panelIndex: number
  modelKey: string | null
  promptTemplateId: string
  compiledPrompt: string
  promptSpec: PanelImagePromptSpec | PanelVideoPromptSpec
  generationOptions: Record<string, CapabilityValue>
  referenceImages: string[]
  structuredReferences?: unknown
  warnings: string[]
}

export class PanelPromptPreviewError extends Error {
  code: 'PANEL_NOT_FOUND' | 'PROJECT_NOT_FOUND'

  constructor(code: PanelPromptPreviewError['code'], message: string) {
    super(message)
    this.name = 'PanelPromptPreviewError'
    this.code = code
  }
}

interface PanelForImagePrompt {
  id: string
  storyboardId: string
  panelIndex: number
  shotType: string | null
  cameraMove: string | null
  description: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  firstLastFramePrompt?: string | null
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
  sketchImageUrl?: string | null
  duration?: number | null
  promptSpec?: unknown
  referencePlan?: unknown
  continuityGroupId?: string | null
  generationRoute?: string | null
  primarySubject?: string | null
  imageUrl?: string | null
}

interface PanelForVideoPrompt {
  id: string
  storyboardId: string
  panelIndex: number
  description: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  firstLastFramePrompt?: string | null
  cameraMove: string | null
  duration: number | null
  photographyRules?: unknown
  promptSpec?: unknown
  referencePlan?: unknown
  continuityGroupId?: string | null
  generationRoute?: string | null
  primarySubject?: string | null
  imageUrl?: string | null
}

interface NovelProjectCharacterAppearance {
  changeReason: string | null
  description?: string | null
  descriptions?: string | null
  selectedIndex?: number | null
}

interface NovelProjectCharacter {
  id: string
  name: string
  appearances?: NovelProjectCharacterAppearance[]
}

interface NovelProjectLocationImage {
  description?: string | null
  availableSlots?: string | null
  isSelected: boolean
}

interface NovelProjectLocation {
  id: string
  name: string
  assetKind?: string | null
  images?: NovelProjectLocationImage[]
}

interface NovelProjectData {
  videoRatio?: string | null
  characters?: NovelProjectCharacter[]
  locations?: NovelProjectLocation[]
}

function normalizeLocale(locale: string | null | undefined): PromptPreviewLocale {
  return locale === 'en' ? 'en' : 'zh'
}

function parseJsonUnknown(raw: string | null | undefined): unknown | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function parseDescriptionList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
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

function parsePanelCharacterReferences(value: string | null | undefined): Array<{
  name: string
  appearance?: string
  slot?: string
}> {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return { name: item }
        if (!item || typeof item !== 'object') return null
        const candidate = item as { name?: unknown; appearance?: unknown; slot?: unknown }
        if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
        return {
          name: candidate.name,
          appearance: typeof candidate.appearance === 'string' ? candidate.appearance : undefined,
          slot: typeof candidate.slot === 'string' ? candidate.slot : undefined,
        }
      })
      .filter(Boolean) as Array<{ name: string; appearance?: string; slot?: string }>
  } catch {
    return []
  }
}

function findCharacterByName<T extends { name: string }>(characters: T[], referenceName: string): T | undefined {
  const refLower = referenceName.toLowerCase().trim()
  if (!refLower) return undefined

  const exact = characters.find((character) => character.name.toLowerCase().trim() === refLower)
  if (exact) return exact

  const refAliases = refLower.split('/').map((item) => item.trim()).filter(Boolean)
  for (const character of characters) {
    const charAliases = character.name.toLowerCase().split('/').map((item) => item.trim()).filter(Boolean)
    if (refAliases.some((refAlias) => charAliases.includes(refAlias))) return character
  }

  return undefined
}

function toSignedUrlIfCos(keyOrUrl: string | null | undefined, ttlSeconds = 3600) {
  if (!keyOrUrl) return null
  return keyOrUrl.startsWith('images/') || keyOrUrl.startsWith('voice/') || keyOrUrl.startsWith('video/')
    ? getSignedUrl(keyOrUrl, ttlSeconds)
    : keyOrUrl
}

function normalizeStringOverride(current: string | null, value: string | null | undefined): string | null {
  if (value === undefined) return current
  return typeof value === 'string' ? value : null
}

function serializeCharactersOverride(value: PanelPromptPreviewPanelOverrides['characters']): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function serializePropsOverride(value: PanelPromptPreviewPanelOverrides['props']): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function applyPanelOverrides<T extends PanelForImagePrompt>(
  panel: T,
  overrides: PanelPromptPreviewPanelOverrides | null | undefined,
): T {
  if (!overrides) return panel
  const characters = serializeCharactersOverride(overrides.characters)
  const props = serializePropsOverride(overrides.props)
  return {
    ...panel,
    shotType: normalizeStringOverride(panel.shotType, overrides.shotType),
    cameraMove: normalizeStringOverride(panel.cameraMove, overrides.cameraMove),
    description: normalizeStringOverride(panel.description, overrides.description),
    imagePrompt: normalizeStringOverride(panel.imagePrompt, overrides.imagePrompt),
    videoPrompt: normalizeStringOverride(panel.videoPrompt, overrides.videoPrompt),
    firstLastFramePrompt: normalizeStringOverride(panel.firstLastFramePrompt || null, overrides.firstLastFramePrompt),
    location: normalizeStringOverride(panel.location, overrides.location),
    characters: characters === undefined ? panel.characters : characters,
    props: props === undefined ? panel.props : props,
    duration: overrides.duration === undefined ? panel.duration : overrides.duration,
    photographyRules: normalizeStringOverride(panel.photographyRules, overrides.photographyRules),
    actingNotes: normalizeStringOverride(panel.actingNotes, overrides.actingNotes),
  }
}

function normalizeVideoOptionMap(value: unknown): VideoOptionMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: VideoOptionMap = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'aspectRatio') continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      next[key] = raw
    }
  }
  return next
}

function resolvePromptDuration(panelDuration: number | null | undefined, generationOptions: VideoOptionMap): number | null | undefined {
  const optionDuration = generationOptions.duration
  return typeof optionDuration === 'number' && Number.isFinite(optionDuration) && optionDuration > 0
    ? optionDuration
    : panelDuration
}

function readPanelIndex(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? Math.floor(numberValue) : null
}

async function loadNovelProjectDataForPrompt(projectId: string) {
  return await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: { include: { appearances: { orderBy: { appearanceIndex: 'asc' } } } },
      locations: { include: { images: { orderBy: { imageIndex: 'asc' } } } },
    },
  })
}

async function findPanelForPromptPreview(projectId: string, locator: PromptPreviewPanelLocator) {
  if (locator.panelId?.trim()) {
    return await prisma.novelPromotionPanel.findFirst({
      where: {
        id: locator.panelId.trim(),
        storyboard: {
          episode: {
            novelPromotionProject: {
              projectId,
            },
          },
        },
      },
    })
  }

  const panelIndex = readPanelIndex(locator.panelIndex)
  if (!locator.storyboardId?.trim() || panelIndex === null) return null
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId: locator.storyboardId.trim(),
      panelIndex,
      storyboard: {
        episode: {
          novelPromotionProject: {
            projectId,
          },
        },
      },
    },
  })
}

async function fetchPanelByStoryboardIndex(params: {
  projectId: string
  storyboardId: string
  panelIndex: number
}) {
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId: params.storyboardId,
      panelIndex: params.panelIndex,
      storyboard: {
        episode: {
          novelPromotionProject: {
            projectId: params.projectId,
          },
        },
      },
    },
  })
}

export function buildPanelReferencePlan(params: {
  bindingPlan: PanelAssetBindingPlan
  references: ReturnType<typeof visualReferencesForPrompt>
  decision: ReturnType<typeof decidePanelGenerationRoute>
  backfill?: unknown
}) {
  return {
    schemaVersion: 1,
    shotAssetRequirementPlan: params.bindingPlan.requirementPlan || null,
    bindingPlan: params.bindingPlan,
    references: params.references,
    decision: params.decision,
    ...(params.backfill ? { backfill: params.backfill } : {}),
  }
}

export function buildPanelImagePromptContext(params: {
  panel: PanelForImagePrompt
  projectData: NovelProjectData
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
      available_slots: parseDescriptionList(selectedImage?.availableSlots),
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

export function buildPanelImagePrompt(params: {
  locale: PromptPreviewLocale
  aspectRatio: string
  sourceText: string
  renderBrief: string
}) {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_SINGLE_PANEL_IMAGE,
    locale: params.locale,
    variables: {
      aspect_ratio: params.aspectRatio,
      render_brief: params.renderBrief,
      source_text: params.sourceText || '无',
    },
  })
}

export function buildPanelImagePromptFromResolvedInputs(params: {
  panel: PanelForImagePrompt
  projectData: NovelProjectData
  locale: string
  resolvedArtStyle: ArtStyleGenerationResult
  visualBindings: PanelVisualBindings
  visualBindingPlan: PanelAssetBindingPlan
  visualReferences: VisualReference[]
  generationRouteDecision: ReturnType<typeof decidePanelGenerationRoute>
  referenceImages: string[]
}) {
  const locale = normalizeLocale(params.locale)
  const styleText = joinPromptSegments([
    params.resolvedArtStyle.prompt,
    params.resolvedArtStyle.referenceInstruction,
  ], locale)
  const fallbackStyleText = locale === 'en'
    ? 'consistent with the provided reference images'
    : '与参考图风格一致'
  const aspectRatio = params.projectData.videoRatio || '9:16'
  const promptContext = buildPanelImagePromptContext({
    panel: params.panel,
    projectData: params.projectData,
    visualBindings: params.visualBindings,
    visualBindingPlan: params.visualBindingPlan,
    visualReferences: params.visualReferences,
  })
  const resolvedStyleText = styleText || fallbackStyleText
  const structuredReferences = visualReferencesForPrompt(params.visualReferences)
  const referencePlan = buildPanelReferencePlan({
    bindingPlan: params.visualBindingPlan,
    references: structuredReferences,
    decision: params.generationRouteDecision,
  })
  const promptSpec = buildPanelImagePromptSpec({
    context: promptContext,
    aspectRatio,
    styleText: resolvedStyleText,
    generationRoute: params.generationRouteDecision.route,
    noReferenceReason: params.generationRouteDecision.noReferenceReason,
    referencePlan,
  })
  const renderBrief = compilePanelImageRenderBrief(promptSpec, locale)
  const compiledPrompt = buildPanelImagePrompt({
    locale,
    aspectRatio,
    sourceText: params.panel.srtSegment || params.panel.description || '',
    renderBrief,
  })
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
    referenceImages: params.referenceImages,
    visualReferences: structuredReferences,
    visualBindingPlan: params.visualBindingPlan,
  })

  return {
    promptTemplateId: PROMPT_IDS.NP_SINGLE_PANEL_IMAGE,
    aspectRatio,
    promptContext,
    promptSpec,
    compiledPrompt,
    structuredReferences,
    referencePlan,
    assetVersionHash,
    resolvedStyleText,
  }
}

export function resolveNativeAudioRequest(
  modelKey: string,
  generationOptions: VideoOptionMap,
  speech: { originalContent: string; deliveryContent?: string | null } | null,
): boolean | undefined {
  if (typeof generationOptions.generateAudio === 'boolean') {
    return generationOptions.generateAudio
  }

  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  const options = capabilities?.video?.generateAudioOptions
  if (!Array.isArray(options) || !options.includes(true)) return undefined

  if (panelSpeechHasContent(speech)) return true
  return options.includes(false) ? false : undefined
}

export function buildPanelVideoPromptFromResolvedInputs(params: {
  panel: PanelForVideoPrompt
  locale: string
  generationMode: 'normal' | 'firstlastframe'
  customPrompt?: string | null
  lastFrameProvided?: boolean
  generationOptions?: VideoOptionMap
  includeNativeAudio?: boolean
  panelSpeech?: {
    speaker: string
    originalContent: string
    deliveryContent?: string | null
    status?: string | null
    voiceConfigJson?: unknown
  } | null
}) {
  const locale = normalizeLocale(params.locale)
  const generationOptions = params.generationOptions || {}
  const promptSpec = buildPanelVideoPromptSpec({
    context: {
      panel: {
        panelId: params.panel.id,
        description: params.panel.description,
        videoPrompt: params.panel.videoPrompt,
        imagePrompt: params.panel.imagePrompt,
        cameraMove: params.panel.cameraMove,
        duration: resolvePromptDuration(params.panel.duration, generationOptions),
        photographyRules: params.panel.photographyRules,
        promptSpec: params.panel.promptSpec,
        referencePlan: params.panel.referencePlan,
        continuityGroupId: params.panel.continuityGroupId,
        generationRoute: params.panel.generationRoute,
        primarySubject: params.panel.primarySubject,
      },
      generationMode: params.generationMode,
      customPrompt: params.customPrompt || null,
      lastFrameProvided: params.lastFrameProvided === true,
    },
    locale,
  })
  const speechPromptSection = params.includeNativeAudio === true && params.panelSpeech
    ? compilePanelSpeechPromptSection({
      speech: params.panelSpeech,
      locale,
    })
    : ''
  const compiledPrompt = [
    compilePanelVideoPrompt(promptSpec, locale),
    speechPromptSection,
  ].filter(Boolean).join('\n\n')

  return {
    promptTemplateId: 'prompt_compiler.panel_video.v1',
    promptSpec,
    compiledPrompt,
  }
}

export async function buildPanelImageGenerationPromptPreview(params: {
  projectId: string
  userId: string
  locale?: string
  locator: PromptPreviewPanelLocator
  overrides?: PanelGenerationPromptPreviewOverrides
  forceNoReference?: boolean
}): Promise<PanelGenerationPromptPreview> {
  const panel = await findPanelForPromptPreview(params.projectId, params.locator)
  if (!panel) {
    throw new PanelPromptPreviewError('PANEL_NOT_FOUND', 'Panel not found')
  }
  const projectData = await loadNovelProjectDataForPrompt(params.projectId)
  if (!projectData) {
    throw new PanelPromptPreviewError('PROJECT_NOT_FOUND', 'Novel promotion project not found')
  }
  const modelConfig = await getProjectModelConfig(params.projectId, params.userId)
  const modelKey = modelConfig.storyboardModel || null
  const locale = normalizeLocale(params.locale)
  const panelForPreview = applyPanelOverrides(panel as PanelForImagePrompt, params.overrides?.panel)
  const visualBindingPlan = resolvePanelAssetBindingPlan(panelForPreview)
  const visualBindings = panelVisualBindingsFromPlan(visualBindingPlan)
  const visualReferences = resolvePanelVisualReferences({
    projectData,
    panel: panelForPreview,
    options: {
      signImageUrl: (value) => toSignedUrlIfCos(value, 3600),
    },
  })
  const generationRouteDecision = decidePanelGenerationRoute({
    panel: panelForPreview,
    bindingPlan: visualBindingPlan,
    references: visualReferences,
    forceNoReference: params.forceNoReference === true,
  })
  const rawReferenceImages = visualReferencesToImageUrls(visualReferences)
  const resolvedArtStyle = resolveArtStyleForGeneration({
    artStyleMode: modelConfig.artStyleMode,
    artStyle: modelConfig.artStyle,
    artStylePrompt: modelConfig.artStylePrompt,
    customArtStyleReferenceImage: modelConfig.customArtStyleReferenceImage,
    artStyleReferenceEnabled: modelConfig.artStyleReferenceEnabled,
    locale,
  })
  const referenceImages = prependStyleReferenceImage(
    rawReferenceImages,
    resolvedArtStyle.referenceImage,
    resolvedArtStyle.referenceEnabled,
  )
  const compiled = buildPanelImagePromptFromResolvedInputs({
    panel: panelForPreview,
    projectData,
    locale,
    resolvedArtStyle,
    visualBindings,
    visualBindingPlan,
    visualReferences,
    generationRouteDecision,
    referenceImages,
  })
  const warnings = [
    ...(!modelKey ? ['当前项目未配置分镜图片模型，提交生成前仍需先配置模型。'] : []),
    ...(generationRouteDecision.route === 'human_required'
      ? ['当前镜头缺少必要参考资产，正式生成可能会被阻断。']
      : []),
    ...(generationRouteDecision.noReferenceReason
      ? [generationRouteDecision.noReferenceReason]
      : []),
  ]

  return {
    mode: 'image',
    panelId: panel.id,
    storyboardId: panel.storyboardId,
    panelIndex: panel.panelIndex,
    modelKey,
    promptTemplateId: compiled.promptTemplateId,
    compiledPrompt: compiled.compiledPrompt,
    promptSpec: compiled.promptSpec,
    generationOptions: {
      aspectRatio: compiled.aspectRatio,
    },
    referenceImages,
    structuredReferences: compiled.structuredReferences,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
  }
}

export async function buildPanelVideoGenerationPromptPreview(params: {
  projectId: string
  userId: string
  locale?: string
  locator: PromptPreviewPanelLocator
  mode: 'video' | 'firstlastframe'
  videoModel?: string | null
  generationOptions?: unknown
  overrides?: PanelGenerationPromptPreviewOverrides
}): Promise<PanelGenerationPromptPreview> {
  const panel = await findPanelForPromptPreview(params.projectId, params.locator)
  if (!panel) {
    throw new PanelPromptPreviewError('PANEL_NOT_FOUND', 'Panel not found')
  }
  const modelConfig = await getProjectModelConfig(params.projectId, params.userId)
  const locale = normalizeLocale(params.locale)
  const generationOptions = normalizeVideoOptionMap(params.generationOptions)
  const firstLastFrame = params.overrides?.firstLastFrame || null
  const generationMode = params.mode === 'firstlastframe' ? 'firstlastframe' : 'normal'
  const modelKey = generationMode === 'firstlastframe'
    ? (firstLastFrame?.flModel?.trim() || params.videoModel?.trim() || modelConfig.videoModel || null)
    : (params.videoModel?.trim() || modelConfig.videoModel || null)
  const panelForPreview = applyPanelOverrides(panel as PanelForImagePrompt, params.overrides?.panel) as PanelForImagePrompt & PanelForVideoPrompt
  const customPrompt = generationMode === 'firstlastframe'
    ? (
        firstLastFrame?.customPrompt
        || panelForPreview.firstLastFramePrompt
        || null
      )
    : null
  const warnings: string[] = []
  const referenceImages: string[] = []
  const sourceImageUrl = toSignedUrlIfCos(panelForPreview.imageUrl || null, 3600)
  if (sourceImageUrl) {
    referenceImages.push(sourceImageUrl)
  } else {
    warnings.push('当前镜头缺少首帧图片，正式提交视频生成前仍需先完成图片。')
  }

  let lastFrameProvided = false
  if (generationMode === 'firstlastframe') {
    const lastFrameStoryboardId = firstLastFrame?.lastFrameStoryboardId?.trim() || ''
    const lastFramePanelIndex = readPanelIndex(firstLastFrame?.lastFramePanelIndex)
    if (lastFrameStoryboardId && lastFramePanelIndex !== null) {
      const lastPanel = await fetchPanelByStoryboardIndex({
        projectId: params.projectId,
        storyboardId: lastFrameStoryboardId,
        panelIndex: lastFramePanelIndex,
      })
      const lastFrameImageUrl = toSignedUrlIfCos(lastPanel?.imageUrl || null, 3600)
      if (lastFrameImageUrl) {
        referenceImages.push(lastFrameImageUrl)
        lastFrameProvided = true
      } else {
        warnings.push('尾帧镜头缺少图片，首尾帧生成前仍需补齐尾帧。')
      }
    } else {
      warnings.push('尚未选择尾帧镜头，首尾帧生成前仍需完成连接。')
    }
  }

  let panelSpeech: Parameters<typeof buildPanelVideoPromptFromResolvedInputs>[0]['panelSpeech'] = null
  try {
    const panelSpeechState = await validatePanelSpeechReadyForVideo(panel.id)
    if (panelSpeechState.ready) {
      panelSpeech = panelSpeechState.speech
    } else {
      warnings.push(...panelSpeechState.reasons)
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : '读取台词状态失败，预览未包含台词段落。')
  }

  if (!modelKey) {
    warnings.push('当前项目未配置视频模型，提交生成前仍需先配置模型。')
  }
  const requestedGenerateAudio = modelKey
    ? resolveNativeAudioRequest(modelKey, generationOptions, panelSpeech)
    : undefined
  const compiled = buildPanelVideoPromptFromResolvedInputs({
    panel: panelForPreview,
    locale,
    generationMode,
    customPrompt,
    lastFrameProvided,
    generationOptions,
    includeNativeAudio: requestedGenerateAudio === true,
    panelSpeech,
  })

  return {
    mode: generationMode === 'firstlastframe' ? 'firstlastframe' : 'video',
    panelId: panel.id,
    storyboardId: panel.storyboardId,
    panelIndex: panel.panelIndex,
    modelKey,
    promptTemplateId: compiled.promptTemplateId,
    compiledPrompt: compiled.compiledPrompt,
    promptSpec: compiled.promptSpec,
    generationOptions: {
      ...(modelConfig.videoRatio ? { aspectRatio: modelConfig.videoRatio } : {}),
      ...generationOptions,
      generationMode,
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
    },
    referenceImages: Array.from(new Set(referenceImages.filter(Boolean))),
    warnings: Array.from(new Set(warnings.filter(Boolean))),
  }
}

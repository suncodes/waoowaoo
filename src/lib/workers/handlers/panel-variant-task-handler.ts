import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getStyleReferenceInstruction, joinPromptSegments } from '@/lib/constants'
import { resolveArtStyleForGeneration } from '@/lib/art-style-generation'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
} from '../utils'
import {
  formatLocationAvailableSlotsText,
  parseLocationAvailableSlots,
} from '@/lib/location-available-slots'
import {
  AnyObj,
  collectPanelVisualReferenceCandidates,
  findCharacterByName,
  parsePanelCharacterReferences,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import {
  resolvePanelVisualReferenceSelection,
  type PanelVisualReferenceSelection,
  type VisualReference,
} from '@/lib/visual-production/references'

// ── 构建变体提示词 ──────────────────────────────────────
interface VariantPromptParams {
  locale: TaskJobData['locale']
  originalDescription: string
  originalShotType: string
  originalCameraMove: string
  location: string
  charactersInfo: string
  variantTitle: string
  variantDescription: string
  targetShotType: string
  targetCameraMove: string
  videoPrompt: string
  characterAssets: string
  locationAsset: string
  aspectRatio: string
  style: string
}

function buildVariantPrompt(params: VariantPromptParams): string {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_SHOT_VARIANT_GENERATE,
    locale: params.locale,
    variables: {
      original_description: params.originalDescription,
      original_shot_type: params.originalShotType,
      original_camera_move: params.originalCameraMove,
      location: params.location,
      characters_info: params.charactersInfo,
      variant_title: params.variantTitle,
      variant_description: params.variantDescription,
      target_shot_type: params.targetShotType,
      target_camera_move: params.targetCameraMove,
      video_prompt: params.videoPrompt,
      character_assets: params.characterAssets,
      location_asset: params.locationAsset,
      aspect_ratio: params.aspectRatio,
      style: params.style,
    },
  })
}

// ── 构建角色和场景描述信息 ─────────────────────────────
function buildCharactersInfo(
  panel: { characters: string | null },
  projectData: { characters?: Array<{ name: string; introduction?: string | null; appearances?: Array<{ changeReason?: string | null }> }> },
): string {
  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  if (panelCharacters.length === 0) return '无角色'

  return panelCharacters.map(item => {
    const character = findCharacterByName(projectData.characters || [], item.name)
    const intro = character?.introduction || ''
    const appearance = item.appearance || '默认形象'
    const slotText = item.slot ? `，固定位置：${item.slot}` : ''
    return `- ${item.name}（${appearance}${slotText}）${intro ? `：${intro}` : ''}`
  }).join('\n')
}

function buildCharacterAssetsDescription(
  panel: { characters: string | null },
  projectData: { characters?: Array<{ name: string; appearances?: Array<{ changeReason?: string | null; imageUrl?: string | null }> }> },
): string {
  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  if (panelCharacters.length === 0) return '无角色参考图'

  return panelCharacters.map(item => {
    const character = findCharacterByName(projectData.characters || [], item.name)
    if (!character) return `- ${item.name}：无参考图`
    const hasAppearance = (character.appearances || []).length > 0
    return `- ${item.name}：${hasAppearance ? '已提供参考图' : '无参考图'}`
  }).join('\n')
}

function buildLocationAssetDescription(params: {
  includeLocationAsset: boolean
  locationName: string
  locale: TaskJobData['locale']
  projectData: Awaited<ReturnType<typeof resolveNovelData>>
}): string {
  if (params.locationName) {
    if (params.includeLocationAsset) {
      const location = (params.projectData.locations || []).find(
        (item) => item.name.toLowerCase() === params.locationName.toLowerCase(),
      )
      const selectedImage = location?.images?.find((image) => image.isSelected) ?? location?.images?.[0]
      const description = selectedImage?.description?.trim()
      const slotsText = formatLocationAvailableSlotsText(
        parseLocationAvailableSlots(selectedImage?.availableSlots),
        params.locale,
      )
      const parts = [
        params.locale === 'en' ? `Location: ${params.locationName}` : `场景：${params.locationName}`,
      ]
      if (description) {
        parts.push(params.locale === 'en' ? `Scene description: ${description}` : `场景描述：${description}`)
      }
      if (slotsText) parts.push(slotsText)
      return parts.join('\n')
    }
    return params.locale === 'en' ? 'Location reference disabled' : '未使用场景参考图'
  }
  return params.locale === 'en' ? 'No location reference' : '无场景参考'
}

async function buildVariantReferenceImages(params: {
  includeCharacterAssets: boolean
  includeLocationAsset: boolean
  newPanel: {
    sketchImageUrl: string | null
    characters: string | null
    location: string | null
    props: string | null
    sourceAnchor: unknown
  }
  sourcePanelImageUrl: string | null
  projectData: Awaited<ReturnType<typeof resolveNovelData>>
  styleReferenceImage: string | null
  styleReferenceEnabled: boolean
  locale: TaskJobData['locale']
}): Promise<PanelVisualReferenceSelection> {
  const semanticReferences = await collectPanelVisualReferenceCandidates(params.projectData, params.newPanel, {
    includeCharacterAssets: params.includeCharacterAssets,
    includeLocationAssets: params.includeLocationAsset,
    includePropAssets: true,
  })
  const sourceReference: VisualReference[] = params.sourcePanelImageUrl
    ? [{
      assetId: null,
      renderId: null,
      assetKind: 'panel',
      assetName: params.locale === 'en' ? 'source panel image' : '原镜头图片',
      url: params.sourcePanelImageUrl,
      role: 'previous_frame',
      usage: 'adapt',
      weight: 1.1,
      source: 'previous_frame',
    }]
    : []
  const styleReference: VisualReference[] = params.styleReferenceEnabled && params.styleReferenceImage
    ? [{
      assetId: null,
      renderId: null,
      assetKind: 'style',
      assetName: params.locale === 'en' ? 'visual style reference' : '视觉风格参考图',
      url: params.styleReferenceImage,
      role: 'style_only',
      usage: 'avoid_copy',
      weight: 0.35,
      source: 'style',
    }]
    : []
  const selection = resolvePanelVisualReferenceSelection({
    projectData: {},
    panel: params.newPanel,
    options: {
      includeCharacterAssets: false,
      includeLocationAssets: false,
      includePropAssets: false,
      includeSourceAnchorAssets: false,
    },
    additionalReferences: [...sourceReference, ...semanticReferences, ...styleReference],
  })
  return selection
}

interface PanelVariantPayload {
  shot_type?: string
  camera_move?: string
  description?: string
  video_prompt?: string
  title?: string
  location?: string
  characters?: unknown
}

export async function handlePanelVariantTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const newPanelId = pickFirstString(payload.newPanelId)
  const sourcePanelId = pickFirstString(payload.sourcePanelId)
  const includeCharacterAssets = payload.includeCharacterAssets !== false
  const includeLocationAsset = payload.includeLocationAsset !== false
  const variant: PanelVariantPayload = payload.variant && typeof payload.variant === 'object'
    ? (payload.variant as PanelVariantPayload)
    : {}

  if (!newPanelId || !sourcePanelId) {
    throw new Error('panel_variant missing newPanelId/sourcePanelId')
  }

  // Panel 已在 API route 中创建，这里只需获取它
  const newPanel = await prisma.novelPromotionPanel.findUnique({ where: { id: newPanelId } })
  if (!newPanel) throw new Error('New panel not found (should have been created by API route)')

  const sourcePanel = await prisma.novelPromotionPanel.findUnique({ where: { id: sourcePanelId } })
  if (!sourcePanel) throw new Error('Source panel not found')

  const projectData = await resolveNovelData(job.data.projectId)
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const aspectRatio = projectData.videoRatio

  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const storyboardModel = modelConfig.storyboardModel
  if (!storyboardModel) throw new Error('Storyboard model not configured')

  // 使用 agent_shot_variant_generate.txt 提示词模板
  const resolvedArtStyle = resolveArtStyleForGeneration({
    artStyleMode: modelConfig.artStyleMode,
    artStyle: modelConfig.artStyle,
    artStylePrompt: modelConfig.artStylePrompt,
    customArtStyleReferenceImage: modelConfig.customArtStyleReferenceImage,
    artStyleReferenceEnabled: modelConfig.artStyleReferenceEnabled,
    locale: job.data.locale,
  })
  const fallbackStyleText = job.data.locale === 'en'
    ? 'consistent with the provided reference images'
    : '与参考图风格一致'
  const referenceSelection = await buildVariantReferenceImages({
    includeCharacterAssets,
    includeLocationAsset,
    newPanel,
    sourcePanelImageUrl: toSignedUrlIfCos(sourcePanel.imageUrl, 3600),
    projectData,
    styleReferenceImage: resolvedArtStyle.referenceImage,
    styleReferenceEnabled: resolvedArtStyle.referenceEnabled,
    locale: job.data.locale,
  })
  const referenceImages = referenceSelection.selected.map((reference) => reference.url)
  const styleText = joinPromptSegments([
    resolvedArtStyle.prompt,
    getStyleReferenceInstruction(
      resolvedArtStyle.referenceImage,
      resolvedArtStyle.referenceEnabled && referenceSelection.selected.some((reference) => reference.assetKind === 'style'),
      job.data.locale,
    ),
  ], job.data.locale)
  const charactersInfo = buildCharactersInfo(newPanel, projectData)
  const characterAssetsDesc = includeCharacterAssets
    ? buildCharacterAssetsDescription(newPanel, projectData)
    : (job.data.locale === 'en' ? 'Character reference images disabled' : '未使用角色参考图')
  const locationName = newPanel.location || sourcePanel.location || ''

  const prompt = buildVariantPrompt({
    locale: job.data.locale,
    originalDescription: sourcePanel.description || '',
    originalShotType: sourcePanel.shotType || '',
    originalCameraMove: sourcePanel.cameraMove || '',
    location: locationName,
    charactersInfo,
    variantTitle: pickFirstString(variant.title) || '镜头变体',
    variantDescription: variant.description || '',
    targetShotType: variant.shot_type || sourcePanel.shotType || '',
    targetCameraMove: variant.camera_move || sourcePanel.cameraMove || '',
    videoPrompt: pickFirstString(variant.video_prompt, variant.description) || '',
    characterAssets: characterAssetsDesc,
    locationAsset: buildLocationAssetDescription({
      includeLocationAsset,
      locationName,
      locale: job.data.locale,
      projectData,
    }),
    aspectRatio,
    style: styleText || fallbackStyleText,
  })

  _ulogInfo('[panel-variant] resolved variant prompt', prompt)

  await assertTaskActive(job, 'generate_panel_variant_image')
  const source = await resolveImageSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: storyboardModel,
    prompt,
    options: {
      referenceImages,
      aspectRatio,
    },
  })

  const cosKey = await uploadImageSourceToCos(source, 'panel-variant', newPanel.id)

  await assertTaskActive(job, 'persist_panel_variant')
  await prisma.novelPromotionPanel.update({
    where: { id: newPanel.id },
    data: { imageUrl: cosKey },
  })

  return {
    panelId: newPanel.id,
    storyboardId: newPanel.storyboardId,
    imageUrl: cosKey,
  }
}

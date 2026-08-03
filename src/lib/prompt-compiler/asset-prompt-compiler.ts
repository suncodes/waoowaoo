import {
  CHARACTER_PROMPT_SUFFIX,
  LOCATION_IMAGE_RATIO,
  PROP_PROMPT_SUFFIX,
  addCharacterPromptSuffix,
  addLocationPromptSuffix,
  addPropPromptSuffix,
} from '@/lib/constants'
import {
  formatLocationAvailableSlotsText,
  parseLocationAvailableSlots,
} from '@/lib/location-available-slots'
import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  createCreativeQualityHash,
  type GenerationSnapshot,
} from '@/lib/creative-quality/contracts'
import {
  inferAssetSemanticType,
  type AssetSemanticType,
  type AssetTier,
  type AssetUsageScope,
} from '@/lib/assets/asset-semantics'

type Locale = 'zh' | 'en'
type AssetImageTemplateKind =
  | 'character_reference_sheet'
  | 'vehicle_turnaround'
  | 'prop_turnaround'
  | 'environment_plate'
  | 'book_clean_plate'
  | 'symbol_sheet'

export interface AssetPromptSpec {
  schemaVersion: typeof CREATIVE_QUALITY_SCHEMA_VERSION
  assetId: string
  assetKind: 'character' | 'location' | 'prop'
  semanticType: AssetSemanticType
  assetTier?: AssetTier
  usageScope?: AssetUsageScope
  templateKind: AssetImageTemplateKind
  assetName: string
  renderPurpose: 'reference_sheet' | 'single_reference' | 'variant' | 'repair'
  identityLocks: string[]
  shapeAndSilhouette: string[]
  materialAndTexture: string[]
  colorPalette: string[]
  keyParts: string[]
  viewAndComposition: string
  backgroundRule: string
  styleApplication: string
  qualityTerms: string[]
  negativeConstraints: string[]
  sourceEvidence: string[]
  availableSlots: string[]
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() || '').filter(Boolean)))
}

function splitDescription(value: string): string[] {
  return uniqueStrings(value.split(/[，,；;\n。.!！?？]+/g).map((item) => item.trim())).slice(0, 8)
}

function buildDefaultNegativeConstraints(kind: AssetPromptSpec['assetKind'], locale: Locale): string[] {
  if (locale === 'en') {
    const bookTextNegatives = [
      'no title, author name, readable letters, numbers, fake glyphs, printed copy, logo or barcode',
      'asset name is an internal label and must not appear on the image',
    ]
    if (kind === 'location') {
      return [
        'no text, watermark, logo, signature, UI, subtitles, posters or readable labels',
        'no characters, faces, crowds or unrelated props unless explicitly described',
        'no cropped anchor objects, ambiguous layout, collage, split screen or multi-panel image',
      ]
    }
    if (kind === 'prop') {
      return [
        'no text, watermark, logo, signature, UI or readable label',
        'no people, faces, bodies, hands, animals, buildings, tabletop clutter or environment',
        'no existing IP character, mixed object set, collage, split screen with different objects',
        ...bookTextNegatives,
      ]
    }
    return [
      'no second character, crowd, background scene, building, prop clutter, text, watermark or logo',
      'no existing IP character or unrelated style-reference subject',
      'do not place different characters in different views',
    ]
  }
  const bookTextNegatives = [
    '禁止书名、作者名、可读字母、数字、伪文字、印刷文案、徽标和条形码',
    '资产名称只是内部标签，禁止出现在图像里',
  ]
  if (kind === 'location') {
    return [
      '禁止文字、水印、徽标、签名、UI、字幕、海报和可读标签',
      '禁止人物、脸、群像和未明确描述的无关道具',
      '禁止关键锚物裁切、空间关系模糊、拼贴、多格图和分屏',
    ]
  }
  if (kind === 'prop') {
    return [
      '禁止文字、水印、徽标、签名、UI 和可读标签',
      '禁止人物、角色、脸、五官、身体、手部、动物、建筑、桌面陈设和环境背景',
      '禁止已有 IP 角色、多个不同对象混杂、拼贴和把不同对象放入不同视图区',
      ...bookTextNegatives,
    ]
  }
  return [
    '禁止第二个角色、群像、环境背景、建筑、道具陈设、文字、数字、水印和徽标',
    '禁止已有 IP 角色和复制风格参考图里的主体',
    '禁止把不同角色分别放入不同视图区',
  ]
}

function resolveTemplateKind(
  kind: AssetPromptSpec['assetKind'],
  semanticType: AssetSemanticType,
): AssetImageTemplateKind {
  if (kind === 'character') return 'character_reference_sheet'
  if (kind === 'location') return 'environment_plate'
  if (semanticType === 'vehicle') return 'vehicle_turnaround'
  if (semanticType === 'book') return 'book_clean_plate'
  if (semanticType === 'symbol') return 'symbol_sheet'
  return 'prop_turnaround'
}

function resolveViewAndComposition(
  kind: AssetPromptSpec['assetKind'],
  semanticType: AssetSemanticType,
  locale: Locale,
): string {
  if (locale === 'en') {
    if (kind === 'location') return 'wide complete environment establishing shot, clear foreground, midground, background and spatial boundaries'
    if (semanticType === 'vehicle') return 'vehicle turnaround reference, clear 3/4 hero view plus front, side and rear views, consistent nose-tail direction and silhouette'
    if (semanticType === 'book') return 'clean book or cover plate, one physical book object or blank cover surface, clear readable shape but no readable text'
    if (semanticType === 'symbol') return 'symbol reference sheet, clean isolated motif silhouette and two small material variants, no readable letters'
    if (kind === 'prop') return 'single object reference sheet, main view plus front, side and rear views, all views share the same design'
    return 'character reference sheet, front portrait plus front, side and rear full-body views, same identity in every view'
  }
  if (kind === 'location') return '宽广完整的场景全景构图，清楚展示前景、中景、背景和空间边界'
  if (semanticType === 'vehicle') return '载具设定图，清晰 3/4 主视图加正面、侧面、背面三视图，头尾方向、轮廓、比例和关键部件严格一致'
  if (semanticType === 'book') return '干净书本或封面底图，单一本体或空白封面表面，形体清楚但不生成任何可读文字'
  if (semanticType === 'symbol') return '符号设定图，干净孤立的核心图案剪影，可带少量材质变体，禁止可读字母和真实徽标'
  if (kind === 'prop') return '单一道具设定图，主体主视图特写加正面、侧面、背面三视图，同一设计严格一致'
  return '角色设定图，正面特写加正面、侧面、背面全身三视图，同一角色身份严格一致'
}

function resolveBackgroundRule(
  kind: AssetPromptSpec['assetKind'],
  semanticType: AssetSemanticType,
  locale: Locale,
): string {
  if (locale === 'en') {
    if (kind === 'location') return 'complete usable environment, no decorative frame, keep clear placement space for later character compositing'
    if (semanticType === 'book') return 'plain neutral studio background, blank cover surface reserved for downstream title overlay'
    return 'plain white or light neutral background, complete centered subject, no environment context'
  }
  if (kind === 'location') return '完整可用的场景空间，不加装饰边框，为后续角色落位保留清晰空间'
  if (semanticType === 'book') return '纯净中性棚拍背景，封面区域为空白或抽象纹理，准确书名留给后期合成'
  return '纯白或浅中性背景，主体完整居中展示，不生成环境叙事背景'
}

function resolveQualityTerms(
  kind: AssetPromptSpec['assetKind'],
  semanticType: AssetSemanticType,
  locale: Locale,
): string[] {
  if (locale === 'en') {
    if (semanticType === 'vehicle') return ['single vehicle identity', 'stable silhouette', 'clear nose-tail direction', 'readable key parts']
    if (semanticType === 'book') return ['clean plate', 'no readable text', 'clear book geometry', 'overlay-safe cover area']
    return kind === 'location'
      ? ['clear structure', 'usable spatial layout', 'readable anchor areas', 'consistent project style']
      : ['single subject', 'consistent identity across views', 'readable silhouette', 'clean material detail']
  }
  if (semanticType === 'vehicle') return ['单一载具身份', '轮廓稳定', '头尾方向明确', '关键部件可读']
  if (semanticType === 'book') return ['干净底图', '无可读文字', '书本几何清楚', '封面区域便于后期叠字']
  return kind === 'location'
    ? ['结构清晰', '空间可用', '锚点可读', '项目风格一致']
    : ['单一主体', '多视图身份一致', '轮廓可读', '材质细节干净']
}

function resolveStyleApplication(styleText: string, referenceInstruction: string, locale: Locale): string {
  const style = firstNonEmpty(styleText, locale === 'en' ? 'follow the project visual style' : '遵循项目美术风格')
  const reference = referenceInstruction.trim()
  if (!reference) return style
  const normalizedStyle = style.replace(/[。.]$/u, '')
  return locale === 'en'
    ? `${normalizedStyle}. ${reference}`
    : `${normalizedStyle}。${reference}`
}

export function buildAssetPromptSpec(params: {
  assetId: string
  assetKind: AssetPromptSpec['assetKind']
  assetName: string
  description: string
  semanticType?: AssetSemanticType | string | null
  assetTier?: AssetTier | string | null
  usageScope?: AssetUsageScope | string | null
  renderPurpose?: AssetPromptSpec['renderPurpose']
  variantLabel?: string | null
  styleText: string
  styleReferenceInstruction?: string
  availableSlotsRaw?: string | null
  locale: Locale
}): AssetPromptSpec {
  const description = params.description.trim()
  const semanticType = inferAssetSemanticType({
    assetKind: params.assetKind,
    name: params.assetName,
    description,
    explicitSemanticType: typeof params.semanticType === 'string' ? params.semanticType : null,
  })
  const templateKind = resolveTemplateKind(params.assetKind, semanticType)
  const evidence = uniqueStrings([description])
  const descriptionFragments = splitDescription(description)
  const identityLocks = uniqueStrings([
    semanticType === 'book' ? null : params.assetName,
    params.variantLabel || null,
    description,
  ])
  const availableSlots = params.assetKind === 'location'
    ? parseLocationAvailableSlots(params.availableSlotsRaw)
    : []
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    assetId: params.assetId,
    assetKind: params.assetKind,
    semanticType,
    assetTier: typeof params.assetTier === 'string' ? params.assetTier as AssetTier : undefined,
    usageScope: typeof params.usageScope === 'string' ? params.usageScope as AssetUsageScope : undefined,
    templateKind,
    assetName: params.assetName,
    renderPurpose: params.renderPurpose || (params.assetKind === 'location' ? 'single_reference' : 'reference_sheet'),
    identityLocks,
    shapeAndSilhouette: descriptionFragments.length > 0 ? descriptionFragments : [params.assetName],
    materialAndTexture: descriptionFragments,
    colorPalette: descriptionFragments,
    keyParts: descriptionFragments,
    viewAndComposition: resolveViewAndComposition(params.assetKind, semanticType, params.locale),
    backgroundRule: resolveBackgroundRule(params.assetKind, semanticType, params.locale),
    styleApplication: resolveStyleApplication(params.styleText, params.styleReferenceInstruction || '', params.locale),
    qualityTerms: resolveQualityTerms(params.assetKind, semanticType, params.locale),
    negativeConstraints: buildDefaultNegativeConstraints(params.assetKind, params.locale),
    sourceEvidence: evidence,
    availableSlots,
  }
}

function listLine(label: string, values: string[], fallback: string): string {
  return `${label}${values.length > 0 ? values.join('；') : fallback}`
}

function inlineIdentityLocks(spec: AssetPromptSpec): string[] {
  return uniqueStrings(spec.identityLocks.filter((value) => !spec.sourceEvidence.includes(value)))
}

function visualFeatureTerms(spec: AssetPromptSpec): string[] {
  return uniqueStrings([
    ...spec.shapeAndSilhouette,
    ...spec.materialAndTexture,
    ...spec.colorPalette,
    ...spec.keyParts,
  ])
}

function compileSpecBody(spec: AssetPromptSpec, locale: Locale): string {
  const slotText = spec.availableSlots.length > 0
    ? formatLocationAvailableSlotsText(spec.availableSlots, locale)
    : ''
  const identityLocks = inlineIdentityLocks(spec)
  const visualFeatures = visualFeatureTerms(spec)
  if (locale === 'en') {
    return [
      `${spec.assetKind} asset image, purpose: ${spec.renderPurpose}.`,
      `Semantic type: ${spec.semanticType}; template: ${spec.templateKind}.`,
      spec.semanticType === 'book'
        ? `Asset name is an internal label only, not image text: ${spec.assetName}.`
        : `Asset name: ${spec.assetName}.`,
      identityLocks.length ? listLine('Identity locks: ', identityLocks, spec.assetName) : '',
      listLine('Visual features: ', visualFeatures, 'use the source description only'),
      `View and composition: ${spec.viewAndComposition}.`,
      slotText ? `Fixed usable positions:\n${slotText}` : '',
      `Background rule: ${spec.backgroundRule}.`,
      `Style application: ${spec.styleApplication}.`,
      listLine('Quality terms: ', spec.qualityTerms, 'clean readable asset image'),
      `Negative constraints: ${spec.negativeConstraints.join('; ')}.`,
    ].filter(Boolean).join('\n')
  }
  return [
    `${spec.assetKind === 'character' ? '角色' : spec.assetKind === 'prop' ? '道具' : '场景'}资产图，用途：${spec.renderPurpose}。`,
    `语义类型：${spec.semanticType}；图型模板：${spec.templateKind}。`,
    spec.semanticType === 'book'
      ? `资产名称只是内部标签，不得画入图像：${spec.assetName}。`
      : `资产名称：${spec.assetName}。`,
    identityLocks.length ? listLine('身份不变量：', identityLocks, spec.assetName) : '',
    listLine('视觉特征：', visualFeatures, '只使用来源描述中的视觉特征'),
    `视角与构图：${spec.viewAndComposition}。`,
    slotText ? `固定可用位置：\n${slotText}` : '',
    `背景规则：${spec.backgroundRule}。`,
    `项目风格作用范围：${spec.styleApplication}。`,
    listLine('质量要求：', spec.qualityTerms, '干净清晰的资产图'),
    `禁止项：${spec.negativeConstraints.join('；')}。`,
  ].filter(Boolean).join('\n')
}

export function compileAssetImagePrompt(params: {
  spec: AssetPromptSpec
  locale: Locale
}): string {
  const body = compileSpecBody(params.spec, params.locale)
  if (params.spec.assetKind === 'character') return addCharacterPromptSuffix(body)
  if (params.spec.assetKind === 'prop') return addPropPromptSuffix(body)
  return addLocationPromptSuffix(body.trim())
}

export function getAssetPromptTerminalConstraint(kind: AssetPromptSpec['assetKind']): string {
  if (kind === 'character') return CHARACTER_PROMPT_SUFFIX
  if (kind === 'prop') return PROP_PROMPT_SUFFIX
  return kind === 'location' ? '禁止项：' : ''
}

export function buildAssetImageGenerationSnapshot(params: {
  targetType: GenerationSnapshot['targetType']
  targetId: string
  modelKey: string
  promptTemplateId: string
  referenceImages: string[]
  promptSpec: AssetPromptSpec
  compiledPrompt: string
  assetVersionHash?: string | null
}): GenerationSnapshot {
  const specHash = createCreativeQualityHash(params.promptSpec)
  const promptHash = createCreativeQualityHash(params.compiledPrompt)
  const inputHash = createCreativeQualityHash({
    promptTemplateId: params.promptTemplateId,
    promptSpecHash: specHash,
    referenceImages: params.referenceImages,
    assetVersionHash: params.assetVersionHash || null,
  })
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    snapshotType: 'asset_image_prompt',
    targetType: params.targetType,
    targetId: params.targetId,
    modelKey: params.modelKey,
    promptTemplateId: params.promptTemplateId,
    promptHash,
    specHash,
    inputHash,
    assetVersionHash: params.assetVersionHash || null,
    referenceImages: params.referenceImages,
    promptSpec: params.promptSpec,
    compiledPrompt: params.compiledPrompt,
    createdAt: new Date().toISOString(),
  }
}

export const ASSET_PROMPT_TEMPLATE_ID = 'asset_image_prompt_compiler.v1'
export const DEFAULT_LOCATION_ASSET_ASPECT_RATIO = LOCATION_IMAGE_RATIO

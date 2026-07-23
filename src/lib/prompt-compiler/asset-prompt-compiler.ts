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

type Locale = 'zh' | 'en'

export interface AssetPromptSpec {
  schemaVersion: typeof CREATIVE_QUALITY_SCHEMA_VERSION
  assetId: string
  assetKind: 'character' | 'location' | 'prop'
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
      ]
    }
    return [
      'no second character, crowd, background scene, building, prop clutter, text, watermark or logo',
      'no existing IP character or unrelated style-reference subject',
      'do not place different characters in different views',
    ]
  }
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
    ]
  }
  return [
    '禁止第二个角色、群像、环境背景、建筑、道具陈设、文字、数字、水印和徽标',
    '禁止已有 IP 角色和复制风格参考图里的主体',
    '禁止把不同角色分别放入不同视图区',
  ]
}

function resolveViewAndComposition(kind: AssetPromptSpec['assetKind'], locale: Locale): string {
  if (locale === 'en') {
    if (kind === 'location') return 'wide complete environment establishing shot, clear foreground, midground, background and spatial boundaries'
    if (kind === 'prop') return 'single object reference sheet, main view plus front, side and rear views, all views share the same design'
    return 'character reference sheet, front portrait plus front, side and rear full-body views, same identity in every view'
  }
  if (kind === 'location') return '宽广完整的场景全景构图，清楚展示前景、中景、背景和空间边界'
  if (kind === 'prop') return '单一道具设定图，主体主视图特写加正面、侧面、背面三视图，同一设计严格一致'
  return '角色设定图，正面特写加正面、侧面、背面全身三视图，同一角色身份严格一致'
}

function resolveBackgroundRule(kind: AssetPromptSpec['assetKind'], locale: Locale): string {
  if (locale === 'en') {
    if (kind === 'location') return 'complete usable environment, no decorative frame, keep clear placement space for later character compositing'
    return 'plain white or light neutral background, complete centered subject, no environment context'
  }
  if (kind === 'location') return '完整可用的场景空间，不加装饰边框，为后续角色落位保留清晰空间'
  return '纯白或浅中性背景，主体完整居中展示，不生成环境叙事背景'
}

function resolveQualityTerms(kind: AssetPromptSpec['assetKind'], locale: Locale): string[] {
  if (locale === 'en') {
    return kind === 'location'
      ? ['clear structure', 'usable spatial layout', 'readable anchor areas', 'consistent project style']
      : ['single subject', 'consistent identity across views', 'readable silhouette', 'clean material detail']
  }
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
  renderPurpose?: AssetPromptSpec['renderPurpose']
  variantLabel?: string | null
  styleText: string
  styleReferenceInstruction?: string
  availableSlotsRaw?: string | null
  locale: Locale
}): AssetPromptSpec {
  const description = params.description.trim()
  const evidence = uniqueStrings([description])
  const descriptionFragments = splitDescription(description)
  const identityLocks = uniqueStrings([
    params.assetName,
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
    assetName: params.assetName,
    renderPurpose: params.renderPurpose || (params.assetKind === 'location' ? 'single_reference' : 'reference_sheet'),
    identityLocks,
    shapeAndSilhouette: descriptionFragments.length > 0 ? descriptionFragments : [params.assetName],
    materialAndTexture: descriptionFragments,
    colorPalette: descriptionFragments,
    keyParts: descriptionFragments,
    viewAndComposition: resolveViewAndComposition(params.assetKind, params.locale),
    backgroundRule: resolveBackgroundRule(params.assetKind, params.locale),
    styleApplication: resolveStyleApplication(params.styleText, params.styleReferenceInstruction || '', params.locale),
    qualityTerms: resolveQualityTerms(params.assetKind, params.locale),
    negativeConstraints: buildDefaultNegativeConstraints(params.assetKind, params.locale),
    sourceEvidence: evidence,
    availableSlots,
  }
}

function listLine(label: string, values: string[], fallback: string): string {
  return `${label}${values.length > 0 ? values.join('；') : fallback}`
}

function compileSpecBody(spec: AssetPromptSpec, locale: Locale): string {
  const slotText = spec.availableSlots.length > 0
    ? formatLocationAvailableSlotsText(spec.availableSlots, locale)
    : ''
  if (locale === 'en') {
    return [
      `${spec.assetKind} asset image, purpose: ${spec.renderPurpose}.`,
      `Asset name: ${spec.assetName}.`,
      listLine('Identity locks: ', spec.identityLocks, spec.assetName),
      listLine('Shape and silhouette: ', spec.shapeAndSilhouette, spec.assetName),
      listLine('Material and texture: ', spec.materialAndTexture, 'use the source description only'),
      listLine('Color and key parts: ', uniqueStrings([...spec.colorPalette, ...spec.keyParts]), 'use the source description only'),
      `View and composition: ${spec.viewAndComposition}.`,
      slotText ? `Fixed usable positions:\n${slotText}` : '',
      `Background rule: ${spec.backgroundRule}.`,
      `Style application: ${spec.styleApplication}.`,
      listLine('Quality terms: ', spec.qualityTerms, 'clean readable asset image'),
    ].filter(Boolean).join('\n')
  }
  return [
    `${spec.assetKind === 'character' ? '角色' : spec.assetKind === 'prop' ? '道具' : '场景'}资产图，用途：${spec.renderPurpose}。`,
    `资产名称：${spec.assetName}。`,
    listLine('身份不变量：', spec.identityLocks, spec.assetName),
    listLine('形体轮廓：', spec.shapeAndSilhouette, spec.assetName),
    listLine('材质纹理：', spec.materialAndTexture, '只使用来源描述中的材质信息'),
    listLine('颜色与关键部件：', uniqueStrings([...spec.colorPalette, ...spec.keyParts]), '只使用来源描述中的颜色和部件信息'),
    `视角与构图：${spec.viewAndComposition}。`,
    slotText ? `固定可用位置：\n${slotText}` : '',
    `背景规则：${spec.backgroundRule}。`,
    `项目风格作用范围：${spec.styleApplication}。`,
    listLine('质量要求：', spec.qualityTerms, '干净清晰的资产图'),
  ].filter(Boolean).join('\n')
}

export function compileAssetImagePrompt(params: {
  spec: AssetPromptSpec
  locale: Locale
}): string {
  const body = compileSpecBody(params.spec, params.locale)
  if (params.spec.assetKind === 'character') return addCharacterPromptSuffix(body)
  if (params.spec.assetKind === 'prop') return addPropPromptSuffix(body)
  const negative = params.locale === 'en'
    ? `Negative constraints: ${params.spec.negativeConstraints.join('; ')}.`
    : `禁止项：${params.spec.negativeConstraints.join('；')}。`
  return addLocationPromptSuffix(`${body}\n${negative}`.trim())
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

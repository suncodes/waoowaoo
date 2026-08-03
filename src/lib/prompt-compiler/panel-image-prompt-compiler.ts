import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  createCreativeQualityHash,
  type GenerationSnapshot,
} from '@/lib/creative-quality/contracts'
import {
  bindingPlanPromptGuidance,
  type PanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'
import type { PanelGenerationRoute } from '@/lib/visual-production/panel-generation-router'
import {
  buildPanelVisualContract,
  type PanelVisualContract,
} from './panel-visual-contract'

export interface PanelPromptAssetRef {
  id: string | null
  kind: 'character' | 'location' | 'prop'
  name: string
  role:
    | 'primary'
    | 'supporting'
    | 'environment'
    | 'prop'
    | 'primary_identity'
    | 'supporting_identity'
    | 'prop_detail'
    | 'cover_motif'
    | 'comparison_prop'
    | 'style_only'
}

export interface PanelImagePromptSpec {
  schemaVersion: typeof CREATIVE_QUALITY_SCHEMA_VERSION
  panelId: string
  visualType: string
  renderMode: string
  aspectRatio: string
  narrativeIntent: string
  shotFunction: string
  primarySubject: string
  assetRefs: PanelPromptAssetRef[]
  actionState: string
  environment: string
  spatialLayout: string
  composition: {
    shotType: string
    cameraAngle: string
    foreground: string
    midground: string
    background: string
  }
  lightingAndColor: string
  styleAndTexture: string
  qualityTerms: string[]
  referenceInstructions: string[]
  bindingPlan: unknown
  generationRoute: PanelGenerationRoute
  noReferenceReason: string | null
  referencePlan: unknown
  visualContract: PanelVisualContract
  textPolicy: 'no_text' | 'safe_area_only'
  negativeConstraints: string[]
  promptBlueprint: {
    subject: string[]
    environment: string[]
    action: string[]
    camera: string[]
    lighting: string[]
    style: string[]
    negative: string[]
  }
  continuity: {
    fromPrevious: string
    toNext: string
    screenDirection: string
    lightingContinuity: string
  }
  singleImageFeasibility: {
    status: string
    reason: string
    riskFlags: string[]
  }
}

interface CharacterContext {
  id?: string | null
  name: string
  appearance?: string | null
  description?: string | null
  slot?: string | null
}

interface LocationContext {
  id?: string | null
  name: string
  description?: string | null
  available_slots?: string[]
}

interface PropContext {
  id?: string | null
  name: string
  description?: string | null
}

export interface PanelImagePromptCompilerContext {
  panel: {
    panel_id: string
    shot_type: string
    camera_move: string
    description: string
    image_prompt: string
    location: string
    characters: Array<{ name: string; appearance?: string; slot?: string }>
    props: string[]
    source_text: string
    photography_rules?: unknown
    acting_notes?: unknown
    visual_type: string
    render_mode: string
    on_screen_text_for_downstream_composition: string
    visual_bindings?: unknown
    visual_binding_plan?: unknown
  }
  context: {
    character_appearances: CharacterContext[]
    location_reference: LocationContext | null
    prop_references?: PropContext[]
    visual_references?: unknown[]
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readNestedString(source: unknown, keys: string[]): string {
  let current: unknown = source
  for (const key of keys) {
    const record = asRecord(current)
    current = record[key]
  }
  return typeof current === 'string' && current.trim() ? current.trim() : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function readShotSpec(context: PanelImagePromptCompilerContext): Record<string, unknown> {
  const photographyRules = asRecord(context.panel.photography_rules)
  return asRecord(photographyRules.shotSpec)
}

function readBindingPlan(context: PanelImagePromptCompilerContext): PanelAssetBindingPlan | null {
  const value = context.panel.visual_binding_plan
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<PanelAssetBindingPlan>
  return record.schemaVersion === 1 && Array.isArray(record.bindings)
    ? record as PanelAssetBindingPlan
    : null
}

function resolvePrimarySubject(context: PanelImagePromptCompilerContext): string {
  const bindingPlan = readBindingPlan(context)
  if (bindingPlan?.primarySubject) return bindingPlan.primarySubject
  const shotSpecSubject = readNestedString(readShotSpec(context), ['primarySubject'])
  if (shotSpecSubject) return shotSpecSubject
  const characters = context.context.character_appearances.filter((item) => item.name.trim())
  if (characters.length > 0) return characters[0].name
  const prop = context.context.prop_references?.find((item) => item.name.trim())
  if (prop) return prop.name
  if (context.context.location_reference?.name) return context.context.location_reference.name
  return firstNonEmpty(context.panel.image_prompt, context.panel.description, context.panel.source_text, '当前镜头主体')
}

function assetNameMatchesPrimary(assetName: string, primarySubject: string): boolean {
  const asset = assetName.toLowerCase().trim()
  const primary = primarySubject.toLowerCase().trim()
  if (!asset || !primary) return false
  if (primary.includes(asset)) return true
  return asset
    .split(/[\/|,，、：《》"“”'’‘\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .some((item) => primary.includes(item))
}

function buildAssetRefs(context: PanelImagePromptCompilerContext, primarySubject: string): PanelPromptAssetRef[] {
  const bindingPlan = readBindingPlan(context)
  if (bindingPlan) {
    return bindingPlan.bindings.map((binding) => ({
      id: binding.id,
      kind: binding.kind,
      name: binding.name,
      role: binding.role,
    }))
  }

  const refs: PanelPromptAssetRef[] = []
  let hasPrimary = false
  for (const [index, character] of context.context.character_appearances.entries()) {
    if (!character.name.trim()) continue
    const role = assetNameMatchesPrimary(character.name, primarySubject)
      ? 'primary'
      : index === 0 && refs.length === 0 ? 'supporting' : 'supporting'
    if (role === 'primary') hasPrimary = true
    refs.push({
      id: character.id || null,
      kind: 'character',
      name: character.name,
      role,
    })
  }
  if (context.context.location_reference?.name) {
    const role = !hasPrimary && assetNameMatchesPrimary(context.context.location_reference.name, primarySubject)
      ? 'primary'
      : 'environment'
    if (role === 'primary') hasPrimary = true
    refs.push({
      id: context.context.location_reference.id || null,
      kind: 'location',
      name: context.context.location_reference.name,
      role,
    })
  }
  for (const prop of context.context.prop_references || []) {
    if (!prop.name.trim()) continue
    const role = !hasPrimary && assetNameMatchesPrimary(prop.name, primarySubject)
      ? 'primary'
      : 'prop'
    if (role === 'primary') hasPrimary = true
    refs.push({
      id: prop.id || null,
      kind: 'prop',
      name: prop.name,
      role,
    })
  }
  if (!hasPrimary && refs[0]) {
    refs[0] = { ...refs[0], role: refs[0].kind === 'location' ? 'environment' : 'primary' }
  }
  return refs
}

function resolveSpatialLayout(context: PanelImagePromptCompilerContext): string {
  const slots = [
    ...context.context.character_appearances.flatMap((item) => item.slot ? [`${item.name}: ${item.slot}`] : []),
    ...(context.context.location_reference?.available_slots || []).slice(0, 4),
  ]
  return slots.length > 0
    ? slots.join('；')
    : '按当前镜头描述建立清晰前后左右关系，主体与环境位置必须可读'
}

function resolveLightingAndColor(context: PanelImagePromptCompilerContext): string {
  const photographyRules = context.panel.photography_rules
  const shotSpec = readShotSpec(context)
  return firstNonEmpty(
    readNestedString(shotSpec, ['sceneLightingBaseline']),
    readNestedString(shotSpec, ['colorGrade']),
    readNestedString(photographyRules, ['lighting', 'direction']),
    readNestedString(photographyRules, ['color_tone']),
    '遵循项目制作圣经和艺术风格的统一光色；光源方向清楚，暗部保留层次，主体轮廓可读',
  )
}

function resolveCameraAngle(context: PanelImagePromptCompilerContext): string {
  const shotSpec = readShotSpec(context)
  return firstNonEmpty(
    readNestedString(shotSpec, ['camera']),
    readNestedString(context.panel.photography_rules, ['camera', 'angle']),
    context.panel.camera_move,
    '自然电影机视角',
  )
}

function resolveActionState(context: PanelImagePromptCompilerContext): string {
  const shotSpec = readShotSpec(context)
  const actionBeats = stringArray(shotSpec.actionBeats)
  return firstNonEmpty(
    actionBeats[0],
    readNestedString(shotSpec, ['startState']),
    context.panel.description,
    context.panel.image_prompt,
    '主体处于当前分镜描述的关键瞬间',
  )
}

function resolveContinuity(context: PanelImagePromptCompilerContext): PanelImagePromptSpec['continuity'] {
  const shotSpec = readShotSpec(context)
  return {
    fromPrevious: firstNonEmpty(
      readNestedString(shotSpec, ['continuity', 'fromPrevious']),
      readNestedString(shotSpec, ['spatialContinuity']),
      '承接上一镜已建立的空间、主体位置和情绪',
    ),
    toNext: firstNonEmpty(
      readNestedString(shotSpec, ['continuity', 'toNext']),
      '为下一镜保留清晰动作或信息方向',
    ),
    screenDirection: firstNonEmpty(
      readNestedString(shotSpec, ['continuity', 'screenDirection']),
      readNestedString(shotSpec, ['spatialContinuity']),
      '保持既定视线和运动方向',
    ),
    lightingContinuity: firstNonEmpty(
      readNestedString(shotSpec, ['continuity', 'lightingContinuity']),
      readNestedString(shotSpec, ['sceneLightingBaseline']),
      '遵循项目制作圣经的光色连续性',
    ),
  }
}

function resolveSingleImageFeasibility(
  context: PanelImagePromptCompilerContext,
): PanelImagePromptSpec['singleImageFeasibility'] {
  const shotSpec = readShotSpec(context)
  const feasibility = asRecord(shotSpec.singleImageFeasibility)
  return {
    status: firstNonEmpty(readNestedString(feasibility, ['status']), 'feasible'),
    reason: firstNonEmpty(
      readNestedString(feasibility, ['reason']),
      '单一时空、单一构图和单一主要视觉事件',
    ),
    riskFlags: stringArray(feasibility.riskFlags),
  }
}

function resolvePromptBlueprint(
  context: PanelImagePromptCompilerContext,
  primarySubject: string,
  styleText: string,
): PanelImagePromptSpec['promptBlueprint'] {
  const shotSpec = readShotSpec(context)
  const raw = asRecord(shotSpec.promptBlueprint)
  const subject = stringArray(raw.subject)
  const environment = stringArray(raw.environment)
  const action = stringArray(raw.action)
  const camera = stringArray(raw.camera)
  const lighting = stringArray(raw.lighting)
  const style = stringArray(raw.style)
  const negative = stringArray(raw.negative)
  const fallbackArray = (values: string[], fallback: string): string[] =>
    values.length > 0 ? values : (fallback ? [fallback] : [])
  const bindingPlan = readBindingPlan(context)
  const referenceGuidance = bindingPlan ? bindingPlanPromptGuidance(bindingPlan) : []
  return {
    subject: Array.from(new Set([
      ...fallbackArray(subject, primarySubject),
      ...referenceGuidance.filter((item) => item.includes('primary identity') || item.includes('prop detail') || item.includes('cover motif')),
    ])),
    environment: fallbackArray(environment, firstNonEmpty(context.context.location_reference?.description, context.context.location_reference?.name, context.panel.location)),
    action: fallbackArray(action, resolveActionState(context)),
    camera: fallbackArray(camera, resolveCameraAngle(context)),
    lighting: fallbackArray(lighting, resolveLightingAndColor(context)),
    style: fallbackArray(style, styleText),
    negative: negative.length > 0
      ? negative
      : [
          '无文字',
          '无水印',
          '无标志',
          '无多格拼图',
          '无未指定角色',
        ],
  }
}

function isCleanPlatePanel(params: {
  context: PanelImagePromptCompilerContext
  bindingPlan: PanelAssetBindingPlan | null
  generationRoute: PanelGenerationRoute
}): boolean {
  const requirementPlan = params.bindingPlan?.requirementPlan
  return params.generationRoute === 'composite'
    || params.context.panel.render_mode === 'text_card'
    || params.context.panel.visual_type === 'book_cover'
    || params.context.panel.visual_type === 'quote_card'
    || params.context.panel.visual_type === 'kinetic_text'
    || requirementPlan?.visualIntent === 'book_clean_plate'
    || requirementPlan?.visualIntent === 'text_card'
    || requirementPlan?.referencePolicy === 'clean_plate'
}

function applyCleanPlateBlueprint(
  blueprint: PanelImagePromptSpec['promptBlueprint'],
  cleanPlate: boolean,
): PanelImagePromptSpec['promptBlueprint'] {
  if (!cleanPlate) return blueprint
  return {
    subject: Array.from(new Set([
      ...blueprint.subject,
      '无字干净底图或空白封面表面，只保留可被后期叠加文字的视觉空间',
    ])),
    environment: blueprint.environment,
    action: Array.from(new Set([
      '静态、稳定、单一画面，不表现文字内容本身',
      ...blueprint.action,
    ])),
    camera: blueprint.camera,
    lighting: blueprint.lighting,
    style: blueprint.style,
    negative: Array.from(new Set([
      ...blueprint.negative,
      '无书名',
      '无作者名',
      '无可读文字',
      '无伪文字',
      '无字母',
      '无数字',
      '无徽标',
    ])),
  }
}

type RenderBriefLocale = 'zh' | 'en'

function uniquePromptTerms(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.flatMap((value) => (
    typeof value === 'string' && value.trim() ? [value.trim()] : []
  ))))
}

function joinPromptTerms(
  values: Array<string | null | undefined>,
  locale: RenderBriefLocale = 'zh',
): string {
  return uniquePromptTerms(values).join(locale === 'en' ? '; ' : '；')
}

function renderAssetReference(asset: PanelPromptAssetRef, locale: RenderBriefLocale): string {
  const name = asset.name.trim()
  if (!name) return ''

  if (locale === 'en') {
    if (asset.role === 'primary' || asset.role === 'primary_identity') {
      return `${name}: primary identity lock; preserve the reference silhouette, key colors, material, and clothing.`
    }
    if (asset.role === 'supporting' || asset.role === 'supporting_identity') {
      return `${name}: supporting identity; preserve the reference appearance without competing with the main subject.`
    }
    if (asset.role === 'environment') {
      return `${name}: environment reference; use its space, lighting, material, and atmosphere without copying it as a flat backdrop.`
    }
    if (asset.role === 'prop' || asset.role === 'prop_detail') {
      return `${name}: prop lock; preserve its silhouette, proportions, material, key parts, and color accents.`
    }
    if (asset.role === 'cover_motif') {
      return `${name}: use only blank-cover geometry, material, and motif silhouette; never render readable titles, letters, or logos.`
    }
    if (asset.role === 'comparison_prop') {
      return `${name}: use only as a secondary shape and color reference.`
    }
    return `${name}: style-only reference; do not copy its subject identity.`
  }

  if (asset.role === 'primary' || asset.role === 'primary_identity') {
    return `${name}：主身份锁定，保持参考图中的轮廓、关键配色、材质和服装。`
  }
  if (asset.role === 'supporting' || asset.role === 'supporting_identity') {
    return `${name}：次要身份，保持参考外观但不得抢主视觉。`
  }
  if (asset.role === 'environment') {
    return `${name}：环境参考，只借用空间、光色、材质和氛围，不得平铺复制背景。`
  }
  if (asset.role === 'prop' || asset.role === 'prop_detail') {
    return `${name}：道具锁定，保持轮廓、比例、材质、关键部件和配色。`
  }
  if (asset.role === 'cover_motif') {
    return `${name}：仅使用无字封面形体、材质和核心图案轮廓，不得生成题字、字母或徽标。`
  }
  if (asset.role === 'comparison_prop') {
    return `${name}：仅作为次要形体和配色参考。`
  }
  return `${name}：仅作为风格参考，不得复制其主体身份。`
}

function renderSpecialHandling(spec: PanelImagePromptSpec, locale: RenderBriefLocale): string {
  const instructions: string[] = []
  const needsCleanPlate = spec.textPolicy === 'safe_area_only'
    || spec.renderMode === 'text_card'
    || spec.renderMode === 'composite'
  if (needsCleanPlate) {
    instructions.push(locale === 'en'
      ? 'Create a text-free clean plate or single foreground element and reserve negative space for downstream typography.'
      : '生成无文字的干净底图或单个前景素材，并为后期文字保留留白。')
  }
  if (spec.generationRoute === 'split' || spec.singleImageFeasibility.status !== 'feasible') {
    instructions.push(locale === 'en'
      ? `Render only one feasible key moment: ${spec.singleImageFeasibility.reason}.`
      : `只表现一个可执行的关键瞬间：${spec.singleImageFeasibility.reason}。`)
  }
  return joinPromptTerms(instructions, locale)
}

export function compilePanelImageRenderBrief(
  spec: PanelImagePromptSpec,
  locale: RenderBriefLocale = 'zh',
): string {
  const visualContract = spec.visualContract
  const blueprint = spec.promptBlueprint
  const anchors = new Set(uniquePromptTerms([
    spec.narrativeIntent,
    visualContract.primarySubject,
    visualContract.actionState,
    spec.environment,
    spec.composition.shotType,
    spec.composition.cameraAngle,
    spec.spatialLayout,
    spec.lightingAndColor,
    spec.styleAndTexture,
  ]))
  const visualDetails = uniquePromptTerms([
    ...blueprint.subject,
    ...blueprint.environment,
    ...blueprint.action,
    ...blueprint.camera,
    ...blueprint.lighting,
  ]).filter((value) => !anchors.has(value))
  const composition = visualContract.composition || joinPromptTerms([
    spec.composition.shotType,
    spec.composition.cameraAngle,
    spec.spatialLayout,
    spec.composition.foreground,
    spec.composition.midground,
    spec.composition.background,
  ], locale)
  const references = uniquePromptTerms(spec.assetRefs.map((asset) => renderAssetReference(asset, locale)))
  const continuity = joinPromptTerms(visualContract.continuity.length > 0
    ? visualContract.continuity
    : [
      spec.continuity.fromPrevious,
      spec.continuity.toNext,
      spec.continuity.screenDirection,
      spec.continuity.lightingContinuity,
    ], locale)
  const style = joinPromptTerms([spec.styleAndTexture, ...blueprint.style], locale)
  const negativeConstraints = joinPromptTerms([
    ...visualContract.negativeConstraints,
    ...blueprint.negative,
  ], locale)
  const specialHandling = renderSpecialHandling(spec, locale)
  const visualDetailText = visualDetails.join(locale === 'en' ? '; ' : '；')

  if (locale === 'en') {
    return [
      `Shot goal: ${spec.narrativeIntent}.`,
      `Main subject and action: ${joinPromptTerms([visualContract.primarySubject, visualContract.actionState], locale)}.`,
      `Environment: ${spec.environment}.`,
      `Composition: ${composition}.`,
      `Lighting and color: ${spec.lightingAndColor}.`,
      references.length ? `Reference locks: ${references.join(' ')}` : '',
      visualDetails.length ? `Visual details: ${visualDetailText}.` : '',
      continuity ? `Continuity: ${continuity}.` : '',
      specialHandling ? `Special handling: ${specialHandling}` : '',
      `Style: ${style}.`,
      `Negative constraints: ${negativeConstraints}.`,
    ].filter(Boolean).join('\n')
  }

  return [
    `镜头目的：${spec.narrativeIntent}。`,
    `主体与关键动作：${joinPromptTerms([visualContract.primarySubject, visualContract.actionState], locale)}。`,
    `场景：${spec.environment}。`,
    `构图：${composition}。`,
    `光色：${spec.lightingAndColor}。`,
    references.length ? `参考资产锁定：${references.join('')}` : '',
    visualDetails.length ? `画面细节：${visualDetailText}。` : '',
    continuity ? `连续性：${continuity}。` : '',
    specialHandling ? `特殊处理：${specialHandling}` : '',
    `风格：${style}。`,
    `禁止项：${negativeConstraints}。`,
  ].filter(Boolean).join('\n')
}

export function buildPanelImagePromptSpec(params: {
  context: PanelImagePromptCompilerContext
  aspectRatio: string
  styleText: string
  generationRoute?: PanelGenerationRoute
  noReferenceReason?: string | null
  referencePlan?: unknown
}): PanelImagePromptSpec {
  const primarySubject = resolvePrimarySubject(params.context)
  const generationRoute = params.generationRoute || 'generate'
  const shotSpec = readShotSpec(params.context)
  const narrativeIntent = firstNonEmpty(
    readNestedString(shotSpec, ['narrativeIntent']),
    params.context.panel.image_prompt,
    params.context.panel.description,
    params.context.panel.source_text,
  )
  const location = params.context.context.location_reference
  const propNames = (params.context.context.prop_references || []).map((item) => item.name).filter(Boolean)
  const bindingPlan = readBindingPlan(params.context)
  const cleanPlate = isCleanPlatePanel({
    context: params.context,
    bindingPlan,
    generationRoute,
  })
  const promptBlueprint = applyCleanPlateBlueprint(
    resolvePromptBlueprint(params.context, primarySubject, params.styleText),
    cleanPlate,
  )
  const referenceInstructions = bindingPlan ? bindingPlanPromptGuidance(bindingPlan) : []
  const assetRefs = buildAssetRefs(params.context, primarySubject)
  const actionState = resolveActionState(params.context)
  const environment = firstNonEmpty(
    location?.description,
    location?.name,
    params.context.panel.location,
    '与镜头内容一致的具体物理空间',
  )
  const spatialLayout = resolveSpatialLayout(params.context)
  const composition = {
    shotType: firstNonEmpty(params.context.panel.shot_type, '中景'),
    cameraAngle: resolveCameraAngle(params.context),
    foreground: '必要时使用轻量前景建立临场感，但不得遮挡主体',
    midground: `${primarySubject} 承担画面主视觉焦点${propNames.length ? `，关键道具：${propNames.join('、')}` : ''}`,
    background: firstNonEmpty(location?.name, params.context.panel.location, '背景服务于主体和叙事，不添加无关角色或标志物'),
  }
  const lightingAndColor = resolveLightingAndColor(params.context)
  const textPolicy = params.context.panel.on_screen_text_for_downstream_composition ? 'safe_area_only' : 'no_text'
  const negativeConstraints = Array.from(new Set([
    '无文字',
    '无水印',
    '无标志',
    '无多格拼图',
    '无混剪画面',
    '无未指定角色',
    '无风格关联 IP 角色',
    ...(cleanPlate ? ['无可读文字', '无书名', '无作者名', '无标题', '无字幕', '无伪文字', '无字母', '无数字', '无素材墙'] : []),
    ...promptBlueprint.negative,
  ]))
  const continuity = resolveContinuity(params.context)
  const visualContract = buildPanelVisualContract({
    primarySubject,
    assetLocks: assetRefs.map((item) => item.name),
    actionState,
    composition: [composition.shotType, composition.cameraAngle, spatialLayout],
    settingAndLight: [environment, lightingAndColor],
    continuity: [
      continuity.fromPrevious,
      continuity.toNext,
      continuity.screenDirection,
      continuity.lightingContinuity,
    ],
    textPolicy,
    negativeConstraints,
  })
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    panelId: params.context.panel.panel_id,
    visualType: params.context.panel.visual_type || 'illustration',
    renderMode: params.context.panel.render_mode || 'generated_image',
    aspectRatio: params.aspectRatio,
    narrativeIntent,
    shotFunction: firstNonEmpty(readNestedString(shotSpec, ['shotFunction']), 'setup'),
    primarySubject,
    assetRefs,
    actionState,
    environment,
    spatialLayout,
    composition,
    lightingAndColor,
    styleAndTexture: params.styleText,
    qualityTerms: [
      '主体清晰',
      '构图稳定',
      '空间层次明确',
      '参考资产身份一致',
      '画面比例正确',
      ...(cleanPlate ? ['无字干净底图，书名/字幕/标题由后期合成，不在图像内生成'] : []),
      ...(generationRoute === 'composite' ? ['生成无字干净底图或单一前景素材，准确文字留给后期合成'] : []),
      ...(generationRoute === 'split' ? ['只生成当前镜头最关键的一个瞬间，不生成多格、多阶段或混剪'] : []),
      ...(bindingPlan?.complexity.level === 'high' ? ['复杂镜头只生成一个关键瞬间，不要塞入多个动作阶段'] : []),
    ],
    referenceInstructions,
    bindingPlan: bindingPlan || params.context.panel.visual_bindings || null,
    generationRoute,
    noReferenceReason: params.noReferenceReason || null,
    referencePlan: params.referencePlan || params.context.context.visual_references || null,
    visualContract,
    textPolicy,
    negativeConstraints,
    promptBlueprint,
    continuity,
    singleImageFeasibility: resolveSingleImageFeasibility(params.context),
  }
}

export function buildPanelImageGenerationSnapshot(params: {
  targetId: string
  modelKey: string
  promptTemplateId: string
  referenceImages: string[]
  structuredReferences?: unknown
  bindingPlan?: unknown
  promptSpec: PanelImagePromptSpec
  compiledPrompt: string
  assetVersionHash?: string | null
}): GenerationSnapshot {
  const specHash = createCreativeQualityHash(params.promptSpec)
  const promptHash = createCreativeQualityHash(params.compiledPrompt)
  const inputHash = createCreativeQualityHash({
    promptTemplateId: params.promptTemplateId,
    promptSpecHash: specHash,
    referenceImages: params.referenceImages,
    structuredReferences: params.structuredReferences || null,
    bindingPlan: params.bindingPlan || null,
    assetVersionHash: params.assetVersionHash || null,
  })
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    snapshotType: 'panel_image_prompt',
    targetType: 'NovelPromotionPanel',
    targetId: params.targetId,
    modelKey: params.modelKey,
    promptTemplateId: params.promptTemplateId,
    promptHash,
    specHash,
    inputHash,
    assetVersionHash: params.assetVersionHash || null,
    referenceImages: params.referenceImages,
    ...(params.structuredReferences !== undefined ? { structuredReferences: params.structuredReferences } : {}),
    ...(params.bindingPlan !== undefined ? { bindingPlan: params.bindingPlan } : {}),
    promptSpec: params.promptSpec,
    compiledPrompt: params.compiledPrompt,
    createdAt: new Date().toISOString(),
  }
}

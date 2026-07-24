import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  createCreativeQualityHash,
  type GenerationSnapshot,
} from '@/lib/creative-quality/contracts'
import {
  bindingPlanPromptGuidance,
  type PanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'

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

export function buildPanelImagePromptSpec(params: {
  context: PanelImagePromptCompilerContext
  aspectRatio: string
  styleText: string
}): PanelImagePromptSpec {
  const primarySubject = resolvePrimarySubject(params.context)
  const shotSpec = readShotSpec(params.context)
  const narrativeIntent = firstNonEmpty(
    readNestedString(shotSpec, ['narrativeIntent']),
    params.context.panel.image_prompt,
    params.context.panel.description,
    params.context.panel.source_text,
  )
  const location = params.context.context.location_reference
  const propNames = (params.context.context.prop_references || []).map((item) => item.name).filter(Boolean)
  const promptBlueprint = resolvePromptBlueprint(params.context, primarySubject, params.styleText)
  const bindingPlan = readBindingPlan(params.context)
  const referenceInstructions = bindingPlan ? bindingPlanPromptGuidance(bindingPlan) : []
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    panelId: params.context.panel.panel_id,
    visualType: params.context.panel.visual_type || 'illustration',
    renderMode: params.context.panel.render_mode || 'generated_image',
    aspectRatio: params.aspectRatio,
    narrativeIntent,
    shotFunction: firstNonEmpty(readNestedString(shotSpec, ['shotFunction']), 'setup'),
    primarySubject,
    assetRefs: buildAssetRefs(params.context, primarySubject),
    actionState: resolveActionState(params.context),
    environment: firstNonEmpty(
      location?.description,
      location?.name,
      params.context.panel.location,
      '与镜头内容一致的具体物理空间',
    ),
    spatialLayout: resolveSpatialLayout(params.context),
    composition: {
      shotType: firstNonEmpty(params.context.panel.shot_type, '中景'),
      cameraAngle: resolveCameraAngle(params.context),
      foreground: '必要时使用轻量前景建立临场感，但不得遮挡主体',
      midground: `${primarySubject} 承担画面主视觉焦点${propNames.length ? `，关键道具：${propNames.join('、')}` : ''}`,
      background: firstNonEmpty(location?.name, params.context.panel.location, '背景服务于主体和叙事，不添加无关角色或标志物'),
    },
    lightingAndColor: resolveLightingAndColor(params.context),
    styleAndTexture: params.styleText,
    qualityTerms: [
      '主体清晰',
      '构图稳定',
      '空间层次明确',
      '参考资产身份一致',
      '画面比例正确',
      ...(bindingPlan?.complexity.level === 'high' ? ['复杂镜头只生成一个关键瞬间，不要塞入多个动作阶段'] : []),
    ],
    referenceInstructions,
    bindingPlan: bindingPlan || params.context.panel.visual_bindings || null,
    textPolicy: params.context.panel.on_screen_text_for_downstream_composition ? 'safe_area_only' : 'no_text',
    negativeConstraints: Array.from(new Set([
      '无文字',
      '无水印',
      '无标志',
      '无多格拼图',
      '无混剪画面',
      '无未指定角色',
      '无风格关联 IP 角色',
      ...promptBlueprint.negative,
    ])),
    promptBlueprint,
    continuity: resolveContinuity(params.context),
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

import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  createCreativeQualityHash,
  type GenerationSnapshot,
} from '@/lib/creative-quality/contracts'

export interface PanelPromptAssetRef {
  id: string | null
  kind: 'character' | 'location' | 'prop'
  name: string
  role: 'primary' | 'supporting' | 'environment' | 'prop'
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
  textPolicy: 'no_text' | 'safe_area_only'
  negativeConstraints: string[]
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
  }
  context: {
    character_appearances: CharacterContext[]
    location_reference: LocationContext | null
    prop_references?: PropContext[]
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

function resolvePrimarySubject(context: PanelImagePromptCompilerContext): string {
  const shotSpecSubject = readNestedString(readShotSpec(context), ['primarySubject'])
  if (shotSpecSubject) return shotSpecSubject
  const characters = context.context.character_appearances.filter((item) => item.name.trim())
  if (characters.length > 0) return characters[0].name
  const prop = context.context.prop_references?.find((item) => item.name.trim())
  if (prop) return prop.name
  if (context.context.location_reference?.name) return context.context.location_reference.name
  return firstNonEmpty(context.panel.image_prompt, context.panel.description, context.panel.source_text, '当前镜头主体')
}

function buildAssetRefs(context: PanelImagePromptCompilerContext): PanelPromptAssetRef[] {
  const refs: PanelPromptAssetRef[] = []
  for (const [index, character] of context.context.character_appearances.entries()) {
    if (!character.name.trim()) continue
    refs.push({
      id: character.id || null,
      kind: 'character',
      name: character.name,
      role: index === 0 ? 'primary' : 'supporting',
    })
  }
  if (context.context.location_reference?.name) {
    refs.push({
      id: context.context.location_reference.id || null,
      kind: 'location',
      name: context.context.location_reference.name,
      role: 'environment',
    })
  }
  for (const prop of context.context.prop_references || []) {
    if (!prop.name.trim()) continue
    refs.push({
      id: prop.id || null,
      kind: 'prop',
      name: prop.name,
      role: 'prop',
    })
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
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    panelId: params.context.panel.panel_id,
    visualType: params.context.panel.visual_type || 'illustration',
    renderMode: params.context.panel.render_mode || 'generated_image',
    aspectRatio: params.aspectRatio,
    narrativeIntent,
    shotFunction: firstNonEmpty(readNestedString(shotSpec, ['shotFunction']), 'setup'),
    primarySubject,
    assetRefs: buildAssetRefs(params.context),
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
    ],
    textPolicy: params.context.panel.on_screen_text_for_downstream_composition ? 'safe_area_only' : 'no_text',
    negativeConstraints: [
      '无文字',
      '无水印',
      '无标志',
      '无多格拼图',
      '无混剪画面',
      '无未指定角色',
      '无风格关联 IP 角色',
    ],
    continuity: resolveContinuity(params.context),
    singleImageFeasibility: resolveSingleImageFeasibility(params.context),
  }
}

export function buildPanelImageGenerationSnapshot(params: {
  targetId: string
  modelKey: string
  promptTemplateId: string
  referenceImages: string[]
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
    promptSpec: params.promptSpec,
    compiledPrompt: params.compiledPrompt,
    createdAt: new Date().toISOString(),
  }
}

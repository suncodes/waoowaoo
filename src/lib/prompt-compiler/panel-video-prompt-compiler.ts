import {
  CREATIVE_QUALITY_SCHEMA_VERSION,
  createCreativeQualityHash,
  type GenerationSnapshot,
} from '@/lib/creative-quality/contracts'

type Locale = 'zh' | 'en'

export interface PanelVideoPromptSpec {
  schemaVersion: typeof CREATIVE_QUALITY_SCHEMA_VERSION
  panelId: string
  generationMode: 'normal' | 'firstlastframe'
  narrativeIntent: string
  sourceFramePolicy: string
  primarySubject: string
  startState: string
  primaryMotion: string
  secondaryMotion: string[]
  cameraMotion: string
  focusChange: string
  environmentMotion: string
  endState: string
  continuityConstraints: string[]
  durationSec: number | null
  negativeConstraints: string[]
}

export interface PanelVideoPromptCompilerContext {
  panel: {
    panelId: string
    description?: string | null
    videoPrompt?: string | null
    imagePrompt?: string | null
    cameraMove?: string | null
    duration?: number | null
    photographyRules?: unknown
  }
  generationMode: 'normal' | 'firstlastframe'
  customPrompt?: string | null
  lastFrameProvided?: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function readShotSpec(context: PanelVideoPromptCompilerContext): Record<string, unknown> {
  const rules = asRecord(context.panel.photographyRules)
  return asRecord(rules.shotSpec)
}

function readContinuity(shotSpec: Record<string, unknown>): Record<string, unknown> {
  return asRecord(shotSpec.continuity)
}

function readPromptBlueprint(shotSpec: Record<string, unknown>): Record<string, unknown> {
  return asRecord(shotSpec.promptBlueprint)
}

function boundedDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.round(value > 1000 ? value / 1000 : value)
}

function buildNegativeConstraints(locale: Locale): string[] {
  return locale === 'en'
    ? [
        'do not change character identity',
        'do not alter locked asset appearance',
        'no new characters',
        'no text, subtitles, logos or watermarks',
        'no jump cuts',
        'no montage or split screen',
        'no excessive camera shake',
      ]
    : [
        '不要改变角色身份',
        '不要改变已锁定资产外观',
        '不要新增角色',
        '不要生成文字、字幕、徽标或水印',
        '不要跳剪',
        '不要混剪或分屏',
        '不要过度镜头抖动',
      ]
}

function sourceFramePolicy(mode: PanelVideoPromptSpec['generationMode'], hasLastFrame: boolean, locale: Locale): string {
  if (locale === 'en') {
    if (mode === 'firstlastframe') {
      return hasLastFrame
        ? 'The first and last frames are locked references; animate only the transition between them.'
        : 'The first frame is locked; preserve the source image identity while creating a controlled transition.'
    }
    return 'The source image is the locked first frame; do not restate or redesign static appearance.'
  }
  if (mode === 'firstlastframe') {
    return hasLastFrame
      ? '首帧和尾帧都是锁定参考，只生成两者之间的自然过渡。'
      : '首帧是锁定参考，保持源图身份，只生成受控过渡。'
  }
  return '源图是锁定首帧，不重新设计静态外观，只描述首帧之后的运动。'
}

export function buildPanelVideoPromptSpec(params: {
  context: PanelVideoPromptCompilerContext
  locale?: Locale
}): PanelVideoPromptSpec {
  const locale = params.locale || 'zh'
  const shotSpec = readShotSpec(params.context)
  const continuity = readContinuity(shotSpec)
  const promptBlueprint = readPromptBlueprint(shotSpec)
  const actionBeats = stringArray(shotSpec.actionBeats)
  const blueprintActions = stringArray(promptBlueprint.action)
  const blueprintCamera = stringArray(promptBlueprint.camera)
  const blueprintNegative = stringArray(promptBlueprint.negative)
  const customPrompt = readString(params.context.customPrompt)
  const rawVideoPrompt = readString(params.context.panel.videoPrompt)
  const description = readString(params.context.panel.description)
  const narrativeIntent = firstNonEmpty(
    readString(shotSpec.narrativeIntent),
    rawVideoPrompt,
    description,
    readString(params.context.panel.imagePrompt),
  )
  const primaryMotion = firstNonEmpty(
    customPrompt,
    actionBeats[0],
    blueprintActions[0],
    rawVideoPrompt,
    description,
    locale === 'en' ? 'subtle controlled motion matching the storyboard intent' : '符合分镜意图的轻微受控运动',
  )
  return {
    schemaVersion: CREATIVE_QUALITY_SCHEMA_VERSION,
    panelId: params.context.panel.panelId,
    generationMode: params.context.generationMode,
    narrativeIntent,
    sourceFramePolicy: sourceFramePolicy(params.context.generationMode, params.context.lastFrameProvided === true, locale),
    primarySubject: firstNonEmpty(readString(shotSpec.primarySubject), description, locale === 'en' ? 'the locked source-frame subject' : '首帧中的锁定主体'),
    startState: firstNonEmpty(readString(shotSpec.startState), locale === 'en' ? 'start from the exact source frame' : '从源图首帧状态开始'),
    primaryMotion,
    secondaryMotion: actionBeats.slice(1, 3),
    cameraMotion: firstNonEmpty(readString(shotSpec.camera), blueprintCamera[0], readString(params.context.panel.cameraMove), locale === 'en' ? 'locked or gently moving camera' : '锁定机位或轻微镜头运动'),
    focusChange: locale === 'en' ? 'keep focus on the primary subject unless the prompt explicitly asks otherwise' : '焦点保持在主视觉主体上，除非提示词明确要求转移',
    environmentMotion: locale === 'en' ? 'only subtle environmental motion that supports the main action' : '只加入服务主体动作的轻微环境运动',
    endState: firstNonEmpty(readString(shotSpec.endState), locale === 'en' ? 'end in a stable readable pose' : '结束在稳定可读的姿态或画面状态'),
    continuityConstraints: [
      firstNonEmpty(readString(continuity.fromPrevious), locale === 'en' ? 'preserve established spatial continuity' : '保持已建立的空间连续性'),
      firstNonEmpty(readString(continuity.toNext), locale === 'en' ? 'leave a clear visual handoff for the next shot' : '为下一镜保留清晰视觉衔接'),
      firstNonEmpty(readString(continuity.screenDirection), locale === 'en' ? 'preserve screen direction' : '保持视线和运动方向'),
      firstNonEmpty(readString(continuity.lightingContinuity), locale === 'en' ? 'preserve lighting and color continuity' : '保持光色连续性'),
    ],
    durationSec: boundedDuration(params.context.panel.duration),
    negativeConstraints: Array.from(new Set([
      ...buildNegativeConstraints(locale),
      ...blueprintNegative,
    ])),
  }
}

function joinLines(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).join('\n')
}

export function compilePanelVideoPrompt(spec: PanelVideoPromptSpec, locale: Locale = 'zh'): string {
  if (locale === 'en') {
    return joinLines([
      `Image-to-video shot, ${spec.generationMode} mode.`,
      `Source frame policy: ${spec.sourceFramePolicy}`,
      `Narrative intent: ${spec.narrativeIntent}`,
      `Primary subject: ${spec.primarySubject}`,
      `Start state: ${spec.startState}`,
      `Primary motion: ${spec.primaryMotion}`,
      spec.secondaryMotion.length ? `Secondary motion: ${spec.secondaryMotion.join('; ')}` : '',
      `Camera motion: ${spec.cameraMotion}`,
      `Focus: ${spec.focusChange}`,
      `Environment motion: ${spec.environmentMotion}`,
      `End state: ${spec.endState}`,
      `Continuity: ${spec.continuityConstraints.join('; ')}`,
      spec.durationSec ? `Duration: about ${spec.durationSec} seconds.` : '',
      `Negative constraints: ${spec.negativeConstraints.join('; ')}.`,
    ])
  }
  return joinLines([
    `图生视频镜头，${spec.generationMode === 'firstlastframe' ? '首尾帧' : '普通 I2V'}模式。`,
    `首帧规则：${spec.sourceFramePolicy}`,
    `叙事目的：${spec.narrativeIntent}`,
    `主视觉主体：${spec.primarySubject}`,
    `起始状态：${spec.startState}`,
    `主体主运动：${spec.primaryMotion}`,
    spec.secondaryMotion.length ? `二级动画：${spec.secondaryMotion.join('；')}` : '',
    `摄影机运动：${spec.cameraMotion}`,
    `焦点变化：${spec.focusChange}`,
    `环境运动：${spec.environmentMotion}`,
    `结束状态：${spec.endState}`,
    `连续性约束：${spec.continuityConstraints.join('；')}`,
    spec.durationSec ? `时长：约 ${spec.durationSec} 秒。` : '',
    `禁止项：${spec.negativeConstraints.join('；')}。`,
  ])
}

export function buildPanelVideoGenerationSnapshot(params: {
  targetId: string
  modelKey: string
  promptTemplateId: string
  referenceImages: string[]
  promptSpec: PanelVideoPromptSpec
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
    snapshotType: 'panel_video_prompt',
    targetType: 'NovelPromotionPanel',
    targetId: params.targetId,
    modelKey: params.modelKey,
    promptTemplateId: params.promptTemplateId,
    promptHash,
    specHash,
    inputHash,
    assetVersionHash: params.assetVersionHash || null,
    referenceImages: Array.from(new Set(params.referenceImages.filter(Boolean))),
    promptSpec: params.promptSpec,
    compiledPrompt: params.compiledPrompt,
    createdAt: new Date().toISOString(),
  }
}

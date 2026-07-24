import type {
  RenderMode,
  ShotFunction,
  ShotPromptBlueprint,
  VisualPlanResult,
  VisualUnit,
} from './types'

const MAX_GENERATED_IMAGE_DURATION_SEC = 12
const TARGET_SPLIT_DURATION_SEC = 8

const COMPLEX_SINGLE_IMAGE_PATTERNS = [
  /混剪|拼接|多格|分屏|素材墙|蒙太奇|快速切换|多个场景|多地点|多时空|前后对比|同时展示|依次展示|逐步展示|逐渐|先.+再|从.+到/iu,
  /montage|collage|split screen|multi[-\s]?panel|rapid switching|multiple scenes|sequential|before and after|from .+ to /iu,
]

const COMPLEX_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/混剪|拼接|多格|分屏|素材墙|蒙太奇|快速切换/giu, '单一关键画面'],
  [/多个场景|多地点|多时空|前后对比|同时展示|依次展示|逐步展示/giu, '单一时空中的关键状态'],
  [/逐渐/giu, '保持'],
  [/先.+?再/giu, '聚焦'],
  [/从.+?到/giu, '聚焦'],
  [/montage|collage|split screen|multi[-\s]?panel|rapid switching|multiple scenes|sequential|before and after/giu, 'single key moment'],
  [/from .+? to /giu, 'focus on '],
]

type AutoRepairFixCode =
  | 'split_overlong_generated_image'
  | 'split_multi_action_generated_image'
  | 'split_infeasible_generated_image'
  | 'coerce_complex_generated_image'
  | 'renumber_visual_units'
  | 'normalize_shot_plan'

export interface StoryboardAutoRepairFix {
  code: AutoRepairFixCode
  sourceUnitId: string | null
  message: string
}

export interface StoryboardAutoRepairResult {
  result: VisualPlanResult
  appliedFixes: StoryboardAutoRepairFix[]
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}

function sanitizeText(value: string): string {
  let next = value.trim()
  for (const [pattern, replacement] of COMPLEX_TEXT_REPLACEMENTS) {
    next = next.replace(pattern, replacement)
  }
  return next.replace(/\s+/g, ' ').trim()
}

function hasComplexSingleImageSignal(unit: VisualUnit): boolean {
  const text = JSON.stringify({
    description: unit.description,
    imagePrompt: unit.imagePrompt,
    videoPrompt: unit.videoPrompt,
    visualType: unit.visualType,
    renderMode: unit.renderMode,
    shotType: unit.shotType,
    cameraMove: unit.cameraMove,
    primarySubject: unit.shotSpec.primarySubject,
    narrativeIntent: unit.shotSpec.narrativeIntent,
    startState: unit.shotSpec.startState,
    actionBeats: unit.shotSpec.actionBeats,
    endState: unit.shotSpec.endState,
    promptBlueprint: unit.shotSpec.promptBlueprint,
  })
  return COMPLEX_SINGLE_IMAGE_PATTERNS.some((pattern) => pattern.test(text))
}

function generatedImageNeedsSplit(unit: VisualUnit): boolean {
  if (unit.renderMode !== 'generated_image') return false
  return unit.durationSec > MAX_GENERATED_IMAGE_DURATION_SEC
    || unit.shotSpec.actionBeats.length > 2
    || unit.shotSpec.singleImageFeasibility.status === 'needs_split'
}

function generatedImageNeedsCoerce(unit: VisualUnit): boolean {
  if (unit.renderMode !== 'generated_image') return false
  const feasibility = unit.shotSpec.singleImageFeasibility.status
  return feasibility === 'text_only'
    || feasibility === 'composite_only'
    || (
      hasComplexSingleImageSignal(unit)
      && unit.durationSec <= MAX_GENERATED_IMAGE_DURATION_SEC
      && unit.shotSpec.actionBeats.length <= 1
      && feasibility !== 'needs_split'
    )
}

function splitCountForUnit(unit: VisualUnit): number {
  const durationCount = Math.max(1, Math.ceil(unit.durationSec / TARGET_SPLIT_DURATION_SEC))
  const actionCount = Math.max(1, unit.shotSpec.actionBeats.length)
  const feasibilityCount = unit.shotSpec.singleImageFeasibility.status === 'needs_split' ? 2 : 1
  const complexCount = hasComplexSingleImageSignal(unit) ? 2 : 1
  return Math.max(durationCount, actionCount, feasibilityCount, complexCount)
}

function splitDurations(totalDurationSec: number, count: number): number[] {
  const total = Math.max(totalDurationSec, count)
  const raw = total / count
  const base = Math.max(1, Math.min(MAX_GENERATED_IMAGE_DURATION_SEC, Math.round(raw * 10) / 10))
  const durations = new Array<number>(count).fill(base)
  const used = durations.slice(0, -1).reduce((sum, value) => sum + value, 0)
  durations[count - 1] = Math.max(1, Math.min(MAX_GENERATED_IMAGE_DURATION_SEC, Math.round((total - used) * 10) / 10))
  return durations
}

function focusMoment(unit: VisualUnit, index: number, count: number): string {
  const actionBeat = unit.shotSpec.actionBeats[index]
  if (actionBeat) return sanitizeText(actionBeat)
  if (index === 0 && unit.shotSpec.startState) return sanitizeText(unit.shotSpec.startState)
  if (index === count - 1 && unit.shotSpec.endState) return sanitizeText(unit.shotSpec.endState)
  return `${unit.shotSpec.primarySubject} 的单一关键状态`
}

function sanitizeBlueprint(
  blueprint: ShotPromptBlueprint | undefined,
  unit: VisualUnit,
  action: string,
): ShotPromptBlueprint {
  const source = blueprint || {
    subject: [unit.shotSpec.primarySubject],
    environment: [],
    action: [],
    camera: [unit.shotSpec.camera || unit.shotType],
    lighting: [unit.shotSpec.sceneLightingBaseline],
    style: [],
    negative: [],
  }
  return {
    subject: uniqueStrings((source.subject.length > 0 ? source.subject : [unit.shotSpec.primarySubject]).map(sanitizeText)),
    environment: uniqueStrings(source.environment.map(sanitizeText)),
    action: [action],
    camera: uniqueStrings((source.camera.length > 0 ? source.camera : [unit.shotSpec.camera || unit.shotType]).map(sanitizeText)),
    lighting: uniqueStrings((source.lighting.length > 0 ? source.lighting : [unit.shotSpec.sceneLightingBaseline]).map(sanitizeText)),
    style: uniqueStrings(source.style.map(sanitizeText)),
    negative: uniqueStrings([
      ...source.negative.map(sanitizeText),
      '文字',
      '水印',
      '标志',
      '非单帧版式',
      '并置式画面',
      '阶段并置',
      '未指定资产',
    ]),
  }
}

function imagePromptForMoment(unit: VisualUnit, action: string): string {
  return uniqueStrings([
    sanitizeText(unit.imagePrompt),
    `${unit.shotSpec.primarySubject}，${action}`,
    '单一时空，单一构图，一个主要视觉事件',
    '无文字，无水印，无标志',
  ]).join('，')
}

function videoPromptForMoment(unit: VisualUnit, action: string): string {
  return uniqueStrings([
    sanitizeText(unit.videoPrompt),
    `${unit.cameraMove || unit.shotSpec.camera}，首帧后只表现：${action}`,
    '不加入额外角色、额外场景或阶段切换',
  ]).join('；')
}

function splitGeneratedImageUnit(unit: VisualUnit): VisualUnit[] {
  const count = splitCountForUnit(unit)
  const durations = splitDurations(unit.durationSec, count)
  return durations.map((durationSec, index) => {
    const action = focusMoment(unit, index, count)
    const promptBlueprint = sanitizeBlueprint(unit.shotSpec.promptBlueprint, unit, action)
    return {
      ...unit,
      id: `${unit.id}_split_${index + 1}`,
      panelNumber: unit.panelNumber + index,
      durationSec,
      description: `${unit.shotSpec.primarySubject} 的连续镜头 ${index + 1}/${count}：${action}`,
      imagePrompt: imagePromptForMoment(unit, action),
      videoPrompt: videoPromptForMoment(unit, action),
      shotSpec: {
        ...unit.shotSpec,
        narrativeIntent: sanitizeText(unit.shotSpec.narrativeIntent),
        primarySubject: sanitizeText(unit.shotSpec.primarySubject),
        startState: index === 0
          ? sanitizeText(unit.shotSpec.startState)
          : focusMoment(unit, index - 1, count),
        actionBeats: [action],
        endState: index === count - 1
          ? sanitizeText(unit.shotSpec.endState)
          : action,
        singleImageFeasibility: {
          status: 'feasible',
          reason: '已按硬规则拆成单一时空、单一构图和单一关键动作的短镜头',
          riskFlags: [],
        },
        constraints: uniqueStrings([
          ...unit.shotSpec.constraints.map(sanitizeText),
          `generated_image 时长不超过 ${MAX_GENERATED_IMAGE_DURATION_SEC} 秒`,
          '只保留一个主动作',
          '必须保持单一画面、单一时空和单一关键瞬间',
        ]),
        durationIntent: `${durationSec}s，本地硬规则拆分后生成`,
        promptBlueprint,
      },
    }
  })
}

function coerceRenderMode(unit: VisualUnit): RenderMode {
  return unit.shotSpec.singleImageFeasibility.status === 'text_only'
    ? 'text_card'
    : 'composite'
}

function coerceGeneratedImageUnit(unit: VisualUnit): VisualUnit {
  const renderMode = coerceRenderMode(unit)
  const action = focusMoment(unit, 0, 1)
  return {
    ...unit,
    renderMode,
    visualLicense: renderMode === 'text_card' ? 'text_card' : unit.visualLicense,
    description: `${unit.shotSpec.primarySubject} 的可合成单一底图：${action}`,
    imagePrompt: uniqueStrings([
      sanitizeText(unit.imagePrompt),
      `${unit.shotSpec.primarySubject}，${action}`,
      renderMode === 'text_card' ? '无字背景、清晰留白、文字安全区' : '干净底图或单一前景素材',
      '无文字，无水印，无标志',
    ]).join('，'),
    videoPrompt: videoPromptForMoment(unit, action),
    shotSpec: {
      ...unit.shotSpec,
      actionBeats: [action],
      singleImageFeasibility: {
        status: 'feasible',
        reason: `已降级为 ${renderMode}，不再要求单张 generated_image 表达多阶段画面`,
        riskFlags: [],
      },
      constraints: uniqueStrings([
        ...unit.shotSpec.constraints.map(sanitizeText),
        '只生成可合成的单一画面元素',
        '必须保持单一画面、单一时空和单一关键瞬间',
      ]),
      promptBlueprint: sanitizeBlueprint(unit.shotSpec.promptBlueprint, unit, action),
    },
  }
}

function shotFunctionIntensity(shotFunction: ShotFunction): number {
  if (shotFunction === 'hook' || shotFunction === 'payoff' || shotFunction === 'cta') return 0.82
  if (shotFunction === 'evidence' || shotFunction === 'reaction') return 0.68
  if (shotFunction === 'breath' || shotFunction === 'transition') return 0.38
  return 0.55
}

function countShotFunctions(units: VisualUnit[]): Map<ShotFunction, number> {
  const counts = new Map<ShotFunction, number>()
  for (const unit of units) {
    counts.set(unit.shotSpec.shotFunction, (counts.get(unit.shotSpec.shotFunction) || 0) + 1)
  }
  return counts
}

function normalizeShotPlan(result: VisualPlanResult, units: VisualUnit[]): VisualPlanResult['shotPlan'] {
  const totalDuration = units.reduce((sum, unit) => sum + unit.durationSec, 0)
  const counts = countShotFunctions(units)
  return {
    ...result.shotPlan,
    totalEstimatedDurationSec: Math.round(totalDuration * 10) / 10,
    shotBudget: {
      ...result.shotPlan.shotBudget,
      totalShots: units.length,
      averageDurationSec: units.length > 0 ? Math.round((totalDuration / units.length) * 10) / 10 : 0,
      hookShots: counts.get('hook') || 0,
      setupShots: counts.get('setup') || 0,
      evidenceShots: counts.get('evidence') || 0,
      payoffShots: counts.get('payoff') || 0,
      breathShots: counts.get('breath') || 0,
    },
    rhythmCurve: units.map((unit) => ({
      label: unit.id,
      shotFunction: unit.shotSpec.shotFunction,
      intensity: shotFunctionIntensity(unit.shotSpec.shotFunction),
      intent: unit.shotSpec.narrativeIntent,
    })),
    functionMix: Array.from(counts.entries()).map(([shotFunction, count]) => ({ shotFunction, count })),
    continuityChecks: uniqueStrings([
      ...result.shotPlan.continuityChecks,
      `本地硬规则保证 generated_image 不超过 ${MAX_GENERATED_IMAGE_DURATION_SEC} 秒，且不承载混剪或多阶段同框`,
    ]),
  }
}

function renumberUnits(units: VisualUnit[]): VisualUnit[] {
  return units.map((unit, index) => ({
    ...unit,
    id: `visual_${index + 1}`,
    panelNumber: index + 1,
  }))
}

export function autoRepairVisualPlanStoryboard(result: VisualPlanResult): StoryboardAutoRepairResult {
  const fixes: StoryboardAutoRepairFix[] = []
  const repairedUnits = result.visualUnits.flatMap((unit) => {
    if (generatedImageNeedsSplit(unit)) {
      const reasons = [
        unit.durationSec > MAX_GENERATED_IMAGE_DURATION_SEC ? '镜头时长超过 generated_image 上限' : '',
        unit.shotSpec.actionBeats.length > 2 ? '动作节拍过多' : '',
        unit.shotSpec.singleImageFeasibility.status === 'needs_split' ? '单图可行性要求拆分' : '',
      ].filter(Boolean).join('，')
      fixes.push({
        code: unit.durationSec > MAX_GENERATED_IMAGE_DURATION_SEC
          ? 'split_overlong_generated_image'
          : unit.shotSpec.actionBeats.length > 2
            ? 'split_multi_action_generated_image'
            : 'split_infeasible_generated_image',
        sourceUnitId: unit.id,
        message: `${unit.id} 已拆成多个短镜头：${reasons}`,
      })
      return splitGeneratedImageUnit(unit)
    }

    if (generatedImageNeedsCoerce(unit)) {
      fixes.push({
        code: 'coerce_complex_generated_image',
        sourceUnitId: unit.id,
        message: `${unit.id} 已从 generated_image 降级为可合成镜头，避免单张图承载多阶段信息`,
      })
      return [coerceGeneratedImageUnit(unit)]
    }

    return [unit]
  })

  if (fixes.length === 0) {
    return { result, appliedFixes: [] }
  }

  const renumberedUnits = renumberUnits(repairedUnits)
  fixes.push({
    code: 'renumber_visual_units',
    sourceUnitId: null,
    message: '已重新编号 visualUnits 和 panelNumber，保持落库顺序稳定',
  })
  fixes.push({
    code: 'normalize_shot_plan',
    sourceUnitId: null,
    message: '已根据修复后的 visualUnits 重算 shotBudget、rhythmCurve 和 functionMix',
  })

  return {
    result: {
      ...result,
      shotPlan: normalizeShotPlan(result, renumberedUnits),
      visualUnits: renumberedUnits,
    },
    appliedFixes: fixes,
  }
}

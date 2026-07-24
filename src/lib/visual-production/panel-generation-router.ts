import type { PanelAssetBindingPlan } from './binding-plan'
import type { VisualReference } from './references'

export type PanelGenerationRoute =
  | 'generate'
  | 'composite'
  | 'split'
  | 'asset_backfill'
  | 'human_required'

export interface PanelGenerationRouteDecision {
  schemaVersion: 1
  panelId: string
  route: PanelGenerationRoute
  reasons: string[]
  blockingAssetNames: string[]
  noReferenceReason: string | null
  suggestedFix?: string
}

interface PanelForGenerationRoute {
  id: string
  visualType?: string | null
  renderMode?: string | null
  onScreenText?: string | null
  imagePrompt?: string | null
  description?: string | null
}

function text(...values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => typeof value === 'string').join(' ')
}

function looksTextOrCoverProne(panel: PanelForGenerationRoute, bindingPlan: PanelAssetBindingPlan): boolean {
  const source = text(panel.visualType, panel.renderMode, panel.onScreenText, panel.imagePrompt, panel.description, bindingPlan.primarySubject)
  return panel.renderMode === 'text_card'
    || panel.renderMode === 'composite'
    || panel.visualType === 'book_cover'
    || panel.visualType === 'quote_card'
    || /(书封|封面|书名|标题|字幕|文字|quote|cover|title|caption|text)/iu.test(source)
}

function primarySubjectNeedsReference(bindingPlan: PanelAssetBindingPlan): boolean {
  const source = text(bindingPlan.primarySubject, bindingPlan.visualType, bindingPlan.renderMode)
  if (bindingPlan.renderMode === 'text_card') return false
  return /(角色|人物|男人|女人|少年|少女|船长|教授|潜水艇|潜艇|船体|舰船|飞船|汽车|书封|封面|实体书|武器|装置|character|person|submarine|vehicle|ship|book|cover|weapon|device)/iu.test(source)
}

function hasIdentityReference(bindingPlan: PanelAssetBindingPlan, references: VisualReference[]): boolean {
  if (references.some((ref) => (
    ref.role === 'primary_identity'
    || ref.role === 'supporting_identity'
    || ref.role === 'prop_detail'
    || ref.role === 'cover_motif'
  ))) {
    return true
  }
  return bindingPlan.bindings.some((binding) => (
    binding.role === 'primary_identity'
    || binding.role === 'prop_detail'
    || binding.role === 'cover_motif'
  ))
}

export function decidePanelGenerationRoute(params: {
  panel: PanelForGenerationRoute
  bindingPlan: PanelAssetBindingPlan
  references: VisualReference[]
}): PanelGenerationRouteDecision {
  const reasons: string[] = []
  const blockingAssetNames: string[] = []
  const textOrCoverProne = looksTextOrCoverProne(params.panel, params.bindingPlan)

  if (textOrCoverProne) {
    reasons.push('文字、书封或合成类镜头应生成干净底图，由下游叠加准确文字')
  }

  if (
    primarySubjectNeedsReference(params.bindingPlan)
    && !hasIdentityReference(params.bindingPlan, params.references)
  ) {
    blockingAssetNames.push(params.bindingPlan.primarySubject)
    return {
      schemaVersion: 1,
      panelId: params.panel.id,
      route: 'asset_backfill',
      reasons: [
        ...reasons,
        '主视觉主体需要稳定身份或物件外观，但没有可用参考图',
      ],
      blockingAssetNames,
      noReferenceReason: 'asset_missing_blocked',
      suggestedFix: '先补建或选择主主体资产参考图，再生成分镜图片',
    }
  }

  if (params.bindingPlan.complexity.recommendedAction === 'split') {
    return {
      schemaVersion: 1,
      panelId: params.panel.id,
      route: 'split',
      reasons: [
        ...reasons,
        '镜头包含过多主体、动作或比较信息，建议拆成多个单一关键帧',
      ],
      blockingAssetNames,
      noReferenceReason: params.references.length === 0 ? 'too_complex_without_reference' : null,
      suggestedFix: '拆分镜头规划，确保每张图只承载一个时空和一个主要视觉事件',
    }
  }

  if (params.bindingPlan.bindings.length === 0 && params.references.length === 0) {
    return {
      schemaVersion: 1,
      panelId: params.panel.id,
      route: textOrCoverProne ? 'composite' : 'generate',
      reasons: reasons.length > 0 ? reasons : ['一次性 b-roll、抽象画面或背景镜头允许不绑定资产'],
      blockingAssetNames,
      noReferenceReason: textOrCoverProne ? 'text_or_cover_clean_plate' : 'one_off_broll',
      suggestedFix: textOrCoverProne ? '生成无字干净底图，文字交给后期合成' : undefined,
    }
  }

  if (textOrCoverProne) {
    return {
      schemaVersion: 1,
      panelId: params.panel.id,
      route: 'composite',
      reasons,
      blockingAssetNames,
      noReferenceReason: null,
      suggestedFix: '保持图片无文字，后期合成准确文案',
    }
  }

  return {
    schemaVersion: 1,
    panelId: params.panel.id,
    route: 'generate',
    reasons: ['参考图和镜头复杂度允许直接生成单张关键帧'],
    blockingAssetNames,
    noReferenceReason: null,
  }
}

export function assertPanelGenerationRouteAllowed(decision: PanelGenerationRouteDecision) {
  if (decision.route !== 'asset_backfill' && decision.route !== 'human_required') return
  const suffix = [
    decision.route,
    ...decision.blockingAssetNames,
    ...decision.reasons,
  ].filter(Boolean).join(':')
  throw new Error(`PANEL_GENERATION_BLOCKED:${suffix}`)
}

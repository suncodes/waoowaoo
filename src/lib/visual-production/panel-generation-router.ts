import type { PanelAssetBindingPlan } from './binding-plan'
import type { VisualReference } from './references'
import type { ShotAssetRequirement } from './shot-asset-requirements'

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
  if (bindingPlan.requirementPlan) {
    return bindingPlan.requirementPlan.visualIntent === 'text_card'
      || bindingPlan.requirementPlan.visualIntent === 'book_clean_plate'
      || bindingPlan.requirementPlan.referencePolicy === 'clean_plate'
      || bindingPlan.requirementPlan.referencePolicy === 'forbidden'
  }
  const source = text(panel.visualType, panel.renderMode, panel.onScreenText, panel.imagePrompt, panel.description, bindingPlan.primarySubject)
  return panel.renderMode === 'text_card'
    || panel.renderMode === 'composite'
    || panel.visualType === 'book_cover'
    || panel.visualType === 'quote_card'
    || /(书封|封面|书名|标题|字幕|quote|cover|title|caption)/iu.test(source)
}

function primarySubjectNeedsReference(bindingPlan: PanelAssetBindingPlan): boolean {
  if (bindingPlan.requirementPlan) {
    if (bindingPlan.requirementPlan.noReferenceAllowed) return false
    return bindingPlan.requirementPlan.requirements.some((requirement) => (
      requirement.required
      && requirement.mustLock
      && (
        requirement.role === 'primary_identity'
        || requirement.role === 'prop_detail'
        || requirement.role === 'cover_motif'
      )
    ))
  }
  const source = text(bindingPlan.primarySubject, bindingPlan.visualType, bindingPlan.renderMode)
  if (bindingPlan.renderMode === 'text_card') return false
  return /(角色|人物|男人|女人|少年|少女|船长|教授|潜水艇|潜艇|船体|舰船|飞船|汽车|书封|封面|实体书|武器|装置|character|person|submarine|vehicle|ship|book|cover|weapon|device)/iu.test(source)
}

function namesMatch(left: string, right: string): boolean {
  return left.toLowerCase().trim() === right.toLowerCase().trim()
}

function referenceMatchesRequirement(
  reference: VisualReference,
  requirement: ShotAssetRequirement,
): boolean {
  if (requirement.assetId && reference.assetId === requirement.assetId) return true
  return reference.assetKind === requirement.kind && namesMatch(reference.assetName, requirement.name)
}

function bindingMatchesRequirement(
  bindingPlan: PanelAssetBindingPlan,
  requirement: ShotAssetRequirement,
): boolean {
  return bindingPlan.bindings.some((binding) => {
    if (requirement.assetId && binding.id === requirement.assetId) return true
    return binding.kind === requirement.kind && namesMatch(binding.name, requirement.name)
  })
}

function missingReferenceRequirements(params: {
  bindingPlan: PanelAssetBindingPlan
  references: VisualReference[]
}): ShotAssetRequirement[] {
  const requirementPlan = params.bindingPlan.requirementPlan
  if (!requirementPlan || requirementPlan.noReferenceAllowed) return []
  return requirementPlan.requirements.filter((requirement) => {
    if (!requirement.required && !requirement.mustLock) return false
    const requiresUsableImage = requirement.mustLock
      || requirement.role === 'primary_identity'
      || requirement.role === 'prop_detail'
      || requirement.role === 'cover_motif'
    if (!requiresUsableImage) return !bindingMatchesRequirement(params.bindingPlan, requirement)
    return !params.references.some((reference) => referenceMatchesRequirement(reference, requirement))
  })
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
  const requirementPlan = params.bindingPlan.requirementPlan || null

  if (textOrCoverProne) {
    reasons.push('文字、书封或合成类镜头应生成干净底图，由下游叠加准确文字')
  }

  if (requirementPlan) {
    const blockers = missingReferenceRequirements({
      bindingPlan: params.bindingPlan,
      references: params.references,
    })
    if (blockers.length > 0) {
      blockingAssetNames.push(...blockers.map((requirement) => requirement.name))
      const hasCharacterBlocker = blockers.some((requirement) => requirement.kind === 'character')
      return {
        schemaVersion: 1,
        panelId: params.panel.id,
        route: hasCharacterBlocker ? 'human_required' : 'asset_backfill',
        reasons: [
          ...reasons,
          hasCharacterBlocker
            ? '镜头需要稳定角色身份参考，但角色资产缺少可用形象图'
            : '镜头需要稳定场景或道具参考，但资产缺失或尚无可用图片',
        ],
        blockingAssetNames,
        noReferenceReason: hasCharacterBlocker ? 'character_reference_required' : 'asset_backfill_required',
        suggestedFix: hasCharacterBlocker
          ? '先补齐角色档案和形象图，再生成分镜图片'
          : '自动补建缺失场景/道具资产并生成参考图后，再生成分镜图片',
      }
    }
  }

  if (
    !requirementPlan
    && (
    primarySubjectNeedsReference(params.bindingPlan)
    && !hasIdentityReference(params.bindingPlan, params.references)
    )
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
      reasons: reasons.length > 0 ? reasons : [
        requirementPlan?.noReferenceReason || '一次性 b-roll、抽象画面或背景镜头允许不绑定资产',
      ],
      blockingAssetNames,
      noReferenceReason: textOrCoverProne
        ? 'text_or_cover_clean_plate'
        : requirementPlan?.noReferenceReason || 'one_off_broll',
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

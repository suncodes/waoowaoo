import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveArtStyleForGeneration } from '@/lib/art-style-generation'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { safeParseJsonObject } from '@/lib/json-repair'
import { estimateNarrationDurationMs } from '@/lib/novel-promotion/narration-timeline'
import {
  resolvePanelSpeechLineDurationMs,
  resolvePanelSpeechLineText,
  type PanelSpeechLine,
} from '@/lib/novel-promotion/speech-plan'
import {
  resolvePanelAssetBindingPlan,
  type PanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'
import {
  resolvePanelVisualReferenceSelection,
  serializePanelVisualReferenceSelection,
  visualReferencesForGenerationRoute,
  visualReferencesForPrompt,
  type PanelReferenceProjectData,
  type PanelVisualReferenceSelection,
  type ResolvePanelVisualReferencesOptions,
} from '@/lib/visual-production/references'
import { decidePanelGenerationRoute } from '@/lib/visual-production/panel-generation-router'
import {
  applyBackfillRequestsToRequirementPlan,
  ensureMissingAssetBackfill,
  type MissingAssetBackfillPlan,
} from '@/lib/visual-production/missing-asset-backfill'
import { preparePanelGenerationPrompt } from '@/lib/novel-promotion/panel-prompt-preparation'
import { markPanelImagePromptStale } from '@/lib/visual-production/panel-prepared-prompt-state'
import type { Locale } from '@/i18n/routing'
import type {
  StoryboardAutoFixAction,
  StoryboardAutoFixApplyResult,
  StoryboardAssetBackfillResult,
  StoryboardAutoFixPlan,
  StoryboardReadinessIssue,
  StoryboardReadinessResult,
  StoryboardReadinessSummary,
  StoryboardReadinessStatus,
} from './types'

const WORKSPACE_META_KEY = '_workspace'
const AUTO_FIX_KEY = 'storyboardAutoFix'
const SPEECH_WARNING_CODES = new Set(['SPEECH_LONGER_THAN_PANEL', 'LINE_TOO_LONG'])

type EpisodeForReadiness = NonNullable<Awaited<ReturnType<typeof loadEpisode>>>
type PanelForReadiness = EpisodeForReadiness['storyboards'][number]['panels'][number]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function normalizeLocale(locale: string | null | undefined): Locale {
  return locale === 'en' ? 'en' : 'zh'
}

function nowIso() {
  return new Date().toISOString()
}

function createPlanId() {
  return `storyboard-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readStoredAutoFixPlan(productionBible: unknown): StoryboardAutoFixPlan | null {
  const workspace = asRecord(asRecord(productionBible)[WORKSPACE_META_KEY])
  const plan = asRecord(workspace[AUTO_FIX_KEY])
  if (plan.schemaVersion !== 1 || typeof plan.id !== 'string') return null
  return plan as unknown as StoryboardAutoFixPlan
}

async function writeStoredAutoFixPlan(episodeId: string, plan: StoryboardAutoFixPlan | null) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: { productionBible: true },
  })
  const bible = asRecord(episode?.productionBible)
  const workspace = { ...asRecord(bible[WORKSPACE_META_KEY]) }
  if (plan) {
    workspace[AUTO_FIX_KEY] = plan
  } else {
    delete workspace[AUTO_FIX_KEY]
  }
  await prisma.novelPromotionEpisode.update({
    where: { id: episodeId },
    data: {
      productionBible: asInputJson({
        ...bible,
        [WORKSPACE_META_KEY]: workspace,
      }),
    },
  })
}

async function loadEpisode(episodeId: string) {
  return await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      productionBible: true,
      _count: {
        select: {
          panelSpeeches: true,
        },
      },
      novelPromotionProject: {
        select: {
          projectId: true,
          artStyle: true,
          artStyleMode: true,
          artStylePrompt: true,
          customArtStyleReferenceImage: true,
          artStyleReferenceEnabled: true,
          characters: {
            include: {
              appearances: {
                orderBy: { appearanceIndex: 'asc' },
              },
            },
          },
          locations: {
            include: {
              images: {
                orderBy: { imageIndex: 'asc' },
              },
            },
          },
        },
      },
      storyboards: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          clipId: true,
          panels: {
            orderBy: { panelIndex: 'asc' },
            include: {
              panelSpeech: true,
            },
          },
        },
      },
    },
  })
}

function resolveStyleReferenceOptions(params: {
  artStyle?: string | null
  artStyleMode?: string | null
  artStylePrompt?: string | null
  customArtStyleReferenceImage?: string | null
  artStyleReferenceEnabled?: boolean | null
  locale: Locale
}): Pick<ResolvePanelVisualReferencesOptions, 'styleReferenceImage' | 'styleReferenceEnabled' | 'styleReferenceName'> {
  const style = resolveArtStyleForGeneration({
    artStyleMode: params.artStyleMode,
    artStyle: params.artStyle,
    artStylePrompt: params.artStylePrompt,
    customArtStyleReferenceImage: params.customArtStyleReferenceImage,
    artStyleReferenceEnabled: params.artStyleReferenceEnabled,
    locale: params.locale,
  })
  return {
    styleReferenceImage: style.referenceImage,
    styleReferenceEnabled: style.referenceEnabled,
    styleReferenceName: params.locale === 'en' ? 'visual style reference' : '视觉风格参考图',
  }
}

function flattenPanels(episode: EpisodeForReadiness): PanelForReadiness[] {
  return episode.storyboards.flatMap((storyboard) => storyboard.panels)
}

function warningRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const record = asRecord(item)
      return typeof record.code === 'string' ? [record] : []
    })
    : []
}

function readPanelDurationMs(panel: PanelForReadiness): number | null {
  if (typeof panel.targetDurationMs === 'number' && Number.isFinite(panel.targetDurationMs) && panel.targetDurationMs > 0) {
    return Math.round(panel.targetDurationMs)
  }
  if (typeof panel.duration === 'number' && Number.isFinite(panel.duration) && panel.duration > 0) {
    return Math.round(panel.duration * 1000)
  }
  return null
}

function compactText(value: string): string {
  return value.replace(/\s+/g, '')
}

function targetDurationForPanelLine(panel: PanelForReadiness, lineCount: number): number {
  const durationMs = readPanelDurationMs(panel) || 4000
  return Math.max(1200, Math.floor((durationMs * 1.05) / Math.max(1, lineCount)))
}

function issueId(kind: string, panelId?: string | null, suffix?: string | number | null) {
  return [kind, panelId, suffix].filter((item) => item !== undefined && item !== null && item !== '').join(':')
}

function buildSpeechIssuesAndActions(panel: PanelForReadiness): {
  issues: StoryboardReadinessIssue[]
  actions: StoryboardAutoFixAction[]
} {
  const issues: StoryboardReadinessIssue[] = []
  const actions: StoryboardAutoFixAction[] = []
  const speech = panel.panelSpeech
  const panelNumber = panel.panelNumber ?? panel.panelIndex + 1

  if (!speech) return { issues, actions }

  const warnings = warningRecords(speech.warningsJson)
  const blocking = warnings.filter((warning) => warning.severity === 'blocking')
  if (speech.status === 'invalid' || blocking.length > 0) {
    issues.push({
      id: issueId('speech_plan_invalid', panel.id),
      kind: 'speech_plan_invalid',
      severity: 'blocking',
      panelId: panel.id,
      panelNumber,
      title: `镜头 ${panelNumber} 台词计划异常`,
      message: blocking.map((warning) => String(warning.message || warning.code)).join('；') || '台词计划状态异常。',
      autoFixable: false,
      metadata: { warnings: blocking },
    })
  }

  const lines: PanelSpeechLine[] = [{
    voiceLineId: speech.id,
    lineIndex: panel.panelIndex + 1,
    speaker: speech.speaker,
    content: speech.originalContent,
    order: 1,
    estimatedDurationMs: speech.estimatedDurationMs || estimateNarrationDurationMs(speech.deliveryContent || speech.originalContent),
    deliveryContent: speech.deliveryContent,
  }]
  const targetDurationMs = targetDurationForPanelLine(panel, 1)
  for (const warning of warnings) {
    const code = String(warning.code || '')
    if (!SPEECH_WARNING_CODES.has(code)) continue
    const kind = code === 'LINE_TOO_LONG' ? 'line_too_long' : 'speech_too_long'
    issues.push({
      id: issueId(kind, panel.id, code),
      kind,
      severity: 'warning',
      panelId: panel.id,
      panelNumber,
      title: `镜头 ${panelNumber} 台词节奏偏紧`,
      message: String(warning.message || '台词预计时长长于镜头时长。'),
      autoFixable: lines.length > 0,
      metadata: { warning },
    })
  }

  for (const line of lines) {
    const before = line.content.trim()
    const currentDelivery = (line.deliveryContent || '').trim()
    const currentText = resolvePanelSpeechLineText(line)
    const currentDurationMs = resolvePanelSpeechLineDurationMs(line)
    const originalDurationMs = estimateNarrationDurationMs(before)
    if (!before || currentDurationMs <= targetDurationMs * 1.25) continue
    actions.push({
      id: issueId('rewrite_delivery_line', panel.id, line.voiceLineId),
      type: 'rewrite_delivery_line',
      panelId: panel.id,
      voiceLineId: line.voiceLineId,
      title: `生成镜头 ${panelNumber} 口播版`,
      reason: `当前镜头口播预计 ${Math.round(currentDurationMs / 1000)}s，超过建议 ${Math.round(targetDurationMs / 1000)}s；需要生成语义完整的镜头口播版。`,
      before,
      after: currentDelivery || null,
      autoApply: false,
      metadata: {
        panelDurationMs: readPanelDurationMs(panel) || null,
        targetDurationMs,
        originalDurationMs,
        currentDurationMs,
        currentDeliveryContent: currentDelivery || null,
        currentText,
        speaker: line.speaker,
      },
    })
  }

  return { issues, actions }
}

function mergeRequirementPlanIntoPhotographyRules(params: {
  raw: string | null
  requirementPlan: unknown
  bindingPlan: PanelAssetBindingPlan
}) {
  const rules = asRecord(parseJson(params.raw))
  return JSON.stringify({
    ...rules,
    ...(params.requirementPlan ? { shotAssetRequirementPlan: params.requirementPlan } : {}),
    assetBindingPlan: params.bindingPlan,
  })
}

function refreshBindingPlanWithRequirementPlan(params: {
  panel: PanelForReadiness
  requirementPlan: unknown
}): PanelAssetBindingPlan {
  const rules = asRecord(parseJson(params.panel.photographyRules))
  const rulesWithoutBindingPlan = { ...rules }
  delete rulesWithoutBindingPlan.assetBindingPlan
  return resolvePanelAssetBindingPlan({
    ...params.panel,
    photographyRules: {
      ...rulesWithoutBindingPlan,
      shotAssetRequirementPlan: params.requirementPlan,
    },
    shotAssetRequirementPlan: params.requirementPlan,
  })
}

function buildPanelReferencePlan(params: {
  bindingPlan: PanelAssetBindingPlan
  references: ReturnType<typeof visualReferencesForPrompt>
  decision: ReturnType<typeof decidePanelGenerationRoute>
  referenceSelection?: PanelVisualReferenceSelection
  backfill?: unknown
}) {
  return {
    schemaVersion: 1,
    shotAssetRequirementPlan: params.bindingPlan.requirementPlan || null,
    bindingPlan: params.bindingPlan,
    references: params.references,
    decision: params.decision,
    ...(params.referenceSelection ? {
      referenceSelection: serializePanelVisualReferenceSelection(params.referenceSelection),
    } : {}),
    ...(params.backfill ? { backfill: params.backfill } : {}),
  }
}

function readStoredBackfillPlan(referencePlan: unknown): MissingAssetBackfillPlan | null {
  const backfill = asRecord(asRecord(referencePlan).backfill)
  if (backfill.schemaVersion !== 1 || typeof backfill.panelId !== 'string' || !Array.isArray(backfill.requests)) {
    return null
  }
  return backfill as unknown as MissingAssetBackfillPlan
}

function buildVisualIssuesAndActions(params: {
  panel: PanelForReadiness
  projectData: PanelReferenceProjectData
  referenceOptions?: ResolvePanelVisualReferencesOptions
}): {
  issues: StoryboardReadinessIssue[]
  actions: StoryboardAutoFixAction[]
} {
  const { panel, projectData } = params
  const panelNumber = panel.panelNumber ?? panel.panelIndex + 1
  const issues: StoryboardReadinessIssue[] = []
  const actions: StoryboardAutoFixAction[] = []
  const bindingPlan = resolvePanelAssetBindingPlan(panel)
  const referenceSelection = resolvePanelVisualReferenceSelection({
    projectData,
    panel,
    options: params.referenceOptions,
  })
  const decision = decidePanelGenerationRoute({
    panel,
    bindingPlan,
    references: visualReferencesForGenerationRoute(referenceSelection.candidates),
  })

  if (decision.route === 'asset_backfill') {
    issues.push({
      id: issueId('asset_backfill_required', panel.id, decision.blockingAssetNames.join(',')),
      kind: 'asset_backfill_required',
      severity: 'blocking',
      panelId: panel.id,
      panelNumber,
      title: `镜头 ${panelNumber} 缺少参考资产`,
      message: decision.reasons.join('；') || '镜头需要稳定参考资产。',
      autoFixable: true,
      metadata: { decision },
    })
    actions.push({
      id: issueId('backfill_assets', panel.id),
      type: 'backfill_assets',
      panelId: panel.id,
      title: `补齐镜头 ${panelNumber} 参考资产`,
      reason: decision.suggestedFix || '自动补齐缺失资产参考图后，再生成分镜图片。',
      autoApply: true,
      metadata: { decision },
    })
  } else if (decision.route === 'human_required') {
    issues.push({
      id: issueId('manual_reference_required', panel.id, decision.blockingAssetNames.join(',')),
      kind: 'manual_reference_required',
      severity: 'blocking',
      panelId: panel.id,
      panelNumber,
      title: `镜头 ${panelNumber} 缺少无法自动补齐的参考`,
      message: decision.reasons.join('；') || '镜头缺少稳定参考。',
      autoFixable: false,
      metadata: { decision },
    })
  } else if (decision.route === 'split') {
    issues.push({
      id: issueId('complex_panel_split_required', panel.id),
      kind: 'complex_panel_split_required',
      severity: 'blocking',
      panelId: panel.id,
      panelNumber,
      title: `镜头 ${panelNumber} 信息过载`,
      message: decision.reasons.join('；') || '单张图承载主体、动作或时空过多，应拆成连续镜头。',
      autoFixable: false,
      metadata: { decision, complexity: bindingPlan.complexity },
    })
    actions.push({
      id: issueId('split_panel_required', panel.id),
      type: 'split_panel_required',
      panelId: panel.id,
      title: `规划拆分镜头 ${panelNumber}`,
      reason: decision.suggestedFix || '拆分镜头规划，确保每张图只承载一个主要视觉事件。',
      autoApply: false,
      metadata: { decision, complexity: bindingPlan.complexity },
    })
  }

  for (const warning of bindingPlan.warnings) {
    if (warning.severity === 'info') continue
    issues.push({
      id: issueId('binding_warning', panel.id, `${warning.code}:${warning.assetId || ''}`),
      kind: 'binding_warning',
      severity: warning.severity === 'critical' ? 'blocking' : 'warning',
      panelId: panel.id,
      panelNumber,
      title: `镜头 ${panelNumber} 资产绑定提示`,
      message: warning.message,
      autoFixable: warning.code === 'MISSING_REQUIRED_ASSET',
      metadata: { warning },
    })
  }

  if (actions.some((action) => action.type === 'backfill_assets') || panel.generationRoute !== decision.route) {
    actions.push({
      id: issueId('refresh_binding_plan', panel.id),
      type: 'refresh_binding_plan',
      panelId: panel.id,
      title: `刷新镜头 ${panelNumber} 绑定计划`,
      reason: '同步最新资产绑定、参考图和图片生成路由。',
      autoApply: true,
      metadata: { decision },
    })
  }

  return { issues, actions }
}

function summarize(totalPanels: number, issues: StoryboardReadinessIssue[]): StoryboardReadinessSummary {
  return {
    totalPanels,
    speechWarnings: issues.filter((issue) => issue.kind === 'speech_too_long' || issue.kind === 'line_too_long').length,
    speechBlocking: issues.filter((issue) => issue.kind === 'speech_plan_missing' || issue.kind === 'speech_plan_invalid').length,
    missingAssets: issues.filter((issue) => issue.kind === 'asset_backfill_required').length,
    manualReferences: issues.filter((issue) => issue.kind === 'manual_reference_required').length,
    complexPanels: issues.filter((issue) => issue.kind === 'complex_panel_split_required').length,
    bindingWarnings: issues.filter((issue) => issue.kind === 'binding_warning').length,
    autoFixableIssues: issues.filter((issue) => issue.autoFixable).length,
    blockingIssues: issues.filter((issue) => issue.severity === 'blocking').length,
  }
}

function deriveStatus(params: {
  issues: StoryboardReadinessIssue[]
  storedPlan: StoryboardAutoFixPlan | null
}): StoryboardReadinessStatus {
  const storedStatus = params.storedPlan?.status
  if (storedStatus === 'waiting_user_confirm') return 'fix_pending_confirm'
  if (storedStatus === 'applying') return 'fix_applying'
  if (storedStatus === 'risk_accepted') return 'risk_accepted'
  if (params.issues.length === 0) return 'ready'
  if (params.issues.some((issue) => issue.severity === 'blocking' && !issue.autoFixable)) return 'blocked'
  return 'needs_fix'
}

function messageForStatus(status: StoryboardReadinessStatus, summary: StoryboardReadinessSummary): string {
  if (status === 'ready') return '分镜图片前置检查已通过。'
  if (status === 'fix_pending_confirm') return 'AI 已生成自动修复方案，等待确认应用。'
  if (status === 'fix_applying') return '自动修复正在应用。'
  if (status === 'risk_accepted') return '用户已确认接受当前风险继续。'
  if (status === 'blocked') return `检测到 ${summary.blockingIssues} 个阻断问题，其中包含需要重新规划或人工确认的内容。`
  return `检测到 ${summary.autoFixableIssues} 个可自动修复问题。`
}

function analyzeEpisodeReadiness(episode: EpisodeForReadiness): {
  totalPanels: number
  issues: StoryboardReadinessIssue[]
  actions: StoryboardAutoFixAction[]
  summary: StoryboardReadinessSummary
} {
  const projectData: PanelReferenceProjectData = episode.novelPromotionProject
  const referenceOptions = resolveStyleReferenceOptions({
    ...episode.novelPromotionProject,
    locale: 'zh',
  })
  const panels = flattenPanels(episode)
  const issues: StoryboardReadinessIssue[] = []
  const actions: StoryboardAutoFixAction[] = []
  const hasPanelSpeeches = episode._count.panelSpeeches > 0

  for (const panel of panels) {
    if (hasPanelSpeeches) {
      const speech = buildSpeechIssuesAndActions(panel)
      issues.push(...speech.issues)
      actions.push(...speech.actions)
    }

    const visual = buildVisualIssuesAndActions({ panel, projectData, referenceOptions })
    issues.push(...visual.issues)
    actions.push(...visual.actions)
  }

  const dedupedIssues = Array.from(new Map(issues.map((issue) => [issue.id, issue])).values())
  const dedupedActions = Array.from(new Map(actions.map((action) => [action.id, action])).values())

  return {
    totalPanels: panels.length,
    issues: dedupedIssues,
    actions: dedupedActions,
    summary: summarize(panels.length, dedupedIssues),
  }
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSpeechText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function hasCompleteSentenceEnd(value: string): boolean {
  return /[。！？!?；;.]$/u.test(value.trim())
}

function looksLikeMechanicalTruncation(before: string, after: string): boolean {
  const compactBefore = compactText(before)
  const compactAfter = compactText(after)
  if (!compactBefore || !compactAfter || compactBefore === compactAfter) return false
  return compactBefore.startsWith(compactAfter) && !hasCompleteSentenceEnd(after)
}

function targetCharsForDuration(durationMs: number): number {
  return Math.max(8, Math.floor(durationMs / 180))
}

function deliveryRewritePrompt(params: {
  actions: StoryboardAutoFixAction[]
  episode: EpisodeForReadiness
  locale: Locale
}) {
  const panelsById = new Map(flattenPanels(params.episode).map((panel) => [panel.id, panel]))
  const requests = params.actions.flatMap((action) => {
    const panel = action.panelId ? panelsById.get(action.panelId) : null
    if (!panel || !action.before) return []
    const targetDurationMs = readNumber(action.metadata?.targetDurationMs) || 3200
    return [{
      actionId: action.id,
      panelNumber: panel.panelNumber ?? panel.panelIndex + 1,
      panelDescription: panel.description || panel.imagePrompt || panel.videoPrompt || '',
      panelDurationSeconds: Math.round((readPanelDurationMs(panel) || 4000) / 100) / 10,
      speaker: readString(action.metadata?.speaker) || null,
      originalContent: action.before,
      currentDeliveryContent: readString(action.metadata?.currentDeliveryContent) || null,
      targetDurationSeconds: Math.round(targetDurationMs / 100) / 10,
      suggestedMaxChineseChars: targetCharsForDuration(targetDurationMs),
    }]
  })

  return [
    '你是影视短视频口播编辑，负责把镜头内过长台词改写成“镜头口播版”。',
    '目标：让单个镜头的视频模型能自然说完台词，同时保留原文的核心事实、情绪、称谓、因果和剧情功能。',
    '硬性规则：',
    '1. 不允许截断原句，不允许用省略号，不允许输出半句话。',
    '2. 可以删掉重复修饰、收束长从句、改成更短但完整的一句话；不得新增原文没有的信息。',
    '3. 口播版只服务当前镜头，不修改原始台词；不要输出镜头描述、字幕说明或括号解释。',
    '4. 如果原文信息无法在目标时长内完整承载，输出最核心且语义完整的一句，并在 reason 中说明建议拆镜。',
    '5. 只输出 JSON，不要 Markdown。',
    '',
    '输出格式：',
    '{"rewrites":[{"actionId":"string","deliveryContent":"string","reason":"string"}]}',
    '',
    `语言：${params.locale === 'en' ? 'English' : '简体中文'}`,
    `待改写数据：${JSON.stringify(requests, null, 2)}`,
  ].join('\n')
}

function parseDeliveryRewrites(raw: string): Map<string, { deliveryContent: string; reason: string }> {
  const parsed = safeParseJsonObject(raw)
  const rewrites = Array.isArray(parsed.rewrites) ? parsed.rewrites : []
  const result = new Map<string, { deliveryContent: string; reason: string }>()
  for (const item of rewrites) {
    const record = asRecord(item)
    const actionId = readString(record.actionId)
    const deliveryContent = normalizeSpeechText(readString(record.deliveryContent))
    if (!actionId || !deliveryContent) continue
    result.set(actionId, {
      deliveryContent,
      reason: readString(record.reason),
    })
  }
  return result
}

async function hydrateDeliveryRewriteActions(params: {
  projectId: string
  userId: string
  locale: Locale
  episode: EpisodeForReadiness
  plan: StoryboardAutoFixPlan
}): Promise<StoryboardAutoFixPlan> {
  const rewriteActions = params.plan.actions.filter((action) => (
    action.type === 'rewrite_delivery_line'
    && action.before?.trim()
    && !action.after?.trim()
  ))
  if (rewriteActions.length === 0) return params.plan

  const modelConfig = await getProjectModelConfig(params.projectId, params.userId)
  if (!modelConfig.analysisModel) {
    return {
      ...params.plan,
      actions: params.plan.actions.map((action) => (
        action.type === 'rewrite_delivery_line'
          ? {
            ...action,
            autoApply: false,
            reason: `${action.reason} 当前项目未配置分析模型，无法自动生成口播版。`,
          }
          : action
      )),
    }
  }

  let rewrites = new Map<string, { deliveryContent: string; reason: string }>()
  try {
    const completion = await executeAiTextStep({
      userId: params.userId,
      model: modelConfig.analysisModel,
      projectId: params.projectId,
      action: 'storyboard_delivery_rewrite',
      temperature: 0.25,
      reasoning: true,
      messages: [{
        role: 'user',
        content: deliveryRewritePrompt({
          actions: rewriteActions,
          episode: params.episode,
          locale: params.locale,
        }),
      }],
      meta: {
        stepId: 'storyboard_delivery_rewrite',
        stepTitle: '生成镜头口播版',
        stepIndex: 1,
        stepTotal: 1,
      },
    })
    rewrites = parseDeliveryRewrites(completion.text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...params.plan,
      actions: params.plan.actions.map((action) => (
        action.type === 'rewrite_delivery_line'
          ? {
            ...action,
            autoApply: false,
            reason: `${action.reason} AI 口播版生成失败：${message}`,
            metadata: {
              ...action.metadata,
              rewriteError: message,
            },
          }
          : action
      )),
    }
  }
  const hydratedActions = params.plan.actions.map((action) => {
    if (action.type !== 'rewrite_delivery_line' || !action.before?.trim()) return action
    const rewrite = rewrites.get(action.id)
    if (!rewrite) {
      return {
        ...action,
        autoApply: false,
        reason: `${action.reason} AI 未返回可用口播版，建议重新生成方案或拆分镜头。`,
      }
    }

    const before = normalizeSpeechText(action.before)
    const after = normalizeSpeechText(rewrite.deliveryContent)
    const targetDurationMs = readNumber(action.metadata?.targetDurationMs) || 3200
    const originalDurationMs = readNumber(action.metadata?.originalDurationMs) || estimateNarrationDurationMs(before)
    const deliveryDurationMs = estimateNarrationDurationMs(after)
    const isImproved = deliveryDurationMs < originalDurationMs && compactText(after).length < compactText(before).length
    const isTooLong = deliveryDurationMs > targetDurationMs * 1.35
    const invalid = !after || looksLikeMechanicalTruncation(before, after) || !isImproved || isTooLong

    return {
      ...action,
      after: invalid ? null : after,
      autoApply: !invalid,
      reason: invalid
        ? `${action.reason} AI 结果未通过完整性或时长校验，建议拆分镜头或重新生成方案。`
        : (rewrite.reason || action.reason),
      metadata: {
        ...action.metadata,
        rewriteMode: 'llm_delivery_rewrite',
        deliveryDurationMs,
        deliveryTargetDurationMs: targetDurationMs,
        deliveryValidation: invalid
          ? {
            mechanicalTruncation: looksLikeMechanicalTruncation(before, after),
            improved: isImproved,
            tooLong: isTooLong,
          }
          : { passed: true },
      },
    }
  })

  return {
    ...params.plan,
    actions: hydratedActions,
  }
}

export async function getStoryboardReadiness(params: {
  projectId: string
  episodeId: string
}): Promise<StoryboardReadinessResult> {
  const episode = await loadEpisode(params.episodeId)
  if (!episode || episode.novelPromotionProject.projectId !== params.projectId) {
    throw new Error('EPISODE_NOT_FOUND')
  }

  const analysis = analyzeEpisodeReadiness(episode)
  const storedPlan = readStoredAutoFixPlan(episode.productionBible)
  const status = deriveStatus({ issues: analysis.issues, storedPlan })
  const fallbackPlan = storedPlan
    ? {
      ...storedPlan,
      issues: storedPlan.issues.length > 0 ? storedPlan.issues : analysis.issues,
      actions: storedPlan.actions.length > 0 ? storedPlan.actions : analysis.actions,
      summary: analysis.summary,
    }
    : null

  return {
    episodeId: params.episodeId,
    status,
    summary: analysis.summary,
    issues: analysis.issues,
    fixPlan: fallbackPlan,
    message: messageForStatus(status, analysis.summary),
  }
}

export async function startStoryboardAssetBackfill(params: {
  projectId: string
  episodeId: string
  userId: string
  locale?: string | null
}): Promise<StoryboardAssetBackfillResult> {
  const locale = normalizeLocale(params.locale)
  const episode = await loadEpisode(params.episodeId)
  if (!episode || episode.novelPromotionProject.projectId !== params.projectId) {
    throw new Error('EPISODE_NOT_FOUND')
  }

  const analysis = analyzeEpisodeReadiness(episode)
  const backfillPanelIds = new Set(
    analysis.actions
      .filter((action) => action.type === 'backfill_assets')
      .flatMap((action) => action.panelId ? [action.panelId] : []),
  )
  const refreshPanelIds = new Set(
    analysis.actions
      .filter((action) => action.type === 'refresh_binding_plan')
      .flatMap((action) => action.panelId ? [action.panelId] : []),
  )
  const requestedPanelIds: string[] = []
  const syncedPanelIds: string[] = []
  const promptFixedPanelIds: string[] = []
  const waitingConfirmationPanelIds: string[] = []
  const manualPanelIds: string[] = []
  const failedPanels: StoryboardAssetBackfillResult['failedPanels'] = []
  const projectData: PanelReferenceProjectData = episode.novelPromotionProject

  for (const panel of flattenPanels(episode)) {
    const shouldBackfill = backfillPanelIds.has(panel.id)
    const shouldRefresh = shouldBackfill || refreshPanelIds.has(panel.id)
    if (!shouldRefresh) continue
    try {
      const refreshed = await refreshPanelBindingAndRoute({
        projectId: params.projectId,
        userId: params.userId,
        locale,
        panel,
        projectData,
        runBackfill: shouldBackfill,
      })
      syncedPanelIds.push(panel.id)
      if (refreshed.backfill?.status === 'waiting_confirmation') {
        waitingConfirmationPanelIds.push(panel.id)
      }
      if (refreshed.backfill?.status === 'human_required' || refreshed.backfill?.status === 'not_needed') {
        manualPanelIds.push(panel.id)
        continue
      }
      if (refreshed.backfill?.requests.some((request) => !!request.taskId)) {
        requestedPanelIds.push(panel.id)
      }
      if (refreshed.decision.route !== 'asset_backfill' && refreshed.decision.route !== 'human_required') {
        await preparePanelGenerationPrompt({
          projectId: params.projectId,
          userId: params.userId,
          locale,
          mode: 'image',
          locator: { panelId: panel.id },
        })
        promptFixedPanelIds.push(panel.id)
      }
    } catch (error) {
      failedPanels.push({
        panelId: panel.id,
        message: error instanceof Error ? error.message : '缺失资产回填失败',
      })
    }
  }

  const readiness = await getStoryboardReadiness({
    projectId: params.projectId,
    episodeId: params.episodeId,
  })
  return {
    episodeId: params.episodeId,
    requestedPanelIds,
    syncedPanelIds,
    promptFixedPanelIds,
    waitingConfirmationPanelIds,
    manualPanelIds,
    failedPanels,
    readiness,
  }
}

export type StoryboardAssetReconciliationResult = {
  reconciledPanelIds: string[]
  promptFixedPanelIds: string[]
  waitingPanelIds: string[]
  failedPanels: Array<{
    panelId: string
    message: string
  }>
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function sourcePanelIdsFromAsset(value: unknown): string[] {
  const record = asRecord(parseJson(value))
  return readStringArray(record.sourcePanelIds)
}

function referencePlanAssetIds(referencePlan: unknown): Set<string> {
  const plan = asRecord(referencePlan)
  const bindingPlan = asRecord(plan.bindingPlan)
  const requirementPlans = [
    asRecord(plan.shotAssetRequirementPlan),
    asRecord(bindingPlan.requirementPlan),
  ]
  const ids = new Set<string>()
  const addAssetId = (value: unknown) => {
    const assetId = asRecord(value).assetId
    if (typeof assetId === 'string' && assetId.trim()) ids.add(assetId.trim())
  }

  for (const binding of Array.isArray(bindingPlan.bindings) ? bindingPlan.bindings : []) {
    const id = asRecord(binding).id
    if (typeof id === 'string' && id.trim()) ids.add(id.trim())
  }
  for (const requirementPlan of requirementPlans) {
    for (const requirement of Array.isArray(requirementPlan.requirements) ? requirementPlan.requirements : []) {
      addAssetId(requirement)
    }
  }
  const backfill = asRecord(plan.backfill)
  for (const request of Array.isArray(backfill.requests) ? backfill.requests : []) {
    addAssetId(request)
  }
  const referenceSelection = asRecord(plan.referenceSelection)
  for (const references of [
    plan.references,
    referenceSelection.candidates,
    referenceSelection.selected,
    referenceSelection.dropped,
  ]) {
    for (const reference of Array.isArray(references) ? references : []) {
      addAssetId(reference)
    }
  }
  return ids
}

async function sourcePanelIdsForAssets(params: {
  projectId: string
  assetIds: string[]
}): Promise<Set<string>> {
  if (params.assetIds.length === 0) return new Set<string>()
  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
    select: {
      characters: {
        where: { id: { in: params.assetIds } },
        select: { assetMeta: true, profileData: true },
      },
      locations: {
        where: { id: { in: params.assetIds } },
        select: { assetMeta: true },
      },
    },
  })
  const panelIds = new Set<string>()
  for (const character of project?.characters || []) {
    for (const panelId of [
      ...sourcePanelIdsFromAsset(character.assetMeta),
      ...sourcePanelIdsFromAsset(character.profileData),
    ]) {
      panelIds.add(panelId)
    }
  }
  for (const location of project?.locations || []) {
    for (const panelId of sourcePanelIdsFromAsset(location.assetMeta)) {
      panelIds.add(panelId)
    }
  }
  return panelIds
}

async function loadProjectEpisodes(projectId: string): Promise<EpisodeForReadiness[]> {
  const episodeRows = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProject: { projectId } },
    select: { id: true },
  })
  const episodes = await Promise.all(episodeRows.map((episode) => loadEpisode(episode.id)))
  return episodes.flatMap((episode) => episode ? [episode] : [])
}

function panelReferencesChangedAssets(params: {
  panel: PanelForReadiness
  assetIds: Set<string>
  sourcePanelIds: Set<string>
}): boolean {
  if (params.sourcePanelIds.has(params.panel.id)) return true
  for (const assetId of referencePlanAssetIds(params.panel.referencePlan)) {
    if (params.assetIds.has(assetId)) return true
  }
  return false
}

function isReferenceBlockedRoute(route: string): boolean {
  return route === 'asset_backfill' || route === 'human_required'
}

export async function reconcileStoryboardPanelsForAssetChanges(params: {
  projectId: string
  userId: string
  assetIds: string[]
  locale?: string | null
}): Promise<StoryboardAssetReconciliationResult> {
  const assetIds = Array.from(new Set(params.assetIds.filter(Boolean)))
  const result: StoryboardAssetReconciliationResult = {
    reconciledPanelIds: [],
    promptFixedPanelIds: [],
    waitingPanelIds: [],
    failedPanels: [],
  }
  if (assetIds.length === 0) return result

  const [episodes, sourcePanelIds] = await Promise.all([
    loadProjectEpisodes(params.projectId),
    sourcePanelIdsForAssets({ projectId: params.projectId, assetIds }),
  ])
  const assetIdSet = new Set(assetIds)
  const locale = normalizeLocale(params.locale)

  for (const episode of episodes) {
    const projectData: PanelReferenceProjectData = episode.novelPromotionProject
    for (const panel of flattenPanels(episode)) {
      if (!panelReferencesChangedAssets({ panel, assetIds: assetIdSet, sourcePanelIds })) continue
      try {
        const refreshed = await refreshPanelBindingAndRoute({
          projectId: params.projectId,
          userId: params.userId,
          locale,
          panel,
          projectData,
          runBackfill: false,
        })
        result.reconciledPanelIds.push(panel.id)
        if (isReferenceBlockedRoute(refreshed.decision.route)) {
          result.waitingPanelIds.push(panel.id)
          continue
        }
        await preparePanelGenerationPrompt({
          projectId: params.projectId,
          userId: params.userId,
          locale,
          mode: 'image',
          locator: { panelId: panel.id },
        })
        result.promptFixedPanelIds.push(panel.id)
      } catch (error) {
        result.failedPanels.push({
          panelId: panel.id,
          message: error instanceof Error ? error.message : '分镜提示词同步失败',
        })
      }
    }
  }
  result.reconciledPanelIds = Array.from(new Set(result.reconciledPanelIds))
  result.promptFixedPanelIds = Array.from(new Set(result.promptFixedPanelIds))
  result.waitingPanelIds = Array.from(new Set(result.waitingPanelIds))
  return result
}

function markBackfillWaitingForConfirmation(referencePlan: unknown, assetIds: Set<string>): Record<string, unknown> | null {
  const plan = asRecord(referencePlan)
  const backfill = asRecord(plan.backfill)
  const requests = Array.isArray(backfill.requests) ? backfill.requests : []
  let changed = false
  const nextRequests = requests.map((item) => {
    const request = asRecord(item)
    const assetId = typeof request.assetId === 'string' ? request.assetId.trim() : ''
    if (!assetId || !assetIds.has(assetId)) return item
    changed = true
    return {
      ...request,
      status: 'existing_asset_pending_confirmation',
    }
  })
  if (!changed) return null
  return markPanelImagePromptStale({
    ...plan,
    backfill: {
      ...backfill,
      status: 'waiting_confirmation',
      requests: nextRequests,
    },
  }, 'asset_candidate_waiting_confirmation')
}

export async function markStoryboardPanelsAwaitingAssetConfirmation(params: {
  projectId: string
  assetIds: string[]
}): Promise<string[]> {
  const assetIds = Array.from(new Set(params.assetIds.filter(Boolean)))
  if (assetIds.length === 0) return []
  const [episodes, sourcePanelIds] = await Promise.all([
    loadProjectEpisodes(params.projectId),
    sourcePanelIdsForAssets({ projectId: params.projectId, assetIds }),
  ])
  const affectedPanelIds: string[] = []
  const assetIdSet = new Set(assetIds)
  for (const episode of episodes) {
    for (const panel of flattenPanels(episode)) {
      if (!panelReferencesChangedAssets({ panel, assetIds: assetIdSet, sourcePanelIds })) continue
      const referencePlan = markBackfillWaitingForConfirmation(panel.referencePlan, assetIdSet)
      if (!referencePlan) continue
      await prisma.novelPromotionPanel.update({
        where: { id: panel.id },
        data: { referencePlan: asInputJson(referencePlan) },
      })
      affectedPanelIds.push(panel.id)
    }
  }
  return Array.from(new Set(affectedPanelIds))
}

export async function prepareStoryboardAutoFix(params: {
  projectId: string
  episodeId: string
  userId: string
  locale?: string | null
}): Promise<StoryboardReadinessResult> {
  const episode = await loadEpisode(params.episodeId)
  if (!episode || episode.novelPromotionProject.projectId !== params.projectId) {
    throw new Error('EPISODE_NOT_FOUND')
  }

  const analysis = analyzeEpisodeReadiness(episode)
  const createdAt = nowIso()
  const locale = normalizeLocale(params.locale)
  const plan: StoryboardAutoFixPlan = await hydrateDeliveryRewriteActions({
    projectId: params.projectId,
    userId: params.userId,
    locale,
    episode,
    plan: {
      schemaVersion: 1,
      id: createPlanId(),
      episodeId: params.episodeId,
      status: 'waiting_user_confirm',
      createdAt,
      updatedAt: createdAt,
      issues: analysis.issues,
      actions: analysis.actions,
      summary: analysis.summary,
    },
  })
  await writeStoredAutoFixPlan(params.episodeId, plan)
  return await getStoryboardReadiness(params)
}

async function refreshPanelBindingAndRoute(params: {
  projectId: string
  userId: string
  locale: Locale
  panel: PanelForReadiness
  projectData: PanelReferenceProjectData
  runBackfill: boolean
}) {
  const modelConfig = await getProjectModelConfig(params.projectId, params.userId)
  const referenceOptions = resolveStyleReferenceOptions({
    artStyleMode: modelConfig.artStyleMode,
    artStyle: modelConfig.artStyle,
    artStylePrompt: modelConfig.artStylePrompt,
    customArtStyleReferenceImage: modelConfig.customArtStyleReferenceImage,
    artStyleReferenceEnabled: modelConfig.artStyleReferenceEnabled,
    locale: params.locale,
  })
  let bindingPlan = resolvePanelAssetBindingPlan(params.panel)
  let referenceSelection = resolvePanelVisualReferenceSelection({
    projectData: params.projectData,
    panel: params.panel,
    options: referenceOptions,
  })
  let decision = decidePanelGenerationRoute({
    panel: params.panel,
    bindingPlan,
    references: visualReferencesForGenerationRoute(referenceSelection.candidates),
  })
  let backfill: MissingAssetBackfillPlan | null = null
  const storedBackfill = readStoredBackfillPlan(params.panel.referencePlan)

  if (params.runBackfill && (decision.route === 'asset_backfill' || decision.route === 'human_required')) {
    const backfillPlan = await ensureMissingAssetBackfill({
      projectId: params.projectId,
      userId: params.userId,
      locale: params.locale,
      panelId: params.panel.id,
      bindingPlan,
      decision,
    })
    backfill = backfillPlan
    const updatedRequirementPlan = applyBackfillRequestsToRequirementPlan(
      bindingPlan.requirementPlan,
      backfillPlan.requests,
    )
    bindingPlan = refreshBindingPlanWithRequirementPlan({
      panel: params.panel,
      requirementPlan: updatedRequirementPlan || bindingPlan.requirementPlan || null,
    })
    referenceSelection = resolvePanelVisualReferenceSelection({
      projectData: params.projectData,
      panel: {
        ...params.panel,
        photographyRules: mergeRequirementPlanIntoPhotographyRules({
          raw: params.panel.photographyRules,
          requirementPlan: bindingPlan.requirementPlan || null,
          bindingPlan,
        }),
      },
      options: referenceOptions,
    })
    decision = decidePanelGenerationRoute({
      panel: params.panel,
      bindingPlan,
      references: visualReferencesForGenerationRoute(referenceSelection.candidates),
    })
    if (backfillPlan.status === 'human_required' || (backfillPlan.status === 'not_needed' && decision.route === 'asset_backfill')) {
      decision = {
        ...decision,
        route: 'human_required',
        noReferenceReason: 'manual_reference_required',
        reasons: Array.from(new Set([
          ...decision.reasons,
          backfillPlan.status === 'not_needed'
            ? '缺失资产没有可执行的回填描述，请手动选择稳定参考。'
            : '缺失资产无法自动生成，请补充模型配置或手动选择稳定参考。',
        ])),
      }
    }
  }

  const referencePlan = buildPanelReferencePlan({
    bindingPlan,
    references: visualReferencesForPrompt(referenceSelection.selected),
    decision,
    referenceSelection,
    ...(backfill || ((decision.route === 'asset_backfill' || decision.route === 'human_required') && storedBackfill)
      ? { backfill: backfill || storedBackfill }
      : {}),
  })

  await prisma.novelPromotionPanel.update({
    where: { id: params.panel.id },
    data: {
      generationRoute: decision.route,
      noReferenceReason: decision.noReferenceReason,
      photographyRules: mergeRequirementPlanIntoPhotographyRules({
        raw: params.panel.photographyRules,
        requirementPlan: bindingPlan.requirementPlan || null,
        bindingPlan,
      }),
      referencePlan: asInputJson(markPanelImagePromptStale(
        referencePlan,
        'asset_binding_or_reference_changed',
      )),
    },
  })
  return { decision, backfill }
}

async function applyDeliveryRewriteAction(action: StoryboardAutoFixAction): Promise<boolean> {
  if (action.type !== 'rewrite_delivery_line') return false
  const panelId = action.panelId?.trim()
  const deliveryContent = normalizeSpeechText(action.after || '')
  if (!panelId || !deliveryContent) return false

  const speech = await prisma.novelPromotionPanelSpeech.findUnique({
    where: { panelId },
    select: { id: true },
  })
  if (!speech) return false

  await prisma.$transaction(async (tx) => {
    await tx.novelPromotionPanelSpeech.update({
      where: { id: speech.id },
      data: {
        deliveryContent,
        estimatedDurationMs: estimateNarrationDurationMs(deliveryContent),
        source: 'storyboard_auto_fix',
      },
    })
    await tx.novelPromotionPanelSpeechAudio.deleteMany({
      where: { panelSpeechId: speech.id },
    })
  })
  return true
}

export async function applyStoryboardAutoFix(params: {
  projectId: string
  episodeId: string
  userId: string
  locale?: string | null
}): Promise<StoryboardAutoFixApplyResult> {
  const locale = normalizeLocale(params.locale)
  const before = await loadEpisode(params.episodeId)
  if (!before || before.novelPromotionProject.projectId !== params.projectId) {
    throw new Error('EPISODE_NOT_FOUND')
  }

  const storedPlan = readStoredAutoFixPlan(before.productionBible)
  let plan = storedPlan?.status === 'waiting_user_confirm'
    ? storedPlan
    : (await prepareStoryboardAutoFix({
      projectId: params.projectId,
      episodeId: params.episodeId,
      userId: params.userId,
      locale: params.locale,
    })).fixPlan

  if (plan?.actions.some((action) => action.type === 'rewrite_delivery_line' && action.before?.trim() && !action.after?.trim())) {
    plan = await hydrateDeliveryRewriteActions({
      projectId: params.projectId,
      userId: params.userId,
      locale,
      episode: before,
      plan,
    })
  }

  if (!plan) {
    const readiness = await getStoryboardReadiness({ projectId: params.projectId, episodeId: params.episodeId })
    return {
      episodeId: params.episodeId,
      status: readiness.status,
      appliedActionIds: [],
      skippedActionIds: [],
      readiness,
    }
  }

  await writeStoredAutoFixPlan(params.episodeId, {
    ...plan,
    status: 'applying',
    updatedAt: nowIso(),
  })

  const appliedActionIds: string[] = []
  const skippedActionIds: string[] = []
  for (const action of plan.actions) {
    if (action.type !== 'rewrite_delivery_line') continue
    if (!action.autoApply || !action.after?.trim()) {
      skippedActionIds.push(action.id)
      continue
    }
    const applied = await applyDeliveryRewriteAction(action)
    if (applied) {
      appliedActionIds.push(action.id)
    } else {
      skippedActionIds.push(action.id)
    }
  }

  const latest = await loadEpisode(params.episodeId)
  if (latest) {
    const projectData: PanelReferenceProjectData = latest.novelPromotionProject
    const panels = flattenPanels(latest)
    const backfillPanelIds = new Set(plan.actions.filter((action) => action.type === 'backfill_assets').map((action) => action.panelId).filter(Boolean))
    const refreshPanelIds = new Set(plan.actions.filter((action) => action.type === 'refresh_binding_plan').map((action) => action.panelId).filter(Boolean))

    for (const panel of panels) {
      const shouldBackfill = backfillPanelIds.has(panel.id)
      const shouldRefresh = shouldBackfill || refreshPanelIds.has(panel.id)
      if (!shouldRefresh) continue
      await refreshPanelBindingAndRoute({
        projectId: params.projectId,
        userId: params.userId,
        locale,
        panel,
        projectData,
        runBackfill: shouldBackfill,
      })
      appliedActionIds.push(...plan.actions.filter((action) => action.panelId === panel.id && (action.type === 'backfill_assets' || action.type === 'refresh_binding_plan')).map((action) => action.id))
    }
  }

  skippedActionIds.push(...plan.actions.filter((action) => !action.autoApply).map((action) => action.id))
  const appliedPlan: StoryboardAutoFixPlan = {
    ...plan,
    status: 'applied',
    updatedAt: nowIso(),
  }
  await writeStoredAutoFixPlan(params.episodeId, appliedPlan)
  const readiness = await getStoryboardReadiness({ projectId: params.projectId, episodeId: params.episodeId })
  return {
    episodeId: params.episodeId,
    status: readiness.status,
    appliedActionIds: Array.from(new Set(appliedActionIds)),
    skippedActionIds: Array.from(new Set(skippedActionIds)),
    readiness,
  }
}

export async function acceptStoryboardReadinessRisk(params: {
  projectId: string
  episodeId: string
}) {
  const readiness = await getStoryboardReadiness(params)
  const current = readiness.fixPlan
  const timestamp = nowIso()
  await writeStoredAutoFixPlan(params.episodeId, {
    schemaVersion: 1,
    id: current?.id || createPlanId(),
    episodeId: params.episodeId,
    status: 'risk_accepted',
    createdAt: current?.createdAt || timestamp,
    updatedAt: timestamp,
    issues: readiness.issues,
    actions: current?.actions || [],
    summary: readiness.summary,
  })
  return await getStoryboardReadiness(params)
}

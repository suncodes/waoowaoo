import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
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
  resolvePanelVisualReferences,
  visualReferencesForPrompt,
  type PanelReferenceProjectData,
} from '@/lib/visual-production/references'
import { decidePanelGenerationRoute } from '@/lib/visual-production/panel-generation-router'
import {
  applyBackfillRequestsToRequirementPlan,
  ensureMissingAssetBackfill,
} from '@/lib/visual-production/missing-asset-backfill'
import type { Locale } from '@/i18n/routing'
import type {
  StoryboardAutoFixAction,
  StoryboardAutoFixApplyResult,
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
  backfill?: unknown
}) {
  return {
    schemaVersion: 1,
    shotAssetRequirementPlan: params.bindingPlan.requirementPlan || null,
    bindingPlan: params.bindingPlan,
    references: params.references,
    decision: params.decision,
    ...(params.backfill ? { backfill: params.backfill } : {}),
  }
}

function buildVisualIssuesAndActions(params: {
  panel: PanelForReadiness
  projectData: PanelReferenceProjectData
}): {
  issues: StoryboardReadinessIssue[]
  actions: StoryboardAutoFixAction[]
} {
  const { panel, projectData } = params
  const panelNumber = panel.panelNumber ?? panel.panelIndex + 1
  const issues: StoryboardReadinessIssue[] = []
  const actions: StoryboardAutoFixAction[] = []
  const bindingPlan = resolvePanelAssetBindingPlan(panel)
  const references = resolvePanelVisualReferences({ projectData, panel })
  const decision = decidePanelGenerationRoute({ panel, bindingPlan, references })

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

    const visual = buildVisualIssuesAndActions({ panel, projectData })
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
  let bindingPlan = resolvePanelAssetBindingPlan(params.panel)
  let references = resolvePanelVisualReferences({ projectData: params.projectData, panel: params.panel })
  let decision = decidePanelGenerationRoute({ panel: params.panel, bindingPlan, references })
  let backfill: unknown = null

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
    references = resolvePanelVisualReferences({
      projectData: params.projectData,
      panel: {
        ...params.panel,
        photographyRules: mergeRequirementPlanIntoPhotographyRules({
          raw: params.panel.photographyRules,
          requirementPlan: bindingPlan.requirementPlan || null,
          bindingPlan,
        }),
      },
    })
    decision = decidePanelGenerationRoute({ panel: params.panel, bindingPlan, references })
  }

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
      referencePlan: asInputJson(buildPanelReferencePlan({
        bindingPlan,
        references: visualReferencesForPrompt(references),
        decision,
        ...(backfill ? { backfill } : {}),
      })),
    },
  })
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

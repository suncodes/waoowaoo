import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { estimateNarrationDurationMs, rebuildEpisodeNarrationTimeline } from '@/lib/novel-promotion/narration-timeline'
import { rebuildEpisodeSpeechPlans } from '@/lib/novel-promotion/speech-plan'
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
          voiceLines: true,
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
              speechPlan: true,
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

function speechPlanLines(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const record = asRecord(item)
      return typeof record.voiceLineId === 'string' && typeof record.content === 'string' ? [record] : []
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

function compressVoiceLineText(content: string, maxChars: number): string {
  const normalized = content.trim().replace(/\s+/g, ' ')
  if (compactText(normalized).length <= maxChars) return normalized
  const sentence = normalized.split(/[。！？!?；;]/u).find((item) => compactText(item).length >= 4)?.trim() || normalized
  if (compactText(sentence).length <= maxChars) return sentence
  const chars = Array.from(sentence)
  return chars.slice(0, Math.max(8, maxChars)).join('').replace(/[，、：:,.\s]+$/u, '')
}

function targetCharsForPanel(panel: PanelForReadiness, lineCount: number): number {
  const durationMs = readPanelDurationMs(panel) || 4000
  const safeDuration = Math.max(1200, Math.floor((durationMs * 1.05) / Math.max(1, lineCount)))
  return Math.max(8, Math.floor(safeDuration / 180))
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
  const plan = panel.speechPlan
  const panelNumber = panel.panelNumber ?? panel.panelIndex + 1

  if (!plan) {
    issues.push({
      id: issueId('speech_plan_missing', panel.id),
      kind: 'speech_plan_missing',
      severity: 'blocking',
      panelId: panel.id,
      panelNumber,
      title: `镜头 ${panelNumber} 缺少台词计划`,
      message: '已有分镜但没有镜头级台词与声音计划，视频生成无法稳定携带台词和音色。',
      autoFixable: true,
    })
    actions.push({
      id: issueId('rebuild_speech_plans', panel.id),
      type: 'rebuild_speech_plans',
      panelId: panel.id,
      title: '重建台词计划',
      reason: '镜头级台词计划缺失。',
      autoApply: true,
    })
    return { issues, actions }
  }

  const warnings = warningRecords(plan.warningsJson)
  const blocking = warnings.filter((warning) => warning.severity === 'blocking')
  if (plan.status === 'invalid' || blocking.length > 0) {
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

  const lines = speechPlanLines(plan.linesJson)
  const targetChars = targetCharsForPanel(panel, Math.max(1, lines.length))
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
    const voiceLineId = String(line.voiceLineId)
    const before = String(line.content || '').trim()
    const after = compressVoiceLineText(before, targetChars)
    if (!before || after === before) continue
    actions.push({
      id: issueId('compress_voice_line', panel.id, voiceLineId),
      type: 'compress_voice_line',
      panelId: panel.id,
      voiceLineId,
      title: `压缩镜头 ${panelNumber} 台词`,
      reason: `当前镜头台词偏长，按 ${Math.round((readPanelDurationMs(panel) || 4000) / 1000)}s 镜头压缩表达。`,
      before,
      after,
      autoApply: true,
      metadata: { targetChars },
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
  const hasVoiceLines = episode._count.voiceLines > 0

  for (const panel of panels) {
    if (hasVoiceLines) {
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
}): Promise<StoryboardReadinessResult> {
  const episode = await loadEpisode(params.episodeId)
  if (!episode || episode.novelPromotionProject.projectId !== params.projectId) {
    throw new Error('EPISODE_NOT_FOUND')
  }

  const analysis = analyzeEpisodeReadiness(episode)
  const createdAt = nowIso()
  const plan: StoryboardAutoFixPlan = {
    schemaVersion: 1,
    id: createPlanId(),
    episodeId: params.episodeId,
    status: 'waiting_user_confirm',
    createdAt,
    updatedAt: createdAt,
    issues: analysis.issues,
    actions: analysis.actions,
    summary: analysis.summary,
  }
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
  const plan = storedPlan?.status === 'waiting_user_confirm'
    ? storedPlan
    : (await prepareStoryboardAutoFix({ projectId: params.projectId, episodeId: params.episodeId })).fixPlan

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
  const needsSpeechRebuild = plan.actions.some((action) => action.type === 'rebuild_speech_plans')
  if (needsSpeechRebuild) {
    await rebuildEpisodeSpeechPlans(params.episodeId, 'storyboard_auto_fix')
    appliedActionIds.push(...plan.actions.filter((action) => action.type === 'rebuild_speech_plans').map((action) => action.id))
  }

  for (const action of plan.actions) {
    if (action.type !== 'compress_voice_line') continue
    if (!action.voiceLineId || !action.after?.trim()) {
      skippedActionIds.push(action.id)
      continue
    }
    await prisma.novelPromotionVoiceLine.update({
      where: { id: action.voiceLineId },
      data: {
        content: action.after.trim(),
        estimatedDurationMs: estimateNarrationDurationMs(action.after),
      },
    })
    appliedActionIds.push(action.id)
  }

  if (plan.actions.some((action) => action.type === 'compress_voice_line')) {
    await rebuildEpisodeNarrationTimeline(params.episodeId)
    await rebuildEpisodeSpeechPlans(params.episodeId, 'storyboard_auto_fix_voice_compress')
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

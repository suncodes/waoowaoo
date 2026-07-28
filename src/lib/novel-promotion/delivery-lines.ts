import { Prisma } from '@prisma/client'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { getProjectModelConfig } from '@/lib/config-service'
import { safeParseJsonObject } from '@/lib/json-repair'
import { prisma } from '@/lib/prisma'
import { estimateNarrationDurationMs } from '@/lib/novel-promotion/narration-timeline'
import {
  buildPanelSpeechPlanPayloadFromLines,
  ensureEpisodeSpeechPlans,
  readPanelSpeechLines,
  readPanelSpeechVoiceConfig,
  type PanelSpeechLine,
} from '@/lib/novel-promotion/speech-plan'
import type { Locale } from '@/i18n/routing'

export const DELIVERY_LINES_ERROR = {
  EPISODE_NOT_FOUND: 'DELIVERY_LINES_EPISODE_NOT_FOUND',
  DB_SCHEMA_OUT_OF_DATE: 'DELIVERY_LINES_DB_SCHEMA_OUT_OF_DATE',
  MISSING_ANALYSIS_MODEL: 'DELIVERY_LINES_MISSING_ANALYSIS_MODEL',
  EMPTY_RESPONSE: 'DELIVERY_LINES_EMPTY_RESPONSE',
} as const

export type DeliveryLinesErrorCode = typeof DELIVERY_LINES_ERROR[keyof typeof DELIVERY_LINES_ERROR]

export class DeliveryLinesError extends Error {
  code: DeliveryLinesErrorCode

  constructor(code: DeliveryLinesErrorCode, message: string) {
    super(message)
    this.name = 'DeliveryLinesError'
    this.code = code
  }
}

interface DeliveryRewriteRequest {
  requestId: string
  panelId: string
  voiceLineId: string
  panelNumber: number
  panelDescription: string
  panelDurationSeconds: number
  speaker: string
  originalContent: string
  currentDeliveryContent: string | null
  targetDurationSeconds: number
  suggestedMaxChineseChars: number
}

interface DeliveryRewrite {
  requestId: string
  deliveryContent: string
  reason: string | null
}

interface PanelForDelivery {
  id: string
  panelIndex: number
  panelNumber: number | null
  description: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  duration: number | null
  targetDurationMs: number | null
  speechPlan: {
    id: string
    panelId: string
    mode: string
    status: string
    linesJson: unknown
    voiceConfigJson: unknown
    source: string
  } | null
}

export interface GenerateEpisodeDeliveryLinesResult {
  episodeId: string
  available: true
  updatedCount: number
  skippedCount: number
  totalLines: number
}

const DELIVERY_BATCH_SIZE = 24

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function normalizeLocale(locale: string | null | undefined): Locale {
  return locale && locale.toLowerCase().includes('en') ? 'en' : 'zh'
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSpeechText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function nowIso() {
  return new Date().toISOString()
}

function readPanelDurationMs(panel: Pick<PanelForDelivery, 'duration' | 'targetDurationMs'>): number {
  if (typeof panel.targetDurationMs === 'number' && Number.isFinite(panel.targetDurationMs) && panel.targetDurationMs > 0) {
    return Math.round(panel.targetDurationMs)
  }
  if (typeof panel.duration === 'number' && Number.isFinite(panel.duration) && panel.duration > 0) {
    return Math.round(panel.duration > 1000 ? panel.duration : panel.duration * 1000)
  }
  return 4000
}

function targetDurationForLine(panel: PanelForDelivery, lineCount: number): number {
  const durationMs = readPanelDurationMs(panel)
  return Math.max(1200, Math.floor((durationMs * 1.05) / Math.max(1, lineCount)))
}

function targetCharsForDuration(durationMs: number): number {
  return Math.max(8, Math.floor(durationMs / 180))
}

function panelDescription(panel: PanelForDelivery): string {
  return panel.description || panel.imagePrompt || panel.videoPrompt || ''
}

function buildRequestId(panelId: string, voiceLineId: string) {
  return `${panelId}:${voiceLineId}`
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function buildDeliveryRewritePrompt(params: {
  requests: DeliveryRewriteRequest[]
  locale: Locale
}) {
  return [
    '你是影视短视频口播编辑，负责把每个镜头的原始台词改写为“口播版台词”。',
    '目标：让单个镜头的视频原生音频更自然，避免语速被模型强行压缩，同时保留原文的核心事实、称谓、情绪、因果和剧情功能。',
    '',
    '硬性规则：',
    '1. 不允许截断原句，不允许用省略号，不允许输出半句话。',
    '2. 可以删掉重复修饰、收束长从句、调整语序；不得新增原文没有的信息。',
    '3. 每条输出必须是完整自然的一句或短句组，只输出台词本身，不要写镜头描述、字幕说明或括号解释。',
    '4. 如果原文已经足够短，可以保持原文不变。',
    '5. suggestedMaxChineseChars 是节奏建议，不是强制截断长度；语义完整优先。',
    '6. 只输出 JSON，不要 Markdown。',
    '',
    '输出格式：',
    '{"lines":[{"requestId":"string","deliveryContent":"string","reason":"string"}]}',
    '',
    `语言：${params.locale === 'en' ? 'English' : '简体中文'}`,
    `待改写数据：${JSON.stringify(params.requests, null, 2)}`,
  ].join('\n')
}

function parseDeliveryRewrites(raw: string): Map<string, DeliveryRewrite> {
  const parsed = safeParseJsonObject(raw)
  const rawLines = Array.isArray(parsed.lines)
    ? parsed.lines
    : Array.isArray(parsed.rewrites)
      ? parsed.rewrites
      : []
  const rewrites = new Map<string, DeliveryRewrite>()

  for (const item of rawLines) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const requestId = readTrimmedString(record.requestId) || readTrimmedString(record.actionId)
    const deliveryContent = normalizeSpeechText(readTrimmedString(record.deliveryContent))
    if (!requestId || !deliveryContent) continue
    rewrites.set(requestId, {
      requestId,
      deliveryContent,
      reason: readTrimmedString(record.reason) || null,
    })
  }

  return rewrites
}

async function loadEpisodePanels(projectId: string, episodeId: string) {
  return await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: {
      id: true,
      storyboards: {
        orderBy: { createdAt: 'asc' },
        select: {
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              panelIndex: true,
              panelNumber: true,
              description: true,
              imagePrompt: true,
              videoPrompt: true,
              duration: true,
              targetDurationMs: true,
              speechPlan: {
                select: {
                  id: true,
                  panelId: true,
                  mode: true,
                  status: true,
                  linesJson: true,
                  voiceConfigJson: true,
                  source: true,
                },
              },
            },
          },
        },
      },
    },
  })
}

function buildRewriteRequests(panels: PanelForDelivery[]): DeliveryRewriteRequest[] {
  return panels.flatMap((panel) => {
    const plan = panel.speechPlan
    if (!plan || plan.mode === 'none') return []

    const lines = readPanelSpeechLines(plan.linesJson)
    const lineCount = Math.max(1, lines.length)
    const targetDurationMs = targetDurationForLine(panel, lineCount)
    const durationMs = readPanelDurationMs(panel)
    return lines.flatMap((line): DeliveryRewriteRequest[] => {
      const originalContent = normalizeSpeechText(line.content)
      if (!line.voiceLineId || !originalContent) return []
      return [{
        requestId: buildRequestId(panel.id, line.voiceLineId),
        panelId: panel.id,
        voiceLineId: line.voiceLineId,
        panelNumber: panel.panelNumber ?? panel.panelIndex + 1,
        panelDescription: panelDescription(panel),
        panelDurationSeconds: Math.round(durationMs / 100) / 10,
        speaker: line.speaker,
        originalContent,
        currentDeliveryContent: normalizeSpeechText(line.deliveryContent || '') || null,
        targetDurationSeconds: Math.round(targetDurationMs / 100) / 10,
        suggestedMaxChineseChars: targetCharsForDuration(targetDurationMs),
      }]
    })
  })
}

async function generateDeliveryRewriteMap(params: {
  projectId: string
  userId: string
  locale: Locale
  requests: DeliveryRewriteRequest[]
}) {
  const modelConfig = await getProjectModelConfig(params.projectId, params.userId)
  if (!modelConfig.analysisModel) {
    throw new DeliveryLinesError(
      DELIVERY_LINES_ERROR.MISSING_ANALYSIS_MODEL,
      '当前项目未配置分析模型，无法生成口播版台词。',
    )
  }

  const chunks = chunkArray(params.requests, DELIVERY_BATCH_SIZE)
  const rewrites = new Map<string, DeliveryRewrite>()
  for (let index = 0; index < chunks.length; index += 1) {
    const completion = await executeAiTextStep({
      userId: params.userId,
      model: modelConfig.analysisModel,
      projectId: params.projectId,
      action: 'delivery_lines_generate',
      temperature: 0.25,
      reasoning: true,
      messages: [{
        role: 'user',
        content: buildDeliveryRewritePrompt({
          requests: chunks[index],
          locale: params.locale,
        }),
      }],
      meta: {
        stepId: 'delivery_lines_generate',
        stepTitle: '生成口播版台词',
        stepIndex: index + 1,
        stepTotal: chunks.length,
      },
    })

    const parsed = parseDeliveryRewrites(completion.text)
    for (const [requestId, rewrite] of parsed) {
      rewrites.set(requestId, rewrite)
    }
  }
  return rewrites
}

function applyDeliveryRewritesToLines(params: {
  panel: PanelForDelivery
  lines: PanelSpeechLine[]
  rewrites: Map<string, DeliveryRewrite>
}) {
  let updatedCount = 0
  const updatedAt = nowIso()
  const lines = params.lines.map((line) => {
    const rewrite = params.rewrites.get(buildRequestId(params.panel.id, line.voiceLineId))
    if (!rewrite) return line
    updatedCount += 1
    return {
      ...line,
      deliveryContent: rewrite.deliveryContent,
      deliveryDurationMs: estimateNarrationDurationMs(rewrite.deliveryContent),
      deliverySource: 'manual_delivery_generation',
      deliveryReason: rewrite.reason,
      deliveryUpdatedAt: updatedAt,
    }
  })
  return { lines, updatedCount }
}

export async function generateEpisodeDeliveryLines(params: {
  projectId: string
  episodeId: string
  userId: string
  locale?: string | null
}): Promise<GenerateEpisodeDeliveryLinesResult> {
  const ensured = await ensureEpisodeSpeechPlans(params.episodeId)
  if (!ensured.available) {
    throw new DeliveryLinesError(
      DELIVERY_LINES_ERROR.DB_SCHEMA_OUT_OF_DATE,
      '数据库结构不是最新版本，缺少镜头级台词计划表。请先执行数据库迁移。',
    )
  }

  const episode = await loadEpisodePanels(params.projectId, params.episodeId)
  if (!episode) {
    throw new DeliveryLinesError(
      DELIVERY_LINES_ERROR.EPISODE_NOT_FOUND,
      '剧集不存在或不属于当前项目。',
    )
  }

  const panels = episode.storyboards.flatMap((storyboard) => storyboard.panels) as PanelForDelivery[]
  const requests = buildRewriteRequests(panels)
  if (requests.length === 0) {
    return {
      episodeId: params.episodeId,
      available: true,
      updatedCount: 0,
      skippedCount: 0,
      totalLines: 0,
    }
  }

  const rewrites = await generateDeliveryRewriteMap({
    projectId: params.projectId,
    userId: params.userId,
    locale: normalizeLocale(params.locale),
    requests,
  })
  if (rewrites.size === 0) {
    throw new DeliveryLinesError(
      DELIVERY_LINES_ERROR.EMPTY_RESPONSE,
      'AI 未返回可用的口播版台词。',
    )
  }

  let updatedCount = 0
  await prisma.$transaction(async (tx) => {
    for (const panel of panels) {
      const plan = panel.speechPlan
      if (!plan || plan.mode === 'none') continue
      const originalLines = readPanelSpeechLines(plan.linesJson)
      const result = applyDeliveryRewritesToLines({
        panel,
        lines: originalLines,
        rewrites,
      })
      if (result.updatedCount === 0) continue

      const payload = buildPanelSpeechPlanPayloadFromLines({
        panel,
        lines: result.lines,
        voiceConfig: readPanelSpeechVoiceConfig(plan.voiceConfigJson),
      })
      await tx.novelPromotionPanelSpeechPlan.update({
        where: { panelId: panel.id },
        data: {
          mode: payload.mode,
          status: payload.status,
          linesJson: asInputJson(payload.lines),
          timingJson: asInputJson(payload.timing),
          warningsJson: asInputJson(payload.warnings),
          source: plan.source || 'manual_delivery_generation',
        },
      })
      updatedCount += result.updatedCount
    }
  }, { timeout: 30000 })

  return {
    episodeId: params.episodeId,
    available: true,
    updatedCount,
    skippedCount: Math.max(0, requests.length - updatedCount),
    totalLines: requests.length,
  }
}

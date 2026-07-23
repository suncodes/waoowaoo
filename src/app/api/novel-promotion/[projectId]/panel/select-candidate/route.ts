import { logInfo as _ulogInfo } from '@/lib/logging/core'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateUniqueKey, downloadAndUploadImage, toFetchableUrl } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import {
  resolveMediaValueToUrl,
  resolveMediaValuesToUrls,
  resolveVisualQualityStateMediaUrls,
} from '@/lib/media/visual-quality-state'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  approveSelectedVisualCandidate,
  parseVisualQualityState,
  resolveVisualCandidateUrls,
} from '@/lib/quality-workflow'

interface PanelHistoryEntry {
  url: string
  timestamp: string
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function parseUnknownArray(jsonValue: string | null): unknown[] {
  if (!jsonValue) return []
  try {
    const parsed = JSON.parse(jsonValue)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePanelHistory(jsonValue: string | null): PanelHistoryEntry[] {
  return parseUnknownArray(jsonValue).filter((entry): entry is PanelHistoryEntry => {
    if (!entry || typeof entry !== 'object') return false
    const candidate = entry as { url?: unknown; timestamp?: unknown }
    return typeof candidate.url === 'string' && typeof candidate.timestamp === 'string'
  })
}

/**
 * POST /api/novel-promotion/[projectId]/panel/select-candidate
 * 统一的候选图片操作 API
 * 
 * action: 'select' - 选择候选图片作为最终图片
 * action: 'cancel' - 取消选择，清空候选列表
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { panelId, selectedImageUrl, action = 'select' } = body

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // === 取消操作 ===
  if (action === 'cancel') {
    await prisma.novelPromotionPanel.update({
      where: { id: panelId },
      data: { candidateImages: null }
    })

    return NextResponse.json({
      success: true,
      message: '已取消选择'
    })
  }

  // === 选择操作 ===
  if (!selectedImageUrl) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取 Panel
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId }
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  // 验证选择的图片是否在候选列表中
  const storedCandidateImages = parseUnknownArray(panel.candidateImages)
  const currentQualityState = parseVisualQualityState(panel.visualQualityState)
  if (
    currentQualityState?.mode === 'auto'
    && (
      currentQualityState.status === 'pending'
      || currentQualityState.status === 'reviewing'
      || currentQualityState.status === 'repairing'
    )
  ) {
    throw new ApiError('CONFLICT', { message: '自动检查或修复尚未完成，暂时不能确认候选图片。' })
  }
  const candidateImages = resolveVisualCandidateUrls({
    visualQualityState: currentQualityState,
    candidateImages: storedCandidateImages,
  })

  const selectedCosKey = await resolveStorageKeyFromMediaValue(selectedImageUrl)
  const candidateKeys = (await Promise.all(candidateImages.map((candidate: unknown) => resolveStorageKeyFromMediaValue(candidate))))
    .filter((k): k is string => !!k)
  const isValidCandidate = !!selectedCosKey && candidateKeys.includes(selectedCosKey)

  if (!isValidCandidate) {
    _ulogInfo(
      `[select-candidate] 选择失败: selectedCosKey=${selectedCosKey}, candidateKeys=${JSON.stringify(candidateKeys)}, candidateImages=${JSON.stringify(candidateImages)}`,
    )
    throw new ApiError('INVALID_PARAMS')
  }

  // 保存当前图片到历史记录
  const currentHistory = parsePanelHistory(panel.imageHistory)
  if (panel.imageUrl) {
    currentHistory.push({
      url: panel.imageUrl,
      timestamp: new Date().toISOString()
    })
  }

  // 选择候选图时优先复用已存在的 COS key，避免重复下载上传（也避免 /m/* 相对URL被 Node fetch 解析失败）
  let finalImageKey = selectedCosKey as string
  const isReusableKey = !finalImageKey.startsWith('http://') && !finalImageKey.startsWith('https://') && !finalImageKey.startsWith('/')

  if (!isReusableKey) {
    const sourceUrl = toFetchableUrl(selectedImageUrl)
    const cosKey = generateUniqueKey(`panel-${panelId}-selected`, 'png')
    finalImageKey = await downloadAndUploadImage(sourceUrl, cosKey)
  }

  const retainedCandidates = candidateImages.filter((candidate): candidate is string => typeof candidate === 'string' && !!candidate)
  const visualQualityState = approveSelectedVisualCandidate(panel.visualQualityState, finalImageKey, retainedCandidates)
  const [displayImageUrl, displayCandidateImages, displayVisualQualityState] = await Promise.all([
    resolveMediaValueToUrl(finalImageKey),
    resolveMediaValuesToUrls(retainedCandidates),
    resolveVisualQualityStateMediaUrls(visualQualityState),
  ])

  // 更新 Panel：设置定稿图片，同时保留候选列表，便于之后切换。
  await prisma.novelPromotionPanel.update({
    where: { id: panelId },
    data: {
      imageUrl: finalImageKey,
      imageHistory: JSON.stringify(currentHistory),
      candidateImages: JSON.stringify(retainedCandidates),
      ...(visualQualityState ? { visualQualityState: asInputJson(visualQualityState) } : {}),
    }
  })

  return NextResponse.json({
    success: true,
    imageUrl: displayImageUrl || finalImageKey,
    cosKey: finalImageKey,
    visualQualityState: displayVisualQualityState,
    candidateImages: displayCandidateImages,
    message: '已选择图片'
  })
})

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { VisualPlanResult, VisualUnit } from '@/lib/visual-planning'
import {
  cloneWorkspaceValue,
  createVisualArtifactMeta,
  readVisualArtifactMeta,
  withVisualArtifactMeta,
  type VisualAnchor,
} from '@/lib/creation-workspace/artifact-state'
import { isWorkspaceClipActive } from '@/lib/creation-workspace/guide-clips'

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function persistVisualPlan(params: {
  episodeId: string
  result: VisualPlanResult
  isBookGuide: boolean
  narratorLabel: string
  anchors?: VisualAnchor[]
  deferStoryboard?: boolean
  storyboardReview?: unknown
}) {
  await prisma.$transaction(async (tx) => {
    const currentEpisode = await tx.novelPromotionEpisode.findUnique({
      where: { id: params.episodeId },
      select: {
        productionBible: true,
        storyboards: {
          select: {
            panels: { select: { videoUrl: true } },
          },
        },
      },
    })
    if (!currentEpisode) throw new Error('Episode not found')
    const now = new Date().toISOString()
    const existingMeta = readVisualArtifactMeta(currentEpisode.productionBible)
    const meta = cloneWorkspaceValue(existingMeta || createVisualArtifactMeta(now, 'ai'))
    meta.status = 'needs_review'
    meta.revision = existingMeta ? existingMeta.revision + 1 : 1
    meta.updatedAt = now
    meta.updatedBy = 'ai'
    meta.anchors = cloneWorkspaceValue(params.anchors || existingMeta?.anchors || [])
    meta.plan = {
      shotPlan: cloneWorkspaceValue(params.result.shotPlan),
      visualUnits: cloneWorkspaceValue(params.result.visualUnits),
      ...(params.storyboardReview !== undefined ? { storyboardReview: cloneWorkspaceValue(params.storyboardReview) } : {}),
    }
    meta.downstream = {
      storyboard: currentEpisode.storyboards.length > 0,
      production: currentEpisode.storyboards.some((storyboard) => storyboard.panels.some((panel) => !!panel.videoUrl)),
    }
    await tx.novelPromotionEpisode.update({
      where: { id: params.episodeId },
      data: {
        directorTreatment: asInputJson(params.result.directorTreatment),
        productionBible: asInputJson(withVisualArtifactMeta(params.result.productionBible, meta)),
      },
    })
    if (!params.isBookGuide || params.deferStoryboard) return
    await materializeGuideStoryboards(tx, params)
  }, { timeout: 30000 })
}

export async function materializeGuideStoryboards(
  tx: Prisma.TransactionClient,
  params: {
    episodeId: string
    result: VisualPlanResult
    narratorLabel: string
  },
) {
  const clips = await tx.novelPromotionClip.findMany({
    where: { episodeId: params.episodeId },
    orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
  })
  const activeClips = clips.filter(isWorkspaceClipActive)
  const unitsByClipId = new Map<string, VisualUnit[]>()
  for (const unit of params.result.visualUnits) {
    const current = unitsByClipId.get(unit.clipId) || []
    current.push(unit)
    unitsByClipId.set(unit.clipId, current)
  }

  const voiceLines: Array<{
    lineIndex: number
    content: string
    panelId: string | null
    storyboardId: string | null
    panelIndex: number | null
  }> = []
  for (let clipIndex = 0; clipIndex < activeClips.length; clipIndex += 1) {
    const clip = activeClips[clipIndex]
    const units = (unitsByClipId.get(clip.id) || []).sort((a, b) => a.panelNumber - b.panelNumber)
    if (units.length === 0) throw new Error(`VISUAL_PLAN_INVALID: clip ${clip.id} has no visual unit`)
    const storyboard = await tx.novelPromotionStoryboard.upsert({
      where: { clipId: clip.id },
      create: {
        clipId: clip.id,
        episodeId: params.episodeId,
        panelCount: units.length,
        storyboardTextJson: JSON.stringify(units),
      },
      update: {
        episodeId: params.episodeId,
        panelCount: units.length,
        storyboardTextJson: JSON.stringify(units),
        lastError: null,
      },
    })
    await tx.novelPromotionPanel.deleteMany({ where: { storyboardId: storyboard.id } })

    let firstPanel: { id: string; panelIndex: number } | null = null
    for (let panelIndex = 0; panelIndex < units.length; panelIndex += 1) {
      const unit = units[panelIndex]
      const assetRefs = Array.isArray(unit.assetRefs) ? unit.assetRefs : []
      const characterNames = assetRefs.filter((item) => item.kind === 'character').map((item) => item.name)
      const locationName = assetRefs.find((item) => item.kind === 'location')?.name || null
      const propNames = assetRefs.filter((item) => item.kind === 'prop').map((item) => item.name)
      const sourceAnchor = unit.sourceAnchor
        ? { ...unit.sourceAnchor, visualAssetIds: assetRefs.map((item) => item.id) }
        : assetRefs.length > 0
          ? { label: clip.summary, visualAssetIds: assetRefs.map((item) => item.id) }
          : undefined
      const created = await tx.novelPromotionPanel.create({
        data: {
          storyboardId: storyboard.id,
          panelIndex,
          panelNumber: unit.panelNumber,
          shotType: unit.shotType,
          cameraMove: unit.cameraMove,
          description: unit.description,
          location: locationName,
          characters: characterNames.length > 0 ? JSON.stringify(characterNames) : null,
          props: propNames.length > 0 ? JSON.stringify(propNames) : null,
          imagePrompt: unit.imagePrompt,
          videoPrompt: unit.videoPrompt,
          srtSegment: clip.content,
          duration: unit.durationSec,
          visualType: unit.visualType,
          renderMode: unit.renderMode,
          onScreenText: unit.onScreenText || null,
          sourceAnchor: sourceAnchor ? asInputJson(sourceAnchor) : undefined,
          sceneType: unit.visualType,
          photographyRules: JSON.stringify({
            shotSpec: unit.shotSpec,
            productionBible: params.result.productionBible,
          }),
        },
        select: { id: true, panelIndex: true },
      })
      firstPanel ||= created
    }
    await tx.novelPromotionClip.update({
      where: { id: clip.id },
      data: { shotCount: units.length },
    })
    voiceLines.push({
      lineIndex: clipIndex + 1,
      content: clip.content,
      panelId: firstPanel?.id || null,
      storyboardId: firstPanel ? storyboard.id : null,
      panelIndex: firstPanel?.panelIndex ?? null,
    })
  }

  for (const line of voiceLines) {
    await tx.novelPromotionVoiceLine.upsert({
      where: {
        episodeId_lineIndex: {
          episodeId: params.episodeId,
          lineIndex: line.lineIndex,
        },
      },
      create: {
        episodeId: params.episodeId,
        lineIndex: line.lineIndex,
        speaker: params.narratorLabel,
        content: line.content,
        emotionStrength: 0.5,
        matchedPanelId: line.panelId,
        matchedStoryboardId: line.storyboardId,
        matchedPanelIndex: line.panelIndex,
      },
      update: {
        speaker: params.narratorLabel,
        content: line.content,
        emotionStrength: 0.5,
        matchedPanelId: line.panelId,
        matchedStoryboardId: line.storyboardId,
        matchedPanelIndex: line.panelIndex,
      },
    })
  }
  await tx.novelPromotionVoiceLine.deleteMany({
    where: {
      episodeId: params.episodeId,
      lineIndex: { notIn: voiceLines.map((line) => line.lineIndex) },
    },
  })
}

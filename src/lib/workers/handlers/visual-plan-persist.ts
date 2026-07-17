import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { VisualPlanResult, VisualUnit } from '@/lib/visual-planning'

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function persistVisualPlan(params: {
  episodeId: string
  result: VisualPlanResult
  isBookGuide: boolean
  narratorLabel: string
}) {
  await prisma.$transaction(async (tx) => {
    await tx.novelPromotionEpisode.update({
      where: { id: params.episodeId },
      data: {
        directorTreatment: asInputJson(params.result.directorTreatment),
        productionBible: asInputJson(params.result.productionBible),
      },
    })
    if (!params.isBookGuide) return
    await persistGuideStoryboards(tx, params)
  }, { timeout: 30000 })
}

async function persistGuideStoryboards(
  tx: Prisma.TransactionClient,
  params: {
    episodeId: string
    result: VisualPlanResult
    narratorLabel: string
  },
) {
  const clips = await tx.novelPromotionClip.findMany({
    where: { episodeId: params.episodeId },
    orderBy: { createdAt: 'asc' },
  })
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
  for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
    const clip = clips[clipIndex]
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
      const created = await tx.novelPromotionPanel.create({
        data: {
          storyboardId: storyboard.id,
          panelIndex,
          panelNumber: unit.panelNumber,
          shotType: unit.shotType,
          cameraMove: unit.cameraMove,
          description: unit.description,
          imagePrompt: unit.imagePrompt,
          videoPrompt: unit.videoPrompt,
          srtSegment: clip.content,
          duration: unit.durationSec,
          visualType: unit.visualType,
          renderMode: unit.renderMode,
          onScreenText: unit.onScreenText || null,
          sourceAnchor: unit.sourceAnchor ? asInputJson(unit.sourceAnchor) : undefined,
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

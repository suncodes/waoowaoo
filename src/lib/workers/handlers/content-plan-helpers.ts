import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ContentPlanResult, GuideContentPlan } from '@/lib/content-planning'

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function persistContentPlan(params: {
  episodeId: string
  result: ContentPlanResult
  commitGuideClips: boolean
}) {
  const { result } = params
  await prisma.$transaction(async (tx) => {
    await tx.novelPromotionEpisode.update({
      where: { id: params.episodeId },
      data: {
        creativeBrief: asInputJson(result.creativeBrief),
        contentPlan: asInputJson(result.contentPlan),
        contentReview: asInputJson(result.contentReview),
      },
    })

    if (result.contentPlan.planType !== 'guide' || !params.commitGuideClips) return
    await replaceGuideClips(tx, params.episodeId, result.contentPlan)
  })
}

async function replaceGuideClips(
  tx: Prisma.TransactionClient,
  episodeId: string,
  plan: GuideContentPlan,
) {
  await tx.novelPromotionClip.deleteMany({ where: { episodeId } })
  let elapsedSec = 0
  for (const segment of plan.segments) {
    const duration = Math.max(1, Math.round(segment.estimatedDurationSec))
    await tx.novelPromotionClip.create({
      data: {
        episodeId,
        start: elapsedSec,
        end: elapsedSec + duration,
        duration,
        summary: segment.title,
        content: segment.narration,
        startText: segment.sourceAnchor.startText || segment.sourceAnchor.quote || segment.sourceAnchor.label,
        endText: segment.sourceAnchor.endText || segment.sourceAnchor.quote || segment.sourceAnchor.label,
        shotCount: 1,
        screenplay: JSON.stringify({
          schemaVersion: 1,
          format: 'guide',
          segmentId: segment.id,
          title: segment.title,
          narration: segment.narration,
          visualPurpose: segment.visualPurpose,
          visualHints: segment.visualHints,
          onScreenText: segment.onScreenText || null,
          sourceAnchor: segment.sourceAnchor,
        }),
      },
    })
    elapsedSec += duration
  }
}

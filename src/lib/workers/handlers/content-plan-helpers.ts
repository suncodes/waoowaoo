import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ContentPlanResult, GuideContentPlan } from '@/lib/content-planning'
import { prepareGeneratedContentPlan } from '@/lib/creation-workspace/content-artifacts'
import { syncGuideClips } from '@/lib/creation-workspace/guide-clips'

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
    const currentEpisode = await tx.novelPromotionEpisode.findUnique({
      where: { id: params.episodeId },
      select: { contentPlan: true },
    })
    if (!currentEpisode) throw new Error('Episode not found')
    const contentPlan = prepareGeneratedContentPlan({
      existingPlan: currentEpisode.contentPlan,
      generatedPlan: result.contentPlan,
      now: new Date().toISOString(),
    })
    await tx.novelPromotionEpisode.update({
      where: { id: params.episodeId },
      data: {
        creativeBrief: asInputJson(result.creativeBrief),
        contentPlan: asInputJson(contentPlan),
        contentReview: asInputJson(result.contentReview),
      },
    })

    if (result.contentPlan.planType !== 'guide' || !params.commitGuideClips) return
    await syncGuideClips(tx, params.episodeId, contentPlan as GuideContentPlan)
  })
}

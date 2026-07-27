import { prisma } from '@/lib/prisma'
import { buildImageBillingPayload } from '@/lib/config-service'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  readBackfillRequests,
  resolvePanelBackfillReadiness,
} from './panel-backfill-readiness'

export async function scheduleReadyBackfilledPanelImageTasks(params: {
  projectId: string
  userId: string
  locale: TaskJobData['locale']
  assetIds: string[]
  storyboardModel: string | null
}) {
  const changedAssetIds = Array.from(new Set(params.assetIds.filter(Boolean)))
  if (changedAssetIds.length === 0 || !params.storyboardModel) return []

  const panels = await prisma.novelPromotionPanel.findMany({
    where: {
      generationRoute: { in: ['asset_backfill', 'human_required'] },
      storyboard: {
        episode: {
          novelPromotionProject: {
            projectId: params.projectId,
          },
        },
      },
    },
    select: {
      id: true,
      referencePlan: true,
      storyboard: { select: { episodeId: true } },
    },
  })

  const scheduled: string[] = []
  for (const panel of panels) {
    const panelBackfillAssetIds = readBackfillRequests(panel.referencePlan)
      .flatMap((request) => request.assetId ? [request.assetId] : [])
    if (!panelBackfillAssetIds.some((assetId) => changedAssetIds.includes(assetId))) continue

    const readiness = await resolvePanelBackfillReadiness(panel.referencePlan)
    if (!readiness.ready) continue

    const stableBackfillAssetIds = Array.from(new Set(panelBackfillAssetIds)).sort()
    const payloadBase = {
      panelId: panel.id,
      candidateCount: 1,
      count: 1,
      source: 'asset_backfill_resume',
      backfillAssetIds: stableBackfillAssetIds,
    }
    const billingPayload = await buildImageBillingPayload({
      projectId: params.projectId,
      userId: params.userId,
      imageModel: params.storyboardModel,
      basePayload: payloadBase,
    })
    const submitted = await submitTask({
      userId: params.userId,
      locale: params.locale,
      projectId: params.projectId,
      episodeId: panel.storyboard.episodeId,
      type: TASK_TYPE.IMAGE_PANEL,
      targetType: 'NovelPromotionPanel',
      targetId: panel.id,
      payload: withTaskUiPayload(billingPayload, {
        intent: 'generate',
        source: 'asset_backfill_resume',
      }),
      dedupeKey: `image_panel:${panel.id}:asset_backfill:${stableBackfillAssetIds.join(',')}`,
    })
    scheduled.push(submitted.taskId)
  }
  return scheduled
}

import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { preparePanelGenerationPrompt } from '@/lib/novel-promotion/panel-prompt-preparation'
import {
  readBackfillRequests,
  resolvePanelBackfillReadiness,
} from './panel-backfill-readiness'

export type BackfilledPanelPromptPreparationResult = {
  prepared: Array<{
    panelId: string
    artifactId: string
  }>
  failed: Array<{
    panelId: string
    message: string
  }>
}

export async function prepareReadyBackfilledPanelPrompts(params: {
  projectId: string
  userId: string
  locale: TaskJobData['locale']
  assetIds: string[]
  storyboardModel: string | null
}): Promise<BackfilledPanelPromptPreparationResult> {
  const result: BackfilledPanelPromptPreparationResult = { prepared: [], failed: [] }
  const changedAssetIds = Array.from(new Set(params.assetIds.filter(Boolean)))
  if (changedAssetIds.length === 0 || !params.storyboardModel) return result

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
    },
  })

  for (const panel of panels) {
    const panelBackfillAssetIds = readBackfillRequests(panel.referencePlan)
      .flatMap((request) => request.assetId ? [request.assetId] : [])
    if (!panelBackfillAssetIds.some((assetId) => changedAssetIds.includes(assetId))) continue

    const readiness = await resolvePanelBackfillReadiness(panel.referencePlan)
    if (!readiness.ready) continue

    try {
      const preparation = await preparePanelGenerationPrompt({
        projectId: params.projectId,
        userId: params.userId,
        locale: params.locale,
        mode: 'image',
        locator: { panelId: panel.id },
      })
      result.prepared.push({
        panelId: panel.id,
        artifactId: preparation.prepared.artifactId,
      })
    } catch (error) {
      result.failed.push({
        panelId: panel.id,
        message: error instanceof Error ? error.message : '分镜提示词固定失败',
      })
    }
  }
  return result
}

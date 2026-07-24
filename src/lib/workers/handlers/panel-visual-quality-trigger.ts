import type { Prisma } from '@prisma/client'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { createVisualCandidateGroup, createVisualQualityState } from '@/lib/quality-workflow'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { resolveVideoProfile } from '@/lib/video-profile'
import { assertVisionInputSupported, createVisualVersionHash } from '@/lib/visual-quality'
import { getProjectModels } from '@/lib/workers/utils'
import { buildPanelImageTargetSpec } from './visual-quality-review-helpers'

type PanelCandidateTarget = {
  id: string
  storyboardId: string
  imageUrl: string | null
  previousImageUrl: string | null
  description: string | null
  imagePrompt: string | null
  shotType: string | null
  cameraMove: string | null
  location: string | null
  characters: string | null
  props: string | null
  visualType: string | null
  renderMode: string | null
  onScreenText: string | null
  linkedToNextPanel: boolean
  sourceAnchor?: unknown
  photographyRules?: unknown
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function persistPanelCandidatesAndScheduleReview(params: {
  job: Job<TaskJobData>
  panel: PanelCandidateTarget
  candidates: string[]
  isFirstGeneration: boolean
}) {
  const [novelData, storyboard, modelConfig] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { projectId: params.job.data.projectId },
      select: {
        videoProfile: true,
        videoRatio: true,
        artStyle: true,
        artStylePrompt: true,
      },
    }),
    prisma.novelPromotionStoryboard.findUnique({
      where: { id: params.panel.storyboardId },
      select: {
        episodeId: true,
        episode: { select: { productionBible: true } },
      },
    }),
    getProjectModels(params.job.data.projectId, params.job.data.userId),
  ])
  if (!novelData || !storyboard) throw new Error('Panel quality context not found')
  const profile = resolveVideoProfile(novelData.videoProfile)
  const mode = params.panel.linkedToNextPanel ? 'shadow' : profile.qualityPolicy.mode
  const targetSpec = buildPanelImageTargetSpec({
    panel: params.panel,
    aspectRatio: novelData.videoRatio,
    artStyle: novelData.artStylePrompt || novelData.artStyle,
    productionBible: storyboard.episode.productionBible,
  })
  const versionHash = createVisualVersionHash({ targetSpec, candidateUrls: params.candidates })
  const candidateGroups = [
    createVisualCandidateGroup({
      versionHash,
      origin: 'initial',
      attempt: 0,
      candidateUrls: params.candidates,
    }),
  ]
  const baseState = createVisualQualityState({
    mode,
    status: 'pending',
    versionHash,
    candidateUrls: params.candidates,
    candidateGroups,
    activeCandidateUrl: params.panel.imageUrl,
    maxAttempts: profile.qualityPolicy.maxRepairAttempts,
  })
  const keepCurrentImage = mode === 'auto'
  await prisma.novelPromotionPanel.update({
    where: { id: params.panel.id },
    data: {
      ...(!keepCurrentImage && params.isFirstGeneration ? {
        imageUrl: params.candidates[0] || null,
      } : {}),
      ...(!keepCurrentImage && !params.isFirstGeneration ? {
        previousImageUrl: params.panel.imageUrl,
      } : {}),
      candidateImages: params.candidates.length > 1 || keepCurrentImage
        ? JSON.stringify(params.candidates)
        : null,
      visualQualityState: asInputJson(baseState),
    },
  })

  try {
    if (!modelConfig.analysisModel) throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED')
    assertVisionInputSupported(modelConfig.analysisModel)
    const result = await submitTask({
      userId: params.job.data.userId,
      locale: params.job.data.locale,
      projectId: params.job.data.projectId,
      episodeId: storyboard.episodeId,
      type: TASK_TYPE.VISUAL_QUALITY_REVIEW,
      targetType: 'NovelPromotionPanel',
      targetId: params.panel.id,
      payload: {
        panelId: params.panel.id,
        candidateUrls: params.candidates,
        versionHash,
        analysisModel: modelConfig.analysisModel,
      },
      dedupeKey: `visual_quality_review:${params.panel.id}:${versionHash}`,
    })
    return {
      reviewScheduled: true,
      reviewTaskId: result.taskId,
      mode,
      versionHash,
      imageUrl: keepCurrentImage ? null : params.candidates[0] || null,
    }
  } catch {
    const fallbackImageUrl = params.panel.imageUrl || params.candidates[0] || null
    await prisma.novelPromotionPanel.update({
      where: { id: params.panel.id },
      data: {
        imageUrl: fallbackImageUrl,
        visualQualityState: asInputJson(createVisualQualityState({
          ...baseState,
          status: 'failed',
          activeCandidateUrl: fallbackImageUrl,
        })),
      },
    })
    return {
      reviewScheduled: false,
      reviewTaskId: null,
      mode,
      versionHash,
      imageUrl: fallbackImageUrl,
    }
  }
}

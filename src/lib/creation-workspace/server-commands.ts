import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseContentPlan, type ContentPlan, type GuideContentPlan } from '@/lib/content-planning'
import { isBookGuideProfile, resolveVideoProfile } from '@/lib/video-profile'
import {
  asWorkspaceRecord,
  cloneWorkspaceValue,
  createVisualArtifactMeta,
  readContentArtifactMeta,
  readVisualArtifactMeta,
  withContentArtifactMeta,
  withVisualArtifactMeta,
  type VisualArtifactMeta,
  type WorkspaceImpactSummary,
} from './artifact-state'
import {
  approveContentArtifact,
  clearContentUnitCandidate,
  markExternalContentUnitEdited,
  prepareEditedContentPlan,
  readGuideSegment,
  setContentUnitLock,
} from './content-artifacts'
import { getGuideClipSegmentId, syncGuideClips } from './guide-clips'
import type { WorkspaceArtifactCommand, WorkspaceArtifactCommandResult } from './commands'
import { materializeGuideStoryboards } from '@/lib/workers/handlers/visual-plan-persist'
import { parseVisualPlanResult } from '@/lib/visual-planning'

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function nowIso() {
  return new Date().toISOString()
}

function invalid(message: string): never {
  throw new Error(`WORKSPACE_COMMAND_INVALID:${message}`)
}

async function calculateImpact(
  tx: Prisma.TransactionClient,
  episodeId: string,
  sourceUnitIds: string[],
): Promise<WorkspaceImpactSummary> {
  const targetIds = new Set(sourceUnitIds)
  const clips = await tx.novelPromotionClip.findMany({
    where: { episodeId },
    select: {
      id: true,
      screenplay: true,
      storyboard: {
        select: {
          id: true,
          panels: { select: { id: true, videoUrl: true } },
        },
      },
    },
  })
  const affectedClips = clips.filter((clip) => {
    const segmentId = getGuideClipSegmentId(clip)
    return targetIds.has(clip.id) || (!!segmentId && targetIds.has(segmentId))
  })
  const storyboards = affectedClips.flatMap((clip) => clip.storyboard ? [clip.storyboard] : [])
  const panels = storyboards.flatMap((storyboard) => storyboard.panels)
  return {
    sourceUnitIds: [...targetIds],
    affectedStageIds: ['visual-design', 'storyboard-preview', 'production'],
    storyboardCount: storyboards.length,
    panelCount: panels.length,
    videoCount: panels.filter((panel) => !!panel.videoUrl).length,
    createdAt: nowIso(),
  }
}

function markVisualArtifactStale(productionBible: unknown, impact: WorkspaceImpactSummary): unknown {
  if (!productionBible) return productionBible
  const now = nowIso()
  const meta = cloneWorkspaceValue(
    readVisualArtifactMeta(productionBible) || createVisualArtifactMeta(now, 'user'),
  )
  meta.status = 'stale'
  meta.updatedAt = now
  meta.updatedBy = 'user'
  meta.latestImpact = cloneWorkspaceValue(impact)
  meta.downstream = {
    storyboard: true,
    production: true,
  }
  return withVisualArtifactMeta(productionBible, meta)
}

function assertGuidePlan(plan: ContentPlan): asserts plan is GuideContentPlan {
  if (plan.planType !== 'guide') invalid('guide content plan required')
}

function replaceGuideSegment(plan: GuideContentPlan, unitId: string, value: unknown): GuideContentPlan {
  const segment = asWorkspaceRecord(value)
  if (!segment) invalid('guide segment candidate is invalid')
  const next = cloneWorkspaceValue(plan)
  const index = next.segments.findIndex((item) => item.id === unitId)
  const nextSegment = {
    ...(index >= 0 ? next.segments[index] : {}),
    ...cloneWorkspaceValue(segment),
    id: unitId,
  }
  if (index >= 0) next.segments[index] = nextSegment as GuideContentPlan['segments'][number]
  else next.segments.push(nextSegment as GuideContentPlan['segments'][number])
  return next
}

function scriptClipSnapshot(clip: {
  id: string
  summary: string
  content: string
  screenplay: string | null
  characters: string | null
  location: string | null
  props: string | null
}) {
  return {
    id: clip.id,
    summary: clip.summary,
    content: clip.content,
    screenplay: clip.screenplay,
    characters: clip.characters,
    location: clip.location,
    props: clip.props,
  }
}

function readClipCandidate(value: unknown) {
  const candidate = asWorkspaceRecord(value)
  if (!candidate) invalid('script candidate is invalid')
  return {
    ...(typeof candidate.summary === 'string' ? { summary: candidate.summary } : {}),
    ...(typeof candidate.content === 'string' ? { content: candidate.content } : {}),
    ...(typeof candidate.screenplay === 'string'
      ? { screenplay: candidate.screenplay }
      : candidate.screenplay && typeof candidate.screenplay === 'object'
        ? { screenplay: JSON.stringify(candidate.screenplay) }
        : {}),
    ...(candidate.characters === null || typeof candidate.characters === 'string'
      ? { characters: candidate.characters }
      : {}),
    ...(candidate.location === null || typeof candidate.location === 'string'
      ? { location: candidate.location }
      : {}),
    ...(candidate.props === null || typeof candidate.props === 'string'
      ? { props: candidate.props }
      : {}),
  }
}

async function saveGuidePlan(params: {
  tx: Prisma.TransactionClient
  episodeId: string
  profileValue: unknown
  planValue: unknown
  changedUnitIds: string[]
}) {
  const episode = await params.tx.novelPromotionEpisode.findUnique({
    where: { id: params.episodeId },
    select: { contentPlan: true, productionBible: true },
  })
  if (!episode?.contentPlan) invalid('content plan not found')
  const profile = resolveVideoProfile(params.profileValue)
  const nextPlan = parseContentPlan(params.planValue, profile)
  assertGuidePlan(nextPlan)
  const changedUnitIds = [...new Set(params.changedUnitIds.filter(Boolean))]
  if (changedUnitIds.length === 0) invalid('changed unit ids required')
  const impact = await calculateImpact(params.tx, params.episodeId, changedUnitIds)
  const contentPlan = prepareEditedContentPlan({
    existingPlan: episode.contentPlan,
    nextPlan,
    changedUnitIds,
    impact,
    now: nowIso(),
  })
  await syncGuideClips(params.tx, params.episodeId, contentPlan as GuideContentPlan)
  await params.tx.novelPromotionEpisode.update({
    where: { id: params.episodeId },
    data: {
      contentPlan: asInputJson(contentPlan),
      productionBible: episode.productionBible
        ? asInputJson(markVisualArtifactStale(episode.productionBible, impact))
        : undefined,
    },
  })
  return impact
}

function selectedCharacterIds(project: {
  characters: Array<{
    id: string
    appearances: Array<{ imageUrl: string | null; imageUrls: string | null; selectedIndex: number | null }>
  }>
}) {
  return new Set(project.characters.flatMap((character) => (
    character.appearances.some((appearance) => (
      appearance.selectedIndex !== null
      && (!!appearance.imageUrl || !!appearance.imageUrls)
    ))
      ? [character.id]
      : []
  )))
}

function selectedLocationIds(project: {
  locations: Array<{
    id: string
    selectedImageId: string | null
    images: Array<{ imageUrl: string | null; isSelected: boolean }>
  }>
}) {
  return new Set(project.locations.flatMap((location) => (
    location.selectedImageId || location.images.some((image) => image.isSelected && !!image.imageUrl)
      ? [location.id]
      : []
  )))
}

async function approveVisualStage(params: {
  tx: Prisma.TransactionClient
  projectId: string
  episodeId: string
}) {
  const project = await params.tx.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
    include: {
      characters: { include: { appearances: true } },
      locations: { include: { images: true } },
    },
  })
  const episode = await params.tx.novelPromotionEpisode.findUnique({
    where: { id: params.episodeId },
    select: {
      contentPlan: true,
      directorTreatment: true,
      productionBible: true,
    },
  })
  if (!project || !episode) invalid('project or episode not found')
  if (readContentArtifactMeta(episode.contentPlan)?.status !== 'approved') {
    invalid('content must be approved first')
  }
  if (!episode.directorTreatment || !episode.productionBible) invalid('visual plan not found')
  const meta = readVisualArtifactMeta(episode.productionBible)
  if (!meta?.plan) invalid('visual plan details not found')
  const readyCharacterIds = selectedCharacterIds(project)
  const readyLocationIds = selectedLocationIds(project)
  const missingCoreAssets = meta.anchors
    .filter((anchor) => anchor.importance === 'core')
    .filter((anchor) => anchor.assetKind === 'character'
      ? !readyCharacterIds.has(anchor.assetId)
      : !readyLocationIds.has(anchor.assetId))
    .map((anchor) => anchor.name)
  if (missingCoreAssets.length > 0) {
    invalid(`core assets require confirmation:${missingCoreAssets.join(',')}`)
  }
  const now = nowIso()
  const nextMeta: VisualArtifactMeta = {
    ...cloneWorkspaceValue(meta),
    status: 'approved',
    approvedRevision: meta.revision,
    updatedAt: now,
    updatedBy: 'user',
  }
  await params.tx.novelPromotionEpisode.update({
    where: { id: params.episodeId },
    data: {
      productionBible: asInputJson(withVisualArtifactMeta(episode.productionBible, nextMeta)),
    },
  })
}

async function materializeStoredVisualPlan(params: {
  tx: Prisma.TransactionClient
  episodeId: string
  narratorLabel: string
  profileValue: unknown
}) {
  const episode = await params.tx.novelPromotionEpisode.findUnique({
    where: { id: params.episodeId },
    select: {
      contentPlan: true,
      directorTreatment: true,
      productionBible: true,
      clips: { select: { id: true } },
    },
  })
  if (!episode?.directorTreatment || !episode.productionBible) invalid('visual plan not found')
  const meta = readVisualArtifactMeta(episode.productionBible)
  if (!meta?.plan || meta.status !== 'approved') invalid('visual plan must be approved first')
  const productionBible = asWorkspaceRecord(cloneWorkspaceValue(episode.productionBible)) || {}
  delete productionBible._workspace
  const result = parseVisualPlanResult({
    directorTreatment: episode.directorTreatment,
    productionBible,
    shotPlan: meta.plan.shotPlan,
    visualUnits: meta.plan.visualUnits,
  }, resolveVideoProfile(params.profileValue), episode.clips.map((clip) => clip.id))
  await materializeGuideStoryboards(params.tx, {
    episodeId: params.episodeId,
    result,
    narratorLabel: params.narratorLabel,
  })
  const nextMeta = cloneWorkspaceValue(meta)
  nextMeta.downstream.storyboard = false
  nextMeta.updatedAt = nowIso()
  const contentMeta = readContentArtifactMeta(episode.contentPlan)
  const contentPlan = contentMeta
    ? withContentArtifactMeta(episode.contentPlan, {
        ...cloneWorkspaceValue(contentMeta),
        downstream: {
          ...contentMeta.downstream,
          storyboard: false,
        },
      })
    : episode.contentPlan
  await params.tx.novelPromotionEpisode.update({
    where: { id: params.episodeId },
    data: {
      contentPlan: contentPlan ? asInputJson(contentPlan) : undefined,
      productionBible: asInputJson(withVisualArtifactMeta(episode.productionBible, nextMeta)),
    },
  })
  return params.tx.novelPromotionStoryboard.count({ where: { episodeId: params.episodeId } })
}

export async function executeWorkspaceArtifactCommand(params: {
  projectId: string
  episodeId: string
  command: WorkspaceArtifactCommand
  locale?: string
}): Promise<WorkspaceArtifactCommandResult> {
  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
    select: { id: true, videoProfile: true },
  })
  if (!project) invalid('project not found')
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: params.episodeId },
    select: { novelPromotionProjectId: true },
  })
  if (!episode || episode.novelPromotionProjectId !== project.id) invalid('episode not found')

  return prisma.$transaction(async (tx) => {
    if (params.command.type === 'save_guide_plan') {
      const impact = await saveGuidePlan({
        tx,
        episodeId: params.episodeId,
        profileValue: project.videoProfile,
        planValue: params.command.plan,
        changedUnitIds: params.command.changedUnitIds,
      })
      return { success: true, impact }
    }

    const current = await tx.novelPromotionEpisode.findUnique({
      where: { id: params.episodeId },
      select: { contentPlan: true, productionBible: true },
    })
    if (!current?.contentPlan) invalid('content plan not found')

    if (params.command.type === 'toggle_content_lock') {
      const contentPlan = setContentUnitLock({
        contentPlan: current.contentPlan,
        unitId: params.command.unitId,
        locked: params.command.locked,
        now: nowIso(),
      })
      await tx.novelPromotionEpisode.update({
        where: { id: params.episodeId },
        data: { contentPlan: asInputJson(contentPlan) },
      })
      return { success: true }
    }

    if (params.command.type === 'discard_content_candidate') {
      await tx.novelPromotionEpisode.update({
        where: { id: params.episodeId },
        data: {
          contentPlan: asInputJson(clearContentUnitCandidate(
            current.contentPlan,
            params.command.unitId,
            nowIso(),
          )),
        },
      })
      return { success: true }
    }

    if (params.command.type === 'approve_stage') {
      if (params.command.stageId === 'content') {
        const profile = resolveVideoProfile(project.videoProfile)
        if (!isBookGuideProfile(profile)) {
          const clips = await tx.novelPromotionClip.findMany({
            where: { episodeId: params.episodeId },
            select: { screenplay: true },
          })
          if (clips.length === 0 || clips.some((clip) => (
            typeof clip.screenplay !== 'string' || !clip.screenplay.trim()
          ))) {
            invalid('script must be completed before content approval')
          }
        }
        await tx.novelPromotionEpisode.update({
          where: { id: params.episodeId },
          data: { contentPlan: asInputJson(approveContentArtifact(current.contentPlan, nowIso())) },
        })
      } else {
        await approveVisualStage({ tx, projectId: params.projectId, episodeId: params.episodeId })
      }
      return { success: true }
    }

    if (params.command.type === 'materialize_guide_storyboard') {
      const storyboardCount = await materializeStoredVisualPlan({
        tx,
        episodeId: params.episodeId,
        narratorLabel: params.locale?.toLowerCase().startsWith('en') ? 'Narrator' : '旁白',
        profileValue: project.videoProfile,
      })
      return { success: true, storyboardCount }
    }

    const meta = readContentArtifactMeta(current.contentPlan)
    const unitState = meta?.units[params.command.unitId]
    const snapshot = params.command.type === 'accept_content_candidate'
      ? unitState?.candidate
      : unitState?.previous
    if (!snapshot) invalid('requested content version not found')
    const impact = await calculateImpact(tx, params.episodeId, [params.command.unitId])

    if (snapshot.kind === 'guide_segment') {
      const profile = resolveVideoProfile(project.videoProfile)
      const plan = parseContentPlan(current.contentPlan, profile)
      assertGuidePlan(plan)
      const nextPlan = replaceGuideSegment(plan, params.command.unitId, snapshot.value)
      const contentPlan = prepareEditedContentPlan({
        existingPlan: current.contentPlan,
        nextPlan,
        changedUnitIds: [params.command.unitId],
        impact,
        now: nowIso(),
      })
      await syncGuideClips(tx, params.episodeId, contentPlan as GuideContentPlan)
      await tx.novelPromotionEpisode.update({
        where: { id: params.episodeId },
        data: {
          contentPlan: asInputJson(contentPlan),
          productionBible: current.productionBible
            ? asInputJson(markVisualArtifactStale(current.productionBible, impact))
            : undefined,
        },
      })
      return { success: true, impact }
    }

    const clip = await tx.novelPromotionClip.findUnique({
      where: { id: params.command.unitId },
    })
    if (!clip || clip.episodeId !== params.episodeId) invalid('script clip not found')
    const updates = readClipCandidate(snapshot.value)
    const contentPlan = markExternalContentUnitEdited({
      contentPlan: current.contentPlan,
      unitId: clip.id,
      kind: 'script_clip',
      previousValue: scriptClipSnapshot(clip),
      impact,
      now: nowIso(),
    })
    await tx.novelPromotionClip.update({ where: { id: clip.id }, data: updates })
    await tx.novelPromotionEpisode.update({
      where: { id: params.episodeId },
      data: {
        contentPlan: asInputJson(contentPlan),
        productionBible: current.productionBible
          ? asInputJson(markVisualArtifactStale(current.productionBible, impact))
          : undefined,
      },
    })
    return { success: true, impact }
  }, { timeout: 30000 })
}

export async function updateWorkspaceScriptClip(params: {
  projectId: string
  clipId: string
  updates: Record<string, unknown>
}) {
  return prisma.$transaction(async (tx) => {
    const clip = await tx.novelPromotionClip.findUnique({
      where: { id: params.clipId },
      include: {
        episode: {
          select: {
            id: true,
            contentPlan: true,
            productionBible: true,
            novelPromotionProject: { select: { projectId: true } },
          },
        },
      },
    })
    if (!clip || clip.episode.novelPromotionProject.projectId !== params.projectId) {
      invalid('script clip not found')
    }
    const allowedKeys = ['summary', 'content', 'screenplay', 'characters', 'location', 'props'] as const
    const data: Record<string, string | null> = {}
    for (const key of allowedKeys) {
      const value = params.updates[key]
      if (value === undefined) continue
      if (value !== null && typeof value !== 'string') invalid(`invalid clip field:${key}`)
      data[key] = value
    }
    if (Object.keys(data).length === 0) invalid('no clip fields to update')
    const impact = await calculateImpact(tx, clip.episode.id, [clip.id])
    const contentPlan = markExternalContentUnitEdited({
      contentPlan: clip.episode.contentPlan,
      unitId: clip.id,
      kind: 'script_clip',
      previousValue: scriptClipSnapshot(clip),
      impact,
      now: nowIso(),
    })
    const updated = await tx.novelPromotionClip.update({
      where: { id: clip.id },
      data,
    })
    await tx.novelPromotionEpisode.update({
      where: { id: clip.episode.id },
      data: {
        contentPlan: asInputJson(contentPlan),
        productionBible: clip.episode.productionBible
          ? asInputJson(markVisualArtifactStale(clip.episode.productionBible, impact))
          : undefined,
      },
    })
    return updated
  })
}

export function getContentUnitVersionState(contentPlan: unknown, unitId: string) {
  return readContentArtifactMeta(contentPlan)?.units[unitId] || null
}

export function getGuideContentUnit(contentPlan: unknown, unitId: string) {
  return readGuideSegment(contentPlan, unitId)
}

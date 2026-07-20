import type { Job } from 'bullmq'
import { safeParseJsonObject } from '@/lib/json-repair'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { removeLocationPromptSuffix } from '@/lib/constants'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { seedProjectLocationBackedImageSlots } from '@/lib/assets/services/location-backed-assets'
import { normalizeLocationAvailableSlots } from '@/lib/location-available-slots'
import { resolvePropVisualDescription } from '@/lib/assets/prop-description'
import {
  bindStoredVisualUnitsToAnchors,
  buildVisualAnchors,
} from '@/lib/creation-workspace/visual-anchors'
import {
  cloneWorkspaceValue,
  createVisualArtifactMeta,
  readVisualArtifactMeta,
  stripWorkspaceArtifactMeta,
  withVisualArtifactMeta,
} from '@/lib/creation-workspace/artifact-state'
import { markContentAssetRequirementsAnalyzed } from '@/lib/creation-workspace/content-artifacts'
import type { Prisma } from '@prisma/client'

function readAssetKind(value: Record<string, unknown>): string {
  return typeof value.assetKind === 'string' ? value.assetKind : 'location'
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

/** 按别名匹配：按 '/' 拆分后任一别名精确匹配即为命中 */
function nameMatchesWithAlias(existingName: string, newName: string): boolean {
  const a = existingName.toLowerCase().trim()
  const b = newName.toLowerCase().trim()
  if (a === b) return true
  const aliasesA = a.split('/').map(s => s.trim()).filter(Boolean)
  const aliasesB = b.split('/').map(s => s.trim()).filter(Boolean)
  return aliasesB.some(alias => aliasesA.includes(alias))
}

function parseJsonResponse(responseText: string): Record<string, unknown> {
  return safeParseJsonObject(responseText)
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function syncEpisodeVisualAnchors(params: {
  projectInternalId: string
  episodeId: string
  includeAssetIds: string[]
}) {
  const [projectAssets, episode] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { id: params.projectInternalId },
      include: {
        characters: { select: { id: true, name: true, introduction: true } },
        locations: { select: { id: true, name: true, summary: true, assetKind: true } },
      },
    }),
    prisma.novelPromotionEpisode.findUnique({
      where: { id: params.episodeId },
      select: {
        contentPlan: true,
        productionBible: true,
        clips: {
          orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            summary: true,
            content: true,
            screenplay: true,
            characters: true,
            location: true,
            props: true,
          },
        },
      },
    }),
  ])
  if (!projectAssets || !episode?.contentPlan) return

  const anchors = buildVisualAnchors({
    contentPlan: episode.contentPlan,
    clips: episode.clips,
    characters: projectAssets.characters,
    locations: projectAssets.locations,
    includeAssetIds: params.includeAssetIds,
  })
  const now = new Date().toISOString()
  const contentPlan = markContentAssetRequirementsAnalyzed({
    contentPlan: episode.contentPlan,
    assetIds: anchors.map((anchor) => anchor.assetId),
    now,
  })
  let productionBible = episode.productionBible
  if (productionBible) {
    const existingMeta = readVisualArtifactMeta(productionBible)
    const meta = cloneWorkspaceValue(existingMeta || createVisualArtifactMeta(now, 'ai'))
    meta.anchors = anchors
    if (meta.plan) {
      meta.plan.visualUnits = bindStoredVisualUnitsToAnchors(meta.plan.visualUnits, anchors)
    }
    meta.status = existingMeta?.status === 'stale' ? 'stale' : 'needs_review'
    meta.revision = existingMeta ? existingMeta.revision + 1 : 1
    meta.updatedAt = now
    meta.updatedBy = 'ai'
    productionBible = withVisualArtifactMeta(productionBible, meta)
  }
  await prisma.novelPromotionEpisode.update({
    where: { id: params.episodeId },
    data: {
      contentPlan: asInputJson(contentPlan),
      ...(productionBible ? { productionBible: asInputJson(productionBible) } : {}),
    },
  })
}

export async function handleAnalyzeNovelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const projectId = job.data.projectId

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      locations: true,
    },
  })
  if (!novelData) {
    throw new Error('Novel promotion data not found')
  }
  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelData.analysisModel,
  })

  const requestedEpisodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const targetEpisode = requestedEpisodeId
    ? await prisma.novelPromotionEpisode.findUnique({
        where: { id: requestedEpisodeId },
        select: {
          id: true,
          novelPromotionProjectId: true,
          novelText: true,
          contentPlan: true,
          productionBible: true,
          clips: {
            orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              summary: true,
              content: true,
              screenplay: true,
              characters: true,
              location: true,
              props: true,
            },
          },
        },
      })
    : await prisma.novelPromotionEpisode.findFirst({
        where: { novelPromotionProjectId: novelData.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          novelPromotionProjectId: true,
          novelText: true,
          contentPlan: true,
          productionBible: true,
          clips: {
            orderBy: [{ start: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              summary: true,
              content: true,
              screenplay: true,
              characters: true,
              location: true,
              props: true,
            },
          },
        },
      })
  if (requestedEpisodeId && (!targetEpisode || targetEpisode.novelPromotionProjectId !== novelData.id)) {
    throw new Error('Episode not found')
  }

  const analysisSources: string[] = []
  if (readText(targetEpisode?.novelText)) {
    analysisSources.push(`【当前内容】\n${readText(targetEpisode?.novelText)}`)
  }
  if (targetEpisode?.contentPlan) {
    analysisSources.push(`【内容结构与画面提示】\n${JSON.stringify(stripWorkspaceArtifactMeta(targetEpisode.contentPlan), null, 2)}`)
  }
  if (targetEpisode?.clips?.length) {
    analysisSources.push(`【当前剧本文稿】\n${JSON.stringify(targetEpisode.clips, null, 2)}`)
  }
  if (readText(novelData.globalAssetText)) {
    analysisSources.push(`【全局设定】\n${readText(novelData.globalAssetText)}`)
  }

  let contentToAnalyze = analysisSources.join('\n\n')
  if (!contentToAnalyze.trim()) {
    throw new Error('请先填写全局资产设定或剧本内容')
  }

  const maxContentLength = 30000
  if (contentToAnalyze.length > maxContentLength) {
    contentToAnalyze = contentToAnalyze.substring(0, maxContentLength)
  }

  const charactersLibName = (novelData.characters || []).map((item) => item.name).join(', ')
  const locationsLibName = (novelData.locations || [])
    .filter((item) => readAssetKind(item as unknown as Record<string, unknown>) !== 'prop')
    .map((item) => item.name)
    .join(', ')
  const propsLibName = (novelData.locations || [])
    .filter((item) => readAssetKind(item as unknown as Record<string, unknown>) === 'prop')
    .map((item) => item.name)
    .join(', ')
  const characterPromptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_CHARACTER_PROFILE,
    locale: job.data.locale,
    variables: {
      input: contentToAnalyze,
      characters_lib_info: charactersLibName || '无',
    },
  })
  const locationPromptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_SELECT_LOCATION,
    locale: job.data.locale,
    variables: {
      input: contentToAnalyze,
      locations_lib_name: locationsLibName || '无',
    },
  })
  const propPromptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_SELECT_PROP,
    locale: job.data.locale,
    variables: {
      input: contentToAnalyze,
      props_lib_name: propsLibName || '无',
    },
  })

  await reportTaskProgress(job, 20, {
    stage: 'analyze_novel_prepare',
    stageLabel: '准备资产分析参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'analyze_novel_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'analyze_novel')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const [characterCompletion, locationCompletion, propCompletion] = await (async () => {
    try {
      return await withInternalLLMStreamCallbacks(
        streamCallbacks,
        async () =>
          await Promise.all([
            executeAiTextStep({
              userId: job.data.userId,
              model: analysisModel,
              messages: [{ role: 'user', content: characterPromptTemplate }],
              temperature: 0.7,
              projectId,
              action: 'analyze_characters',
              meta: {
                stepId: 'analyze_characters',
                stepTitle: '角色分析',
                stepIndex: 1,
                stepTotal: 3,
              },
            }),
            executeAiTextStep({
              userId: job.data.userId,
              model: analysisModel,
              messages: [{ role: 'user', content: locationPromptTemplate }],
              temperature: 0.7,
              projectId,
              action: 'analyze_locations',
              meta: {
                stepId: 'analyze_locations',
                stepTitle: '场景分析',
                stepIndex: 2,
                stepTotal: 3,
              },
            }),
            executeAiTextStep({
              userId: job.data.userId,
              model: analysisModel,
              messages: [{ role: 'user', content: propPromptTemplate }],
              temperature: 0.7,
              projectId,
              action: 'analyze_props',
              meta: {
                stepId: 'analyze_props',
                stepTitle: '道具分析',
                stepIndex: 3,
                stepTotal: 3,
              },
            }),
          ]),
      )
    } finally {
      await streamCallbacks.flush()
    }
  })()

  const characterResponseText = characterCompletion.text
  const locationResponseText = locationCompletion.text
  const propResponseText = propCompletion.text

  await reportTaskProgress(job, 60, {
    stage: 'analyze_novel_characters_done',
    stageLabel: '角色分析完成',
    displayMode: 'detail',
    stepId: 'analyze_characters',
    stepTitle: '角色分析',
    stepIndex: 1,
    stepTotal: 3,
    done: true,
    output: characterResponseText,
  })

  await reportTaskProgress(job, 70, {
    stage: 'analyze_novel_locations_done',
    stageLabel: '场景分析完成',
    displayMode: 'detail',
    stepId: 'analyze_locations',
    stepTitle: '场景分析',
    stepIndex: 2,
    stepTotal: 3,
    done: true,
    output: locationResponseText,
  })

  await reportTaskProgress(job, 80, {
    stage: 'analyze_novel_props_done',
    stageLabel: '道具分析完成',
    displayMode: 'detail',
    stepId: 'analyze_props',
    stepTitle: '道具分析',
    stepIndex: 3,
    stepTotal: 3,
    done: true,
    output: propResponseText,
  })

  const charactersData = parseJsonResponse(characterResponseText)
  const locationsData = parseJsonResponse(locationResponseText)
  const propsData = parseJsonResponse(propResponseText)
  const parsedCharacters = Array.isArray(charactersData.characters)
    ? (charactersData.characters as Array<Record<string, unknown>>)
    : []
  const parsedLocations = Array.isArray(locationsData.locations)
    ? (locationsData.locations as Array<Record<string, unknown>>)
    : []
  const parsedProps = Array.isArray(propsData.props)
    ? (propsData.props as Array<Record<string, unknown>>)
    : []

  await reportTaskProgress(job, 75, {
    stage: 'analyze_novel_persist',
    stageLabel: '保存资产分析结果',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'analyze_novel_persist')

  const createdCharacters: Array<{ id: string }> = []
  for (const item of parsedCharacters) {
    const name = readText(item.name).trim()
    if (!name) continue

    const existsInLibrary = (novelData.characters || []).some(
      (character) => nameMatchesWithAlias(character.name, name),
    )
    if (existsInLibrary) continue

    const profileData = {
      role_level: item.role_level,
      archetype: item.archetype,
      personality_tags: toStringArray(item.personality_tags),
      era_period: item.era_period,
      social_class: item.social_class,
      occupation: item.occupation,
      costume_tier: item.costume_tier,
      suggested_colors: toStringArray(item.suggested_colors),
      primary_identifier: item.primary_identifier,
      visual_keywords: toStringArray(item.visual_keywords),
      gender: item.gender,
      age_range: item.age_range,
    }

    const created = await prisma.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId: novelData.id,
        name,
        aliases: JSON.stringify(toStringArray(item.aliases)),
        profileData: JSON.stringify(profileData),
        profileConfirmed: false,
      },
      select: { id: true },
    })
    createdCharacters.push(created)
  }

  const createdLocations: Array<{ id: string }> = []
  for (const item of parsedLocations) {
    const name = readText(item.name).trim()
    if (!name) continue

    const descriptionsRaw = Array.isArray(item.descriptions)
      ? (item.descriptions as unknown[])
      : (readText(item.description) ? [readText(item.description)] : [])
    const descriptions = descriptionsRaw
      .map((value) => readText(value))
      .filter(Boolean)
    const firstDescription = descriptions[0] || ''
    const invalidKeywords = ['幻想', '抽象', '无明确', '空间锚点', '未说明', '不明确']
    const isInvalid = invalidKeywords.some((keyword) => name.includes(keyword) || firstDescription.includes(keyword))
    if (isInvalid) continue

    const existsInLibrary = (novelData.locations || []).some(
      (location) => readAssetKind(location as unknown as Record<string, unknown>) !== 'prop' && nameMatchesWithAlias(location.name, name),
    )
    if (existsInLibrary) continue

    const created = await prisma.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId: novelData.id,
        name,
        summary: readText(item.summary) || null,
      },
      select: { id: true },
    })

    const cleanDescriptions = descriptions.map((value) => removeLocationPromptSuffix(value || ''))
    const availableSlots = normalizeLocationAvailableSlots(item.available_slots)
    await seedProjectLocationBackedImageSlots({
      locationId: created.id,
      descriptions: cleanDescriptions,
      fallbackDescription: readText(item.summary) || name,
      availableSlots,
    })

    createdLocations.push(created)
  }

  const existingPropNameSet = new Set(
    (novelData.locations || [])
      .filter((item) => readAssetKind(item as unknown as Record<string, unknown>) === 'prop')
      .map((item) => item.name.toLowerCase()),
  )
  const createdProps: Array<{ id: string }> = []
  for (const item of parsedProps) {
    const name = readText(item.name).trim()
    const summary = readText(item.summary).trim()
    const description = resolvePropVisualDescription({
      name,
      summary,
      description: readText(item.description).trim(),
    })
    if (!name || !summary || !description) continue

    const normalizedName = name.toLowerCase()
    if (existingPropNameSet.has(normalizedName)) continue

    const created = await prisma.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId: novelData.id,
        name,
        summary,
        assetKind: 'prop',
      },
      select: { id: true },
    })
    await seedProjectLocationBackedImageSlots({
      locationId: created.id,
      descriptions: [description],
      fallbackDescription: description,
      availableSlots: [],
    })
    existingPropNameSet.add(normalizedName)
    createdProps.push(created)
  }

  if (targetEpisode?.id && targetEpisode.contentPlan) {
    await syncEpisodeVisualAnchors({
      projectInternalId: novelData.id,
      episodeId: targetEpisode.id,
      includeAssetIds: [
        ...createdCharacters.map((item) => item.id),
        ...createdLocations.map((item) => item.id),
        ...createdProps.map((item) => item.id),
      ],
    })
  }

  await reportTaskProgress(job, 96, {
    stage: 'analyze_novel_done',
    stageLabel: '资产分析已完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    characters: createdCharacters,
    locations: createdLocations,
    props: createdProps,
    characterCount: createdCharacters.length,
    locationCount: createdLocations.length,
    propCount: createdProps.length,
  }
}

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
import { buildAssetBible } from '@/lib/assets/asset-bible'
import { reviewAssetBible } from '@/lib/assets/asset-bible-review'
import { buildAssetMeta } from '@/lib/assets/asset-semantics'
import { createArtifact } from '@/lib/run-runtime/service'
import { readOptionalTaskRunId, toJsonRecord } from '@/lib/creative-quality/runtime-artifacts'
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
import {
  markContentAssetRequirementsAnalyzed,
  readReusableApprovedAssetRequirementsState,
} from '@/lib/creation-workspace/content-artifacts'
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

function readObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === 'object' && !Array.isArray(item),
  )
}

function readCharacterItems(charactersData: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = readObjectArray(charactersData.characters)
  const created = readObjectArray(charactersData.new_characters)
  return direct.length > 0 ? direct : created
}

function buildCharacterProfileData(item: Record<string, unknown>): Record<string, unknown> {
  return {
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
    identity_locks: toStringArray(item.identity_locks),
    silhouette_locks: toStringArray(item.silhouette_locks),
    costume_locks: toStringArray(item.costume_locks),
    color_locks: toStringArray(item.color_locks),
    forbidden_variants: toStringArray(item.forbidden_variants),
    continuity_notes: toStringArray(item.continuity_notes),
    expected_appearances: readObjectArray(item.expected_appearances),
  }
}

function inferAssetImportance(...values: unknown[]): 'core' | 'supporting' {
  const text = values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  return /(核心|主角|主要|反复|贯穿|标志性|必须锁定|core|primary|main|recurring|must-lock)/iu.test(text)
    ? 'core'
    : 'supporting'
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

function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return toStringArray(value)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    return toStringArray(JSON.parse(value))
  } catch {
    return []
  }
}

function characterMatchesWithAliases(
  character: { name: string; aliases?: string | null },
  name: string,
  aliases: string[],
): boolean {
  const candidates = [name, ...aliases]
  const existingNames = [character.name, ...parseJsonStringArray(character.aliases)]
  return candidates.some((candidate) =>
    existingNames.some((existing) => nameMatchesWithAlias(existing, candidate)),
  )
}

function parseJsonResponse(responseText: string): Record<string, unknown> {
  return safeParseJsonObject(responseText)
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function readBooleanFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function shouldBypassApprovedAssetReuse(payload: Record<string, unknown>): boolean {
  return readBooleanFlag(payload.forceRegenerate)
    || readBooleanFlag(payload.force)
    || readBooleanFlag(payload.ignoreLock)
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
        characters: { select: { id: true, name: true, aliases: true, introduction: true } },
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
  const existingVisualMeta = episode.productionBible
    ? readVisualArtifactMeta(episode.productionBible)
    : null
  const assetBible = buildAssetBible({
    anchors,
    contentPlan: episode.contentPlan,
    clips: episode.clips,
    visualUnits: existingVisualMeta?.plan?.visualUnits || [],
  })
  const now = new Date().toISOString()
  const assetBibleReview = reviewAssetBible({
    targetId: params.episodeId,
    assetBible,
    expectedAssetIds: anchors.map((anchor) => anchor.assetId),
    requireUsagePlan: (existingVisualMeta?.plan?.visualUnits || []).length > 0,
    reviewedAt: now,
  })
  const contentPlan = markContentAssetRequirementsAnalyzed({
    contentPlan: episode.contentPlan,
    assetIds: anchors.map((anchor) => anchor.assetId),
    assetBible,
    review: assetBibleReview,
    now,
  })
  let productionBible = episode.productionBible
  if (productionBible) {
    const existingMeta = existingVisualMeta
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

  const reusableAssetState = !shouldBypassApprovedAssetReuse(payload) && targetEpisode?.contentPlan
    ? readReusableApprovedAssetRequirementsState(targetEpisode.contentPlan)
    : null
  if (targetEpisode?.id && reusableAssetState) {
    await reportTaskProgress(job, 92, {
      stage: 'asset_bible_reuse',
      stageLabel: '复用已批准资产需求',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'asset_bible_reuse')
    const runId = readOptionalTaskRunId(job)
    if (runId) {
      await createArtifact({
        runId,
        stepKey: 'asset_bible_reuse',
        artifactType: 'asset.bible.reuse',
        refId: targetEpisode.id,
        payload: toJsonRecord({
          reason: 'approved_asset_requirements_reused',
          contentRevision: reusableAssetState.contentRevision,
          analyzedRevision: reusableAssetState.analyzedRevision,
          approvedAt: reusableAssetState.approvedAt,
          assetIds: reusableAssetState.assetIds,
          assetCount: reusableAssetState.assetBible.length,
          reviewStatus: reusableAssetState.review?.status || null,
          reviewScore: reusableAssetState.review?.score || null,
        }),
      })
    }
    return {
      success: true,
      reused: true,
      reuseReason: 'approved_asset_requirements_reused',
      episodeId: targetEpisode.id,
      contentRevision: reusableAssetState.contentRevision,
      analyzedRevision: reusableAssetState.analyzedRevision,
      assetIds: reusableAssetState.assetIds,
      assetCount: reusableAssetState.assetBible.length,
      reviewStatus: reusableAssetState.review?.status || null,
      reviewScore: reusableAssetState.review?.score || null,
      characters: [],
      locations: [],
      props: [],
      characterCount: 0,
      locationCount: 0,
      propCount: 0,
    }
  }

  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelData.analysisModel,
  })

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
  const parsedCharacters = readCharacterItems(charactersData)
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
    const aliases = toStringArray(item.aliases)

    const existsInLibrary = (novelData.characters || []).some(
      (character) => characterMatchesWithAliases(character, name, aliases),
    )
    if (existsInLibrary) continue

    const profileData = buildCharacterProfileData(item)
    const assetMeta = buildAssetMeta({
      assetKind: 'character',
      name,
      description: readText(item.introduction) || JSON.stringify(profileData),
      importance: inferAssetImportance(item.role_level, item.introduction, item.primary_identifier),
    })

    const created = await prisma.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId: novelData.id,
        name,
        aliases: JSON.stringify(aliases),
        introduction: readText(item.introduction) || null,
        profileData: JSON.stringify(profileData),
        semanticType: assetMeta.semanticType,
        assetTier: assetMeta.assetTier,
        usageScope: assetMeta.usageScope,
        assetMeta: asInputJson({
          ...assetMeta,
          source: 'analyze_novel',
          profileData,
        }),
        profileConfirmed: false,
      },
      select: { id: true },
    })
    createdCharacters.push(created)
  }

  for (const item of readObjectArray(charactersData.updated_characters)) {
    const name = readText(item.name).trim()
    if (!name) continue
    const existing = (novelData.characters || []).find(
      (character) => character.name.toLowerCase() === name.toLowerCase(),
    )
    if (!existing) continue
    const updatedIntroduction = readText(item.updated_introduction).trim()
    const updatedAliases = toStringArray(item.updated_aliases)
    const existingAliases = parseJsonStringArray(existing.aliases)
    const mergedAliases = Array.from(new Set([...existingAliases, ...updatedAliases].filter(Boolean)))
    const updateData: Record<string, unknown> = {}
    if (updatedIntroduction) updateData.introduction = updatedIntroduction
    if (mergedAliases.length > existingAliases.length) updateData.aliases = JSON.stringify(mergedAliases)
    if (Object.keys(updateData).length > 0) {
      await prisma.novelPromotionCharacter.update({
        where: { id: existing.id },
        data: updateData,
      })
    }
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
        ...(() => {
          const assetMeta = buildAssetMeta({
            assetKind: 'location',
            name,
            description: readText(item.summary) || firstDescription,
            importance: inferAssetImportance(item.summary, item.description),
          })
          return {
            semanticType: assetMeta.semanticType,
            assetTier: assetMeta.assetTier,
            usageScope: assetMeta.usageScope,
            assetMeta: asInputJson({
              ...assetMeta,
              source: 'analyze_novel',
            }),
          }
        })(),
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
        ...(() => {
          const assetMeta = buildAssetMeta({
            assetKind: 'prop',
            name,
            description,
            importance: inferAssetImportance(summary, description),
          })
          return {
            semanticType: assetMeta.semanticType,
            assetTier: assetMeta.assetTier,
            usageScope: assetMeta.usageScope,
            assetMeta: asInputJson({
              ...assetMeta,
              source: 'analyze_novel',
            }),
          }
        })(),
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

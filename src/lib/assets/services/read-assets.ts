import { prisma } from '@/lib/prisma'
import { attachMediaFieldsToGlobalCharacter, attachMediaFieldsToGlobalLocation, attachMediaFieldsToGlobalVoice, attachMediaFieldsToProject } from '@/lib/media/attach'
import {
  resolveMediaValueToUrl,
  resolveMediaValuesToUrls,
} from '@/lib/media/visual-quality-state'
import {
  filterAssetsByKind as filterMappedAssetsByKind,
  mapGlobalCharacterToAsset,
  mapGlobalLocationToAsset,
  mapGlobalPropToAsset,
  mapGlobalVoiceToAsset,
  mapProjectCharacterToAsset,
  mapProjectLocationToAsset,
  mapProjectPropToAsset,
} from '@/lib/assets/mappers'
import type {
  AssetCandidateGroupSummary,
  AssetKind,
  AssetQueryInput,
  AssetSummary,
  VisualAssetSummary,
} from '@/lib/assets/contracts'
import {
  listGlobalLocationBackedAssets,
  listProjectLocationBackedAssets,
} from '@/lib/assets/services/location-backed-assets'

type ProjectAssetRepairArtifact = {
  id: string
  refId: string
  payload: unknown
  createdAt: Date
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)))
}

function readPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function readRepairAction(value: unknown): 'edit' | 'regenerate' | null {
  return value === 'edit' || value === 'regenerate' ? value : null
}

function collectVisualAssetImageUrls(asset: VisualAssetSummary): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const variant of asset.variants) {
    for (const render of variant.renders) {
      const imageUrl = render.imageUrl?.trim()
      if (!imageUrl || seen.has(imageUrl)) continue
      seen.add(imageUrl)
      urls.push(imageUrl)
    }
  }
  return urls
}

function collectVisualAssetTargetIds(asset: VisualAssetSummary): string[] {
  return asset.variants.map((variant) => variant.id).filter(Boolean)
}

async function buildVisualAssetCandidateGroups(
  asset: VisualAssetSummary,
  artifactsByRefId: Map<string, ProjectAssetRepairArtifact[]>,
): Promise<AssetCandidateGroupSummary[]> {
  const targetIds = collectVisualAssetTargetIds(asset)
  const artifacts = targetIds
    .flatMap((targetId) => artifactsByRefId.get(targetId) || [])
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const allCandidateUrls = collectVisualAssetImageUrls(asset)
  if (allCandidateUrls.length === 0) return []

  const repairGroups: AssetCandidateGroupSummary[] = []
  for (const artifact of artifacts) {
    const payload = asRecord(artifact.payload)
    const candidateUrls = readStringArray(payload?.candidateUrls)
    if (candidateUrls.length === 0) continue
    const sourceCandidateUrl = typeof payload?.sourceCandidateUrl === 'string' && payload.sourceCandidateUrl.trim()
      ? payload.sourceCandidateUrl.trim()
      : null
    repairGroups.push({
      id: artifact.id,
      origin: 'repair',
      attempt: readPositiveInteger(payload?.attempt, 1),
      action: readRepairAction(payload?.action),
      candidateUrls: await resolveMediaValuesToUrls(candidateUrls),
      sourceCandidateUrl: await resolveMediaValueToUrl(sourceCandidateUrl),
      createdAt: artifact.createdAt.toISOString(),
    })
  }
  const repairUrlSet = new Set(repairGroups.flatMap((group) => group.candidateUrls))
  const originalCandidateUrls = allCandidateUrls.filter((url) => !repairUrlSet.has(url))
  const initialGroup = originalCandidateUrls.length > 0
    ? [{
      id: `${asset.id}:initial`,
      origin: 'initial' as const,
      attempt: 0,
      action: null,
      candidateUrls: originalCandidateUrls,
      sourceCandidateUrl: null,
      createdAt: artifacts[0]?.createdAt.toISOString() || '',
    }]
    : []
  return [...initialGroup, ...repairGroups]
}

async function attachProjectCandidateGroups(
  assets: AssetSummary[],
  repairArtifacts: ProjectAssetRepairArtifact[],
): Promise<AssetSummary[]> {
  const artifactsByRefId = new Map<string, ProjectAssetRepairArtifact[]>()
  for (const artifact of repairArtifacts) {
    const list = artifactsByRefId.get(artifact.refId)
    if (list) {
      list.push(artifact)
    } else {
      artifactsByRefId.set(artifact.refId, [artifact])
    }
  }
  return Promise.all(assets.map(async (asset) => {
    if (asset.family !== 'visual') return asset
    return {
      ...asset,
      candidateGroups: await buildVisualAssetCandidateGroups(asset, artifactsByRefId),
    } as AssetSummary
  }))
}

function collectProjectRepairTargetIds(params: {
  characters: Array<{ appearances: Array<{ id: string }> }>
  locations: Array<{ images?: Array<{ id: string }> }>
  props: Array<{ images?: Array<{ id: string }> }>
}) {
  const ids = new Set<string>()
  for (const character of params.characters) {
    for (const appearance of character.appearances || []) {
      if (appearance.id) ids.add(appearance.id)
    }
  }
  for (const asset of [...params.locations, ...params.props]) {
    for (const image of asset.images || []) {
      if (image.id) ids.add(image.id)
    }
  }
  return Array.from(ids)
}

async function listProjectAssetRepairArtifacts(
  projectId: string,
  refIds: string[],
): Promise<ProjectAssetRepairArtifact[]> {
  const ids = Array.from(new Set(refIds.filter(Boolean)))
  if (ids.length === 0) return []
  return prisma.graphArtifact.findMany({
    where: {
      artifactType: 'visual.asset.repair.candidate',
      refId: { in: ids },
      run: { projectId },
    },
    select: {
      id: true,
      refId: true,
      payload: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
}

async function readProjectAssets(projectId: string): Promise<AssetSummary[]> {
  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: {
      id: true,
      characters: {
        include: {
          appearances: {
            orderBy: { appearanceIndex: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!project) {
    return []
  }

  const [locations, props] = await Promise.all([
    listProjectLocationBackedAssets(project.id, 'location'),
    listProjectLocationBackedAssets(project.id, 'prop'),
  ])
  const repairTargetIds = collectProjectRepairTargetIds({
    characters: project.characters,
    locations,
    props,
  })

  const [withMedia, repairArtifacts] = await Promise.all([
    attachMediaFieldsToProject({
      characters: project.characters,
      locations: [...locations, ...props],
    }),
    listProjectAssetRepairArtifacts(projectId, repairTargetIds),
  ])
  const projectCharacters = (withMedia.characters as unknown as Parameters<typeof mapProjectCharacterToAsset>[0][])
    .map(mapProjectCharacterToAsset)
  const locationLikeAssets = withMedia.locations as Array<Record<string, unknown> & { assetKind?: string }>
  const projectLocations = locationLikeAssets
    .filter((asset) => asset.assetKind === 'location')
    .map((asset) => mapProjectLocationToAsset(asset as Parameters<typeof mapProjectLocationToAsset>[0]))
  const projectProps = locationLikeAssets
    .filter((asset) => asset.assetKind === 'prop')
    .map((asset) => mapProjectPropToAsset(asset as Parameters<typeof mapProjectPropToAsset>[0]))
  return await attachProjectCandidateGroups(
    [...projectCharacters, ...projectLocations, ...projectProps],
    repairArtifacts,
  )
}

async function readGlobalAssets(input: { folderId?: string | null; userId: string }): Promise<AssetSummary[]> {
  const folderFilter = input.folderId ? { folderId: input.folderId } : {}
  const where = {
    userId: input.userId,
    ...folderFilter,
  }
  const [characters, locations, props, voices] = await Promise.all([
    prisma.globalCharacter.findMany({
      where,
      include: {
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    listGlobalLocationBackedAssets({
      userId: input.userId,
      folderId: input.folderId,
      kind: 'location',
    }),
    listGlobalLocationBackedAssets({
      userId: input.userId,
      folderId: input.folderId,
      kind: 'prop',
    }),
    prisma.globalVoice.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const [globalCharacters, globalLocations, globalProps, globalVoices] = await Promise.all([
    Promise.all(characters.map((character) => attachMediaFieldsToGlobalCharacter(character))),
    Promise.all(locations.map((location) => attachMediaFieldsToGlobalLocation(location))),
    Promise.all(props.map((prop) => attachMediaFieldsToGlobalLocation(prop))),
    Promise.all(voices.map((voice) => attachMediaFieldsToGlobalVoice(voice))),
  ])

  return [
    ...(globalCharacters as unknown as Parameters<typeof mapGlobalCharacterToAsset>[0][]).map(mapGlobalCharacterToAsset),
    ...(globalLocations as unknown as Parameters<typeof mapGlobalLocationToAsset>[0][]).map(mapGlobalLocationToAsset),
    ...(globalProps as unknown as Parameters<typeof mapGlobalPropToAsset>[0][]).map(mapGlobalPropToAsset),
    ...(globalVoices as unknown as Parameters<typeof mapGlobalVoiceToAsset>[0][]).map(mapGlobalVoiceToAsset),
  ]
}

export async function readAssets(
  input: AssetQueryInput,
  access?: { userId?: string | null },
): Promise<AssetSummary[]> {
  const assets = input.scope === 'project'
    ? await readProjectAssets(assertProjectId(input.projectId))
    : await readGlobalAssets({
      folderId: input.folderId,
      userId: assertUserId(access?.userId),
    })
  return filterMappedAssetsByKind(assets, input.kind as AssetKind | null | undefined)
}

function assertProjectId(projectId: string | null | undefined): string {
  if (!projectId) {
    throw new Error('projectId is required for project asset scope')
  }
  return projectId
}

function assertUserId(userId: string | null | undefined): string {
  if (!userId) {
    throw new Error('userId is required for global asset scope')
  }
  return userId
}

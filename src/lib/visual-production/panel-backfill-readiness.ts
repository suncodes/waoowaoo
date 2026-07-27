import { prisma } from '@/lib/prisma'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import type { ShotAssetRequirement } from './shot-asset-requirements'

export interface PanelBackfillRequestRef {
  name: string
  kind: ShotAssetRequirement['kind']
  assetId: string | null
  status: string | null
}

export interface PanelBackfillReadiness {
  ready: boolean
  requests: PanelBackfillRequestRef[]
  blockingRequests: PanelBackfillRequestRef[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readKind(value: unknown): ShotAssetRequirement['kind'] | null {
  return value === 'character' || value === 'location' || value === 'prop' ? value : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function readBackfillRequests(referencePlan: unknown): PanelBackfillRequestRef[] {
  const plan = asRecord(referencePlan)
  const backfill = asRecord(plan.backfill)
  const requests = Array.isArray(backfill.requests) ? backfill.requests : []
  return requests.flatMap((item) => {
    const request = asRecord(item)
    const kind = readKind(request.kind)
    const name = readString(request.name)
    if (!kind || !name) return []
    return [{
      name,
      kind,
      assetId: readString(request.assetId),
      status: readString(request.status),
    }]
  })
}

function locationHasUsableImage(location: {
  images: Array<{ imageUrl: string | null }>
}): boolean {
  return location.images.some((image) => typeof image.imageUrl === 'string' && image.imageUrl.trim().length > 0)
}

function characterHasUsableImage(character: {
  appearances: Array<{ imageUrl: string | null; imageUrls: string | null }>
}): boolean {
  return character.appearances.some((appearance) => {
    if (typeof appearance.imageUrl === 'string' && appearance.imageUrl.trim().length > 0) return true
    return decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
      .some((url) => typeof url === 'string' && url.trim().length > 0)
  })
}

export async function resolvePanelBackfillReadiness(referencePlan: unknown): Promise<PanelBackfillReadiness> {
  const requests = readBackfillRequests(referencePlan)
  if (requests.length === 0) {
    return { ready: true, requests, blockingRequests: [] }
  }

  const assetIds = Array.from(new Set(requests.flatMap((request) => request.assetId ? [request.assetId] : [])))
  const [locations, characters] = await Promise.all([
    prisma.novelPromotionLocation.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        images: { select: { imageUrl: true } },
      },
    }),
    prisma.novelPromotionCharacter.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        appearances: { select: { imageUrl: true, imageUrls: true } },
      },
    }),
  ])

  const readyAssetIds = new Set<string>()
  for (const location of locations) {
    if (locationHasUsableImage(location)) readyAssetIds.add(location.id)
  }
  for (const character of characters) {
    if (characterHasUsableImage(character)) readyAssetIds.add(character.id)
  }

  const blockingRequests = requests.filter((request) => {
    if (!request.assetId) return true
    if (request.status === 'human_required' || request.status === 'skipped') return true
    return !readyAssetIds.has(request.assetId)
  })

  return {
    ready: blockingRequests.length === 0,
    requests,
    blockingRequests,
  }
}

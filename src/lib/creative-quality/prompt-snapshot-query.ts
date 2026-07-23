import { prisma } from '@/lib/prisma'

export const PANEL_PROMPT_SNAPSHOT_TYPES = [
  'prompt.panel_image.snapshot',
  'prompt.panel_video.snapshot',
] as const

export type PanelPromptSnapshotArtifactType = typeof PANEL_PROMPT_SNAPSHOT_TYPES[number]

export interface PanelPromptSnapshotView {
  artifactId: string
  artifactType: PanelPromptSnapshotArtifactType
  runId: string
  stepKey: string | null
  targetId: string
  snapshotType: string
  modelKey: string
  promptTemplateId: string
  promptHash: string
  specHash: string
  inputHash: string
  assetVersionHash: string | null
  referenceImages: string[]
  promptSpec: unknown
  compiledPrompt: string
  createdAt: string
  artifactCreatedAt: string
}

export interface LatestPanelPromptSnapshots {
  image: PanelPromptSnapshotView | null
  video: PanelPromptSnapshotView | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function readStringOrNull(record: Record<string, unknown>, key: string): string | null {
  const value = readString(record, key)
  return value || null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
}

function isPanelPromptSnapshotType(value: string): value is PanelPromptSnapshotArtifactType {
  return PANEL_PROMPT_SNAPSHOT_TYPES.includes(value as PanelPromptSnapshotArtifactType)
}

function toIsoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function snapshotSlot(type: PanelPromptSnapshotArtifactType): keyof LatestPanelPromptSnapshots {
  return type === 'prompt.panel_image.snapshot' ? 'image' : 'video'
}

export function normalizePanelPromptSnapshotArtifact(row: {
  id: string
  runId: string
  stepKey: string | null
  artifactType: string
  refId: string
  versionHash: string | null
  payload: unknown
  createdAt: Date | string
}): PanelPromptSnapshotView | null {
  if (!isPanelPromptSnapshotType(row.artifactType)) return null
  if (!isRecord(row.payload)) return null
  const compiledPrompt = readString(row.payload, 'compiledPrompt')
  if (!compiledPrompt) return null

  return {
    artifactId: row.id,
    artifactType: row.artifactType,
    runId: row.runId,
    stepKey: row.stepKey || null,
    targetId: readString(row.payload, 'targetId') || row.refId,
    snapshotType: readString(row.payload, 'snapshotType'),
    modelKey: readString(row.payload, 'modelKey'),
    promptTemplateId: readString(row.payload, 'promptTemplateId'),
    promptHash: readString(row.payload, 'promptHash') || row.versionHash || '',
    specHash: readString(row.payload, 'specHash'),
    inputHash: readString(row.payload, 'inputHash'),
    assetVersionHash: readStringOrNull(row.payload, 'assetVersionHash'),
    referenceImages: readStringArray(row.payload.referenceImages),
    promptSpec: row.payload.promptSpec ?? null,
    compiledPrompt,
    createdAt: readString(row.payload, 'createdAt') || toIsoDate(row.createdAt),
    artifactCreatedAt: toIsoDate(row.createdAt),
  }
}

export async function panelBelongsToProject(params: {
  projectId: string
  panelId: string
}): Promise<boolean> {
  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: params.panelId,
      storyboard: {
        episode: {
          novelPromotionProject: {
            projectId: params.projectId,
          },
        },
      },
    },
    select: { id: true },
  })
  return !!panel
}

export async function getLatestPanelPromptSnapshots(params: {
  projectId: string
  panelId: string
}): Promise<LatestPanelPromptSnapshots> {
  const rows = await prisma.graphArtifact.findMany({
    where: {
      refId: params.panelId,
      artifactType: { in: [...PANEL_PROMPT_SNAPSHOT_TYPES] },
      run: {
        projectId: params.projectId,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const snapshots: LatestPanelPromptSnapshots = { image: null, video: null }
  for (const row of rows) {
    const snapshot = normalizePanelPromptSnapshotArtifact(row)
    if (!snapshot) continue
    const slot = snapshotSlot(snapshot.artifactType)
    if (!snapshots[slot]) snapshots[slot] = snapshot
    if (snapshots.image && snapshots.video) break
  }
  return snapshots
}

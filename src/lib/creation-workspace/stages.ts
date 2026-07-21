import type { AppIconName } from '@/components/ui/icons'

export const CREATION_STAGE_IDS = [
  'setup',
  'content',
  'visual-design',
  'storyboard-preview',
  'production',
  'edit',
] as const

export type CreationStageId = typeof CREATION_STAGE_IDS[number]

export type CreationStageStatus =
  | 'not_started'
  | 'ready'
  | 'running'
  | 'attention'
  | 'completed'
  | 'failed'
  | 'stale'

export type CreationStageCommandId =
  | 'save'
  | 'regenerate'
  | 'approve'
  | 'continue'

export interface CreationImpactScope {
  sourceStageId: CreationStageId
  affectedStageIds: CreationStageId[]
  mode: 'none' | 'partial' | 'full'
  affectedEntityIds?: string[]
}

export interface CreationStageViewModel<TArtifact = unknown> {
  stageId: CreationStageId
  status: CreationStageStatus
  artifact?: TArtifact
  issueCount: number
  availableCommands: CreationStageCommandId[]
}

export interface CreationStageDefinition {
  id: CreationStageId
  order: number
  icon: AppIconName
  labelKey: string
  descriptionKey: string
  dependencies: CreationStageId[]
  defaultView?: string
}

export const CREATION_STAGE_REGISTRY: readonly CreationStageDefinition[] = [
  {
    id: 'setup',
    order: 0,
    icon: 'fileText',
    labelKey: 'stages.setup.label',
    descriptionKey: 'stages.setup.description',
    dependencies: [],
  },
  {
    id: 'content',
    order: 1,
    icon: 'bookOpen',
    labelKey: 'stages.content.label',
    descriptionKey: 'stages.content.description',
    dependencies: ['setup'],
    defaultView: 'plan',
  },
  {
    id: 'visual-design',
    order: 2,
    icon: 'clapperboard',
    labelKey: 'stages.visualDesign.label',
    descriptionKey: 'stages.visualDesign.description',
    dependencies: ['content'],
    defaultView: 'direction',
  },
  {
    id: 'storyboard-preview',
    order: 3,
    icon: 'image',
    labelKey: 'stages.storyboardPreview.label',
    descriptionKey: 'stages.storyboardPreview.description',
    dependencies: ['visual-design'],
  },
  {
    id: 'production',
    order: 4,
    icon: 'video',
    labelKey: 'stages.production.label',
    descriptionKey: 'stages.production.description',
    dependencies: ['storyboard-preview'],
    defaultView: 'shots',
  },
  {
    id: 'edit',
    order: 5,
    icon: 'film',
    labelKey: 'stages.edit.label',
    descriptionKey: 'stages.edit.description',
    dependencies: ['production'],
  },
] as const

export interface CreationStageRoute {
  stageId: CreationStageId
  view?: string
  isAlias: boolean
}

const STAGE_ID_SET = new Set<string>(CREATION_STAGE_IDS)

const LEGACY_STAGE_ROUTES: Record<string, Omit<CreationStageRoute, 'isAlias'>> = {
  config: { stageId: 'setup' },
  'content-plan': { stageId: 'content', view: 'plan' },
  'content-assets': { stageId: 'content', view: 'assets' },
  script: { stageId: 'content', view: 'script' },
  assets: { stageId: 'visual-design', view: 'assets' },
  'visual-plan': { stageId: 'visual-design', view: 'direction' },
  'text-storyboard': { stageId: 'storyboard-preview' },
  storyboard: { stageId: 'storyboard-preview' },
  videos: { stageId: 'production', view: 'shots' },
  voice: { stageId: 'production', view: 'voice' },
  editor: { stageId: 'edit' },
  export: { stageId: 'edit', view: 'export' },
}

export const CREATION_WORKSPACE_ROUTE_IDS = [
  ...CREATION_STAGE_IDS,
  ...Object.keys(LEGACY_STAGE_ROUTES),
] as const

export function isKnownCreationStageRoute(value: string | null | undefined): boolean {
  if (!value) return false
  return STAGE_ID_SET.has(value) || value in LEGACY_STAGE_ROUTES
}

export function resolveCreationStageRoute(
  rawStage: string | null | undefined,
  rawView?: string | null,
): CreationStageRoute {
  const normalizedStage = rawStage?.trim() || ''
  if (STAGE_ID_SET.has(normalizedStage)) {
    const stageId = normalizedStage as CreationStageId
    const definition = CREATION_STAGE_REGISTRY.find((item) => item.id === stageId)
    return {
      stageId,
      view: rawView?.trim() || definition?.defaultView,
      isAlias: false,
    }
  }

  const alias = LEGACY_STAGE_ROUTES[normalizedStage]
  if (alias) {
    return {
      ...alias,
      view: rawView?.trim() || alias.view,
      isAlias: true,
    }
  }

  return {
    stageId: 'setup',
    isAlias: normalizedStage.length > 0,
  }
}

export function getCreationStageDefinition(stageId: CreationStageId): CreationStageDefinition {
  const definition = CREATION_STAGE_REGISTRY.find((item) => item.id === stageId)
  if (!definition) {
    throw new Error(`Unknown creation stage: ${stageId}`)
  }
  return definition
}

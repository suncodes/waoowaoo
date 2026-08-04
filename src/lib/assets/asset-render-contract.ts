import type { AssetSemanticType } from './asset-semantics'

export type AssetImageTemplateKind =
  | 'character_reference_sheet'
  | 'vehicle_turnaround'
  | 'prop_turnaround'
  | 'prop_single_reference'
  | 'environment_plate'
  | 'book_clean_plate'
  | 'symbol_sheet'

export type AssetPhysicalForm =
  | 'humanoid'
  | 'rigid'
  | 'organic'
  | 'amorphous'
  | 'graphic'
  | 'spatial'
  | 'unknown'

export type AssetOrientation = 'directional' | 'non_directional' | 'unknown'

export type AssetSubjectPolicy = 'character_only' | 'object_only' | 'environment_only' | 'graphic_only'

export interface AssetRenderContract {
  schemaVersion: 1
  subjectPolicy: AssetSubjectPolicy
  physicalForm: AssetPhysicalForm
  orientation: AssetOrientation
  templateKind: AssetImageTemplateKind
  requiresTurnaround: boolean
}

type AssetPromptKind = 'character' | 'location' | 'prop'

const TEMPLATE_KINDS = new Set<AssetImageTemplateKind>([
  'character_reference_sheet',
  'vehicle_turnaround',
  'prop_turnaround',
  'prop_single_reference',
  'environment_plate',
  'book_clean_plate',
  'symbol_sheet',
])

const PHYSICAL_FORMS = new Set<AssetPhysicalForm>([
  'humanoid',
  'rigid',
  'organic',
  'amorphous',
  'graphic',
  'spatial',
  'unknown',
])

const ORIENTATIONS = new Set<AssetOrientation>([
  'directional',
  'non_directional',
  'unknown',
])

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readPhysicalForm(value: unknown): AssetPhysicalForm | null {
  return typeof value === 'string' && PHYSICAL_FORMS.has(value as AssetPhysicalForm)
    ? value as AssetPhysicalForm
    : null
}

function readOrientation(value: unknown): AssetOrientation | null {
  return typeof value === 'string' && ORIENTATIONS.has(value as AssetOrientation)
    ? value as AssetOrientation
    : null
}

function readRenderFacts(value: unknown): {
  physicalForm: AssetPhysicalForm | null
  orientation: AssetOrientation | null
} {
  const record = asRecord(value)
  return {
    physicalForm: readPhysicalForm(record.physical_form ?? record.physicalForm ?? record.render_form ?? record.renderForm),
    orientation: readOrientation(record.orientation),
  }
}

function contract(params: {
  subjectPolicy: AssetSubjectPolicy
  physicalForm: AssetPhysicalForm
  orientation: AssetOrientation
  templateKind: AssetImageTemplateKind
  requiresTurnaround?: boolean
}): AssetRenderContract {
  return {
    schemaVersion: 1,
    subjectPolicy: params.subjectPolicy,
    physicalForm: params.physicalForm,
    orientation: params.orientation,
    templateKind: params.templateKind,
    requiresTurnaround: params.requiresTurnaround === true,
  }
}

export function isAssetImageTemplateKind(value: unknown): value is AssetImageTemplateKind {
  return typeof value === 'string' && TEMPLATE_KINDS.has(value as AssetImageTemplateKind)
}

export function isAssetRenderContract(value: unknown): value is AssetRenderContract {
  const record = asRecord(value)
  return record.schemaVersion === 1
    && typeof record.subjectPolicy === 'string'
    && (record.subjectPolicy === 'character_only'
      || record.subjectPolicy === 'object_only'
      || record.subjectPolicy === 'environment_only'
      || record.subjectPolicy === 'graphic_only')
    && readPhysicalForm(record.physicalForm) !== null
    && readOrientation(record.orientation) !== null
    && isAssetImageTemplateKind(record.templateKind)
    && typeof record.requiresTurnaround === 'boolean'
}

export function resolveAssetRenderContract(params: {
  assetKind: AssetPromptKind
  semanticType: AssetSemanticType
  profileData?: unknown
  extractedFacts?: unknown
}): AssetRenderContract {
  const profileFacts = readRenderFacts(params.profileData)
  const extractedRenderFacts = readRenderFacts(params.extractedFacts)
  const physicalForm = profileFacts.physicalForm || extractedRenderFacts.physicalForm
  const orientation = profileFacts.orientation || extractedRenderFacts.orientation

  if (params.assetKind === 'character') {
    return contract({
      subjectPolicy: 'character_only',
      physicalForm: 'humanoid',
      orientation: 'directional',
      templateKind: 'character_reference_sheet',
      requiresTurnaround: true,
    })
  }
  if (params.assetKind === 'location') {
    return contract({
      subjectPolicy: 'environment_only',
      physicalForm: 'spatial',
      orientation: 'unknown',
      templateKind: 'environment_plate',
    })
  }

  if (physicalForm === 'graphic') {
    return contract({
      subjectPolicy: 'graphic_only',
      physicalForm,
      orientation: orientation || 'non_directional',
      templateKind: 'symbol_sheet',
    })
  }
  if (physicalForm === 'rigid' && orientation === 'directional') {
    return contract({
      subjectPolicy: 'object_only',
      physicalForm,
      orientation,
      templateKind: params.semanticType === 'vehicle' ? 'vehicle_turnaround' : 'prop_turnaround',
      requiresTurnaround: true,
    })
  }
  if (physicalForm && physicalForm !== 'unknown') {
    return contract({
      subjectPolicy: 'object_only',
      physicalForm,
      orientation: orientation || 'non_directional',
      templateKind: 'prop_single_reference',
    })
  }

  if (params.semanticType === 'book') {
    return contract({
      subjectPolicy: 'object_only',
      physicalForm: 'rigid',
      orientation: 'non_directional',
      templateKind: 'book_clean_plate',
    })
  }
  if (params.semanticType === 'vehicle') {
    return contract({
      subjectPolicy: 'object_only',
      physicalForm: 'rigid',
      orientation: 'directional',
      templateKind: 'vehicle_turnaround',
      requiresTurnaround: true,
    })
  }
  if (params.semanticType === 'symbol') {
    return contract({
      subjectPolicy: 'graphic_only',
      physicalForm: 'graphic',
      orientation: 'non_directional',
      templateKind: 'symbol_sheet',
    })
  }
  if (params.semanticType === 'weapon' || params.semanticType === 'tool' || params.semanticType === 'device') {
    return contract({
      subjectPolicy: 'object_only',
      physicalForm: 'rigid',
      orientation: 'directional',
      templateKind: 'prop_turnaround',
      requiresTurnaround: true,
    })
  }

  return contract({
    subjectPolicy: 'object_only',
    physicalForm: params.semanticType === 'magic_item' ? 'amorphous' : 'unknown',
    orientation: 'unknown',
    templateKind: 'prop_single_reference',
  })
}

import type { ShotAssetRequirement } from './shot-asset-requirements'

export type MissingReferenceResolution = 'no_reference_allowed' | 'auto_backfill' | 'human_required'

const GENERIC_CHARACTER_PATTERNS = [
  /读者|观众|听众|用户|人群|路人|行人|市民|游客|学生|儿童|孩子|家庭|父母|成年人|青年|少年|少女|同学|老师|读书人/iu,
  /reader|audience|viewer|listener|user|people|crowd|passerby|pedestrian|citizen|tourist|student|child|children|family|parent|adult|teen|teacher/iu,
]

function normalizeText(...values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .trim()
    .toLowerCase()
}

function hasGenericCharacterSignal(requirement: ShotAssetRequirement): boolean {
  const text = normalizeText(requirement.name, requirement.semanticType, requirement.reason)
  if (!text) return false
  return GENERIC_CHARACTER_PATTERNS.some((pattern) => pattern.test(text))
}

export function isGenericCharacterRequirement(requirement: ShotAssetRequirement): boolean {
  if (requirement.kind !== 'character') return false
  if (requirement.mustLock || requirement.reuseExpected) return false
  if (requirement.assetId) return false
  if (requirement.role === 'style_only') return true
  if (requirement.semanticType && requirement.semanticType !== 'person') return false
  return hasGenericCharacterSignal(requirement)
}

export function requiresStableReference(requirement: ShotAssetRequirement): boolean {
  if (isGenericCharacterRequirement(requirement)) return false

  if (requirement.kind === 'character') {
    return requirement.mustLock
      || requirement.reuseExpected
      || requirement.role === 'primary_identity'
      || requirement.role === 'supporting_identity'
  }

  if (requirement.kind === 'prop') {
    return requirement.mustLock
      || requirement.reuseExpected
      || requirement.role === 'prop_detail'
      || requirement.role === 'cover_motif'
      || requirement.role === 'comparison_prop'
  }

  return requirement.mustLock || (requirement.required && requirement.reuseExpected)
}

export function requirementNeedsCoverage(requirement: ShotAssetRequirement): boolean {
  return requirement.required || requirement.mustLock || requiresStableReference(requirement)
}

export function canAutoBackfillRequirement(requirement: ShotAssetRequirement): boolean {
  if (!requirementNeedsCoverage(requirement)) return false
  if (isGenericCharacterRequirement(requirement)) return false
  return requirement.kind === 'character' || requirement.kind === 'location' || requirement.kind === 'prop'
}

export function resolveMissingReferenceResolution(requirement: ShotAssetRequirement): MissingReferenceResolution {
  if (isGenericCharacterRequirement(requirement)) return 'no_reference_allowed'
  if (canAutoBackfillRequirement(requirement)) return 'auto_backfill'
  return 'human_required'
}

export function isBlockingMissingRequirement(requirement: ShotAssetRequirement): boolean {
  if (!requirementNeedsCoverage(requirement)) return false
  return resolveMissingReferenceResolution(requirement) !== 'no_reference_allowed'
}

export function noReferenceAllowedReason(requirement: ShotAssetRequirement): string | null {
  if (isGenericCharacterRequirement(requirement)) return 'generic_character_no_reference_allowed'
  return null
}

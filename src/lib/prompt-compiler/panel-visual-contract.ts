export interface PanelVisualContract {
  schemaVersion: 1
  primarySubject: string
  assetLocks: string[]
  actionState: string
  composition: string
  settingAndLight: string
  continuity: string[]
  textPolicy: 'no_text' | 'safe_area_only'
  negativeConstraints: string[]
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const normalized = value.replace(/\s+/gu, ' ').trim()
    const key = normalized.toLocaleLowerCase()
    if (!normalized || seen.has(key)) return []
    seen.add(key)
    return [normalized]
  })
}

export function buildPanelVisualContract(params: {
  primarySubject: string
  assetLocks: string[]
  actionState: string
  composition: string[]
  settingAndLight: string[]
  continuity: string[]
  textPolicy: PanelVisualContract['textPolicy']
  negativeConstraints: string[]
}): PanelVisualContract {
  return {
    schemaVersion: 1,
    primarySubject: params.primarySubject.trim(),
    assetLocks: uniqueStrings(params.assetLocks),
    actionState: params.actionState.trim(),
    composition: uniqueStrings(params.composition).join('；'),
    settingAndLight: uniqueStrings(params.settingAndLight).join('；'),
    continuity: uniqueStrings(params.continuity),
    textPolicy: params.textPolicy,
    negativeConstraints: uniqueStrings(params.negativeConstraints),
  }
}

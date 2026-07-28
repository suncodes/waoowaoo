export type VoiceLinePanelBindingLike = {
  matchedPanelId?: string | null
  matchedStoryboardId?: string | null
  matchedPanelIndex?: number | null
  panelSpans?: Array<{
    panelId?: string | null
    panel?: {
      storyboardId?: string | null
      panelIndex?: number | null
    } | null
  }> | null
}

export type VoiceLinePanelBinding = {
  panelId?: string
  storyboardId?: string
  panelIndex?: number
}

function readIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPanelIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function bindingKey(binding: VoiceLinePanelBinding): string {
  if (binding.storyboardId && binding.panelIndex !== undefined) {
    return `storyboard:${binding.storyboardId}:${binding.panelIndex}`
  }
  return binding.panelId ? `panel:${binding.panelId}` : ''
}

/**
 * 镜头语义归属优先于时间轴覆盖范围；后者仅用于旧数据的兼容回退。
 */
export function resolveVoiceLinePanelBindings(line: VoiceLinePanelBindingLike): VoiceLinePanelBinding[] {
  const matchedStoryboardId = readIdentifier(line.matchedStoryboardId)
  const matchedPanelIndex = readPanelIndex(line.matchedPanelIndex)
  if (matchedStoryboardId && matchedPanelIndex !== null) {
    return [{ storyboardId: matchedStoryboardId, panelIndex: matchedPanelIndex }]
  }

  const matchedPanelId = readIdentifier(line.matchedPanelId)
  if (matchedPanelId) {
    return [{ panelId: matchedPanelId }]
  }

  const bindings = new Map<string, VoiceLinePanelBinding>()
  for (const span of line.panelSpans || []) {
    const panelId = readIdentifier(span.panelId)
    if (panelId) {
      bindings.set(`panel:${panelId}`, { panelId })
      continue
    }
    const storyboardId = readIdentifier(span.panel?.storyboardId)
    const panelIndex = readPanelIndex(span.panel?.panelIndex)
    if (!storyboardId || panelIndex === null) continue
    const binding = { storyboardId, panelIndex }
    bindings.set(bindingKey(binding), binding)
  }
  return Array.from(bindings.values())
}

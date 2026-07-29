'use client'

import { useCallback } from 'react'
import { resolveVoiceLinePanelBindings } from '@/lib/novel-promotion/voice-line-binding'
import type { BindablePanelOption, VoiceLine } from './types'

interface UseVoiceLineBindingsParams {
  bindablePanelOptions: BindablePanelOption[]
  onVoiceLineClick?: (storyboardId: string, panelIndex: number) => void
  handleStartEdit: (line: VoiceLine, boundPanelId: string) => void
}

export function useVoiceLineBindings({
  bindablePanelOptions,
  onVoiceLineClick,
  handleStartEdit,
}: UseVoiceLineBindingsParams) {
  const getBoundPanelIdForLine = useCallback((line: VoiceLine): string => {
    if (typeof line.matchedPanelId === 'string' && line.matchedPanelId.trim()) {
      return line.matchedPanelId.trim()
    }
    const binding = resolveVoiceLinePanelBindings(line)[0]
    if (!binding) return ''
    if (binding.panelId) return binding.panelId
    const matched = bindablePanelOptions.find((option) => (
      option.storyboardId === binding.storyboardId && option.panelIndex === binding.panelIndex
    ))
    return matched?.id || ''
  }, [bindablePanelOptions])

  const handleStartEditLine = useCallback((line: VoiceLine) => {
    handleStartEdit(line, getBoundPanelIdForLine(line))
  }, [getBoundPanelIdForLine, handleStartEdit])

  const handleLocatePanel = useCallback((voiceLine: VoiceLine) => {
    if (!onVoiceLineClick) return

    const binding = resolveVoiceLinePanelBindings(voiceLine)[0]
    if (!binding) return
    const matchedPanel = binding.panelId
      ? bindablePanelOptions.find((option) => option.id === binding.panelId)
      : null
    const targetStoryboardId = binding.storyboardId || matchedPanel?.storyboardId || null
    const targetPanelIndex = binding.panelIndex ?? matchedPanel?.panelIndex ?? null

    if (!targetStoryboardId || targetPanelIndex === null || targetPanelIndex === undefined) return
    onVoiceLineClick(targetStoryboardId, targetPanelIndex)
  }, [bindablePanelOptions, onVoiceLineClick])

  const handleDownloadSingle = (audioUrl: string) => {
    window.open(audioUrl, '_blank')
  }

  return {
    getBoundPanelIdForLine,
    handleStartEditLine,
    handleLocatePanel,
    handleDownloadSingle,
  }
}

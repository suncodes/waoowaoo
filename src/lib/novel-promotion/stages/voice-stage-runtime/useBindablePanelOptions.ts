'use client'

import { useMemo } from 'react'
import type { BindablePanelOption, EpisodeClip, EpisodeStoryboard, VoiceLine } from './types'

interface UseBindablePanelOptionsParams {
  episodeData: unknown
  t: (key: string, values?: { index: number }) => string
  voiceLines: VoiceLine[]
  selectedPanelId: string
}

export function useBindablePanelOptions({
  episodeData,
  t,
  voiceLines,
  selectedPanelId,
}: UseBindablePanelOptionsParams) {
  return useMemo<BindablePanelOption[]>(() => {
    const payload = episodeData as { storyboards?: EpisodeStoryboard[]; clips?: EpisodeClip[] } | null
    const storyboards = payload?.storyboards || []
    const clips = payload?.clips || []
    const clipIndexMap = new Map<string, number>()
    clips.forEach((clip, index) => {
      clipIndexMap.set(clip.id, index)
    })

    const sortedStoryboards = [...storyboards].sort((a, b) => {
      const aIndex = a.clipId ? clipIndexMap.get(a.clipId) : undefined
      const bIndex = b.clipId ? clipIndexMap.get(b.clipId) : undefined

      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex
      if (aIndex !== undefined) return -1
      if (bIndex !== undefined) return 1
      return 0
    })

    const options: BindablePanelOption[] = []
    const occupiedPanelIds = new Set(
      voiceLines
        .map((line) => line.matchedPanelId)
        .filter((panelId): panelId is string => typeof panelId === 'string' && panelId.length > 0),
    )
    let globalPanelOrder = 1

    for (const storyboard of sortedStoryboards) {
      const panels = [...(storyboard.panels || [])].sort((a, b) => a.panelIndex - b.panelIndex)
      for (const panel of panels) {
        if (occupiedPanelIds.has(panel.id) && panel.id !== selectedPanelId) {
          globalPanelOrder += 1
          continue
        }
        const previewSource = (panel.srtSegment || panel.description || '').replace(/\s+/g, ' ').trim()
        const previewText = previewSource ? ` - ${previewSource.slice(0, 28)}` : ''
        options.push({
          id: panel.id,
          storyboardId: storyboard.id,
          panelIndex: panel.panelIndex,
          label: t('lineEditor.panelLabel', { index: globalPanelOrder }) + previewText,
        })
        globalPanelOrder += 1
      }
    }

    return options
  }, [episodeData, selectedPanelId, t, voiceLines])
}

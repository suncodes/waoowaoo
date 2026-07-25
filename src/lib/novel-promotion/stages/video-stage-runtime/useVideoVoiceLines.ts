'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { logError as _ulogError } from '@/lib/logging/core'
import { useVoiceTaskPresentation } from '@/lib/query/hooks/useTaskPresentation'
import type { MatchedVoiceLine } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import type { VoiceLine } from './types'
import { buildVoiceLineTargets } from './task-targets'

interface MatchedVoiceLinesQueryLike {
  data?: {
    voiceLines?: Array<{
      id: string
      lineIndex: number
      speaker: string
      content: string
      audioUrl: string | null
      audioDuration?: number | null
      matchedPanelId?: string | null
      matchedStoryboardId: string | null
      matchedPanelIndex: number | null
      panelSpans?: Array<{
        panelId: string
        panel?: {
          storyboardId?: string | null
          panelIndex?: number | null
        } | null
      }>
    }>
  }
  refetch: () => Promise<unknown>
}

type MatchedVoiceLineQueryRow = NonNullable<NonNullable<MatchedVoiceLinesQueryLike['data']>['voiceLines']>[number]

function panelKey(storyboardId: string | null | undefined, panelIndex: number | null | undefined) {
  if (!storyboardId || panelIndex === null || panelIndex === undefined) return ''
  return `${storyboardId}-${panelIndex}`
}

function voiceLinePanelKeys(voiceLine: MatchedVoiceLineQueryRow) {
  const keys = new Set<string>()
  for (const span of voiceLine.panelSpans || []) {
    if (span.panelId?.trim()) {
      keys.add(span.panelId.trim())
      continue
    }
    const key = panelKey(span.panel?.storyboardId, span.panel?.panelIndex)
    if (key) keys.add(key)
  }
  if (keys.size === 0 && voiceLine.matchedPanelId?.trim()) keys.add(voiceLine.matchedPanelId.trim())
  const fallbackKey = panelKey(voiceLine.matchedStoryboardId, voiceLine.matchedPanelIndex)
  if (keys.size === 0 && fallbackKey) keys.add(fallbackKey)
  return keys
}

interface UseVideoVoiceLinesParams {
  projectId: string
  matchedVoiceLinesQuery: MatchedVoiceLinesQueryLike
}

export function useVideoVoiceLines({
  projectId,
  matchedVoiceLinesQuery,
}: UseVideoVoiceLinesParams) {
  const [panelVoiceLines, setPanelVoiceLines] = useState<Map<string, MatchedVoiceLine[]>>(new Map())
  const [allVoiceLines, setAllVoiceLines] = useState<VoiceLine[]>([])

  useEffect(() => {
    const voiceLines = matchedVoiceLinesQuery.data?.voiceLines || []
    const panelMap = new Map<string, MatchedVoiceLine[]>()

    for (const voiceLine of voiceLines) {
      const matchedLine = {
        id: voiceLine.id,
        lineIndex: voiceLine.lineIndex,
        speaker: voiceLine.speaker,
        content: voiceLine.content,
        audioUrl: voiceLine.audioUrl || undefined,
        audioDuration: voiceLine.audioDuration || undefined,
      }
      for (const key of voiceLinePanelKeys(voiceLine)) {
        const existing = panelMap.get(key) || []
        existing.push(matchedLine)
        panelMap.set(key, existing)
      }
    }

    setPanelVoiceLines(panelMap)
    setAllVoiceLines(voiceLines as VoiceLine[])
  }, [matchedVoiceLinesQuery.data])

  const voiceLineTargets = useMemo(() => buildVoiceLineTargets(allVoiceLines), [allVoiceLines])
  const voiceLineStates = useVoiceTaskPresentation(projectId, voiceLineTargets, {
    enabled: !!projectId && voiceLineTargets.length > 0,
  })

  const runningVoiceLineIds = useMemo(() => {
    const ids = new Set<string>()
    for (const target of voiceLineTargets) {
      const state = voiceLineStates.getTaskState(target.key)
      if (state?.phase === 'queued' || state?.phase === 'processing') {
        ids.add(target.targetId)
      }
    }
    return ids
  }, [voiceLineStates, voiceLineTargets])

  const reloadVoiceLines = useCallback(async () => {
    try {
      await matchedVoiceLinesQuery.refetch()
    } catch (error) {
      _ulogError('Failed to reload voice lines:', error)
    }
  }, [matchedVoiceLinesQuery])

  return {
    panelVoiceLines,
    allVoiceLines,
    runningVoiceLineIds,
    reloadVoiceLines,
  }
}

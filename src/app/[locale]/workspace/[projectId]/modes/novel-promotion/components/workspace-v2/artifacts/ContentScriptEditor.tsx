'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'
import ScriptViewScriptPanel from '../../script-view/ScriptViewScriptPanel'

interface ClipUpdate {
  summary?: string
  content?: string
  screenplay?: string | null
  characters?: string | null
  location?: string | null
}

function toTranslationValues(values?: Record<string, unknown>) {
  return values as never
}

export default function ContentScriptEditor() {
  const runtime = useWorkspaceStageRuntime()
  const { clips } = useWorkspaceEpisodeStageData()
  const t = useTranslations('smartImport')
  const tScript = useTranslations('scriptView')
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.id || null)
  const [savingClips, setSavingClips] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (clips.length === 0) {
      setSelectedClipId(null)
      return
    }
    if (!selectedClipId || !clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(clips[0].id)
    }
  }, [clips, selectedClipId])

  const handleClipUpdate = async (clipId: string, data: ClipUpdate) => {
    setSavingClips((previous) => new Set(previous).add(clipId))
    try {
      await runtime.onClipUpdate(clipId, data)
    } finally {
      setSavingClips((previous) => {
        const next = new Set(previous)
        next.delete(clipId)
        return next
      })
    }
  }

  return (
    <ScriptViewScriptPanel
      clips={clips}
      selectedClipId={selectedClipId}
      onSelectClip={setSelectedClipId}
      savingClips={savingClips}
      onClipUpdate={(clipId, data) => { void handleClipUpdate(clipId, data) }}
      t={(key, values) => t(key, toTranslationValues(values))}
      tScript={(key, values) => tScript(key, toTranslationValues(values))}
      fullWidth
    />
  )
}

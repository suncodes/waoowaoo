'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { readContentArtifactMeta } from '@/lib/creation-workspace/artifact-state'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'
import ScriptViewScriptPanel from '../../script-view/ScriptViewScriptPanel'
import ContentArtifactSummary from './ContentArtifactSummary'
import ContentUnitActions from './ContentUnitActions'

interface ClipUpdate {
  summary?: string
  content?: string
  screenplay?: string | null
  characters?: string | null
  location?: string | null
  props?: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toTranslationValues(values?: Record<string, unknown>) {
  return values as never
}

export default function ContentScriptEditor() {
  const runtime = useWorkspaceStageRuntime()
  const { clips, contentPlan } = useWorkspaceEpisodeStageData()
  const t = useTranslations('smartImport')
  const tScript = useTranslations('scriptView')
  const tEditor = useTranslations('novelPromotion.workspaceFlow.v2.contentEditor')
  const meta = useMemo(() => readContentArtifactMeta(contentPlan), [contentPlan])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.id || null)
  const [savingClips, setSavingClips] = useState<Set<string>>(new Set())
  const [scriptDirty, setScriptDirty] = useState(false)
  const [saveError, setSaveError] = useState('')
  const onContentEditingStateChange = runtime.onContentEditingStateChange

  useEffect(() => {
    if (clips.length === 0) {
      setSelectedClipId(null)
      return
    }
    if (!selectedClipId || !clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(clips[0].id)
    }
  }, [clips, selectedClipId])

  useEffect(() => {
    onContentEditingStateChange({
      dirty: scriptDirty || saveError.length > 0,
      saving: savingClips.size > 0,
    })
  }, [onContentEditingStateChange, saveError.length, savingClips.size, scriptDirty])

  useEffect(() => () => {
    onContentEditingStateChange({ dirty: false, saving: false })
  }, [onContentEditingStateChange])

  const lockedClipIds = useMemo(() => new Set(
    Object.entries(meta?.units || {}).flatMap(([unitId, state]) => state.locked ? [unitId] : []),
  ), [meta?.units])
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) || null
  const selectedState = selectedClipId ? meta?.units[selectedClipId] : undefined
  const candidate = asRecord(selectedState?.candidate?.value)
  const candidateTitle = typeof candidate?.summary === 'string' ? candidate.summary : ''
  const candidateBody = typeof candidate?.content === 'string'
    ? candidate.content
    : typeof candidate?.screenplay === 'string'
      ? candidate.screenplay
      : ''

  const handleClipUpdate = async (clipId: string, data: ClipUpdate) => {
    if (lockedClipIds.has(clipId)) return
    setSavingClips((previous) => new Set(previous).add(clipId))
    setSaveError('')
    try {
      await runtime.onClipUpdate(clipId, data)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : tEditor('saveFailed'))
    } finally {
      setSavingClips((previous) => {
        const next = new Set(previous)
        next.delete(clipId)
        return next
      })
    }
  }

  return (
    <section className="min-w-0">
      <ContentArtifactSummary meta={meta} />
      {selectedClip ? (
        <div className="mb-4 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-[var(--glass-text-tertiary)]">{tEditor('selectedScriptUnit')}</p>
              <h2 className="mt-1 truncate text-sm font-semibold text-[var(--glass-text-primary)]">{selectedClip.summary || selectedClip.content}</h2>
            </div>
            <span className="text-xs text-[var(--glass-text-tertiary)]">{tEditor('scriptUnitCount', { count: clips.length })}</span>
          </div>
          <ContentUnitActions
            unitId={selectedClip.id}
            state={selectedState}
            candidateTitle={candidateTitle}
            candidateBody={candidateBody}
            disabled={scriptDirty || savingClips.has(selectedClip.id)}
          />
        </div>
      ) : null}

      {saveError ? <p className="mb-3 rounded-md bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-xs text-[var(--glass-tone-danger-fg)]">{saveError}</p> : null}

      <ScriptViewScriptPanel
        clips={clips}
        selectedClipId={selectedClipId}
        onSelectClip={setSelectedClipId}
        savingClips={savingClips}
        onClipUpdate={(clipId, data) => handleClipUpdate(clipId, data)}
        t={(key, values) => t(key, toTranslationValues(values))}
        tScript={(key, values) => tScript(key, toTranslationValues(values))}
        fullWidth
        readOnlyClipIds={lockedClipIds}
        readOnlyLabel={tEditor('locked')}
        onDirtyStateChange={setScriptDirty}
      />
    </section>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { readContentArtifactMeta } from '@/lib/creation-workspace/artifact-state'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'
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

interface ScriptDraft {
  summary: string
  content: string
  screenplay: string
  characters: string
  location: string
  props: string
}

function createDraft(clip: ClipUpdate | null): ScriptDraft {
  return {
    summary: clip?.summary || '',
    content: clip?.content || '',
    screenplay: clip?.screenplay || '',
    characters: clip?.characters || '',
    location: clip?.location || '',
    props: clip?.props || '',
  }
}

export default function ContentScriptEditor() {
  const runtime = useWorkspaceStageRuntime()
  const { clips, contentPlan } = useWorkspaceEpisodeStageData()
  const meta = useMemo(() => readContentArtifactMeta(contentPlan), [contentPlan])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.id || null)
  const [savingClips, setSavingClips] = useState<Set<string>>(new Set())
  const [scriptDirty, setScriptDirty] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [draft, setDraft] = useState<ScriptDraft>(() => createDraft(clips[0] || null))
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
  const candidateClipIds = useMemo(() => new Set(
    Object.entries(meta?.units || {}).flatMap(([unitId, state]) => state.candidate ? [unitId] : []),
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

  useEffect(() => {
    setDraft(createDraft(selectedClip))
    setScriptDirty(false)
    setSaveError('')
  }, [selectedClip])

  const handleClipUpdate = async (clipId: string, data: ClipUpdate) => {
    if (lockedClipIds.has(clipId)) return false
    setSavingClips((previous) => new Set(previous).add(clipId))
    setSaveError('')
    try {
      await runtime.onClipUpdate(clipId, data)
      return true
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '文稿保存失败')
      return false
    } finally {
      setSavingClips((previous) => {
        const next = new Set(previous)
        next.delete(clipId)
        return next
      })
    }
  }

  const updateDraft = (field: keyof ScriptDraft, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }))
    setScriptDirty(true)
  }

  const saveSelected = async () => {
    if (!selectedClip || !scriptDirty) return
    const saved = await handleClipUpdate(selectedClip.id, {
      summary: draft.summary.trim(),
      content: draft.content,
      screenplay: draft.screenplay || null,
      characters: draft.characters || null,
      location: draft.location || null,
      props: draft.props || null,
    })
    if (saved) setScriptDirty(false)
  }

  const selectClip = (clipId: string) => {
    if (clipId === selectedClipId) return
    if (scriptDirty && !window.confirm('当前段落还有未保存修改，确定切换吗？')) return
    setSelectedClipId(clipId)
  }

  return (
    <section className="grid min-h-[620px] min-w-0 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-lg border border-white/10 bg-[#10110f]">
        <div className="border-b border-white/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-stone-100">文稿段落</h2>
            <span className="text-xs text-stone-500">{clips.length}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-stone-500">按叙事顺序逐段编辑和确认。</p>
        </div>
        <div className="space-y-1.5 p-2">
          {clips.map((clip, index) => {
            const active = clip.id === selectedClipId
            const locked = lockedClipIds.has(clip.id)
            const hasCandidate = candidateClipIds.has(clip.id)
            return (
              <button
                key={clip.id}
                type="button"
                onClick={() => selectClip(clip.id)}
                className={`grid w-full grid-cols-[28px_minmax(0,1fr)_16px] items-start gap-2 rounded-md border px-2.5 py-2.5 text-left transition-colors ${active
                  ? 'border-[#e8d18a]/50 bg-[#e8d18a]/10'
                  : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]'
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded bg-white/[0.06] text-xs font-semibold text-stone-400">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-stone-200">{clip.summary || `段落 ${index + 1}`}</span>
                  <span className="mt-1 block truncate text-[11px] text-stone-500">{clip.location || clip.characters || '未标注场景与角色'}</span>
                </span>
                {hasCandidate ? <AppIcon name="sparkles" className="mt-1 h-3.5 w-3.5 text-cyan-200" /> : locked ? <AppIcon name="lock" className="mt-1 h-3.5 w-3.5 text-emerald-300" /> : null}
              </button>
            )
          })}
        </div>
      </aside>

      {selectedClip ? (
        <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#10110f]">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#c8a85f]">当前段落</p>
              <h2 className="mt-1 truncate text-base font-semibold text-stone-50">{selectedClip.summary || '未命名段落'}</h2>
              <p className={`mt-1 text-xs ${candidate ? 'text-cyan-200' : 'text-stone-500'}`}>
                修订 {selectedState?.revision || 0} · {candidate ? 'AI 候选待确认' : selectedState?.locked ? '已锁定' : scriptDirty ? '有未保存修改' : '已同步'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {scriptDirty ? (
                <button type="button" onClick={() => { setDraft(createDraft(selectedClip)); setScriptDirty(false) }} className="h-9 rounded-md px-3 text-xs font-semibold text-stone-400 hover:bg-white/[0.05] hover:text-stone-100">
                  撤销修改
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => { void saveSelected() }}
                disabled={!scriptDirty || savingClips.has(selectedClip.id) || selectedState?.locked}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <AppIcon name={savingClips.has(selectedClip.id) ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${savingClips.has(selectedClip.id) ? 'animate-spin' : ''}`} />
                保存段落
              </button>
            </div>
          </header>

          {saveError ? <p className="mx-5 mt-4 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{saveError}</p> : null}

          <div className="space-y-4 p-5">
            <label className="block text-xs font-semibold text-stone-400">
              段落标题
              <input
                value={draft.summary}
                onChange={(event) => updateDraft('summary', event.target.value)}
                disabled={selectedState?.locked}
                className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#151613] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a] disabled:opacity-60"
              />
            </label>
            <label className="block text-xs font-semibold text-stone-400">
              叙事内容
              <textarea
                value={draft.content}
                onChange={(event) => updateDraft('content', event.target.value)}
                disabled={selectedState?.locked}
                rows={7}
                className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#151613] px-3 py-3 text-sm leading-7 text-stone-200 outline-none focus:border-[#e8d18a] disabled:opacity-60"
              />
            </label>
            <label className="block text-xs font-semibold text-stone-400">
              镜头化剧本
              <textarea
                value={draft.screenplay}
                onChange={(event) => updateDraft('screenplay', event.target.value)}
                disabled={selectedState?.locked}
                rows={6}
                placeholder="补充对白、动作和镜头意图"
                className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#151613] px-3 py-3 text-sm leading-7 text-stone-200 outline-none focus:border-[#e8d18a] disabled:opacity-60"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <StudioMetadataField label="角色" value={draft.characters} onChange={(value) => updateDraft('characters', value)} disabled={selectedState?.locked} />
              <StudioMetadataField label="场景" value={draft.location} onChange={(value) => updateDraft('location', value)} disabled={selectedState?.locked} />
              <StudioMetadataField label="道具" value={draft.props} onChange={(value) => updateDraft('props', value)} disabled={selectedState?.locked} />
            </div>

            <ContentUnitActions
              unitId={selectedClip.id}
              state={selectedState}
              candidateTitle={candidateTitle}
              candidateBody={candidateBody}
              disabled={scriptDirty || savingClips.has(selectedClip.id)}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function StudioMetadataField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className="block text-xs font-semibold text-stone-400">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#151613] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a] disabled:opacity-60"
      />
    </label>
  )
}

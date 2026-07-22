'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { GuideContentPlan } from '@/lib/content-planning'
import {
  cloneWorkspaceValue,
  readContentArtifactMeta,
} from '@/lib/creation-workspace/artifact-state'
import {
  addGuideSegment,
  mergeGuideSegmentWithNext,
  moveGuideSegment,
  removeGuideSegment,
  splitGuideSegment,
  type GuidePlanMutation,
} from '@/lib/creation-workspace/guide-editor'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'
import ContentUnitActions from './ContentUnitActions'

type EditableSegmentField = 'title' | 'narration' | 'visualPurpose' | 'onScreenText'
type SourceField = 'label' | 'chapter' | 'quote'

function isGuidePlan(value: unknown): value is GuideContentPlan {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { planType?: unknown }).planType === 'guide'
    && Array.isArray((value as { segments?: unknown }).segments)
    && Array.isArray((value as { outline?: unknown }).outline)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function candidatePreview(value: unknown) {
  const candidate = asRecord(value)
  return {
    title: typeof candidate?.title === 'string' ? candidate.title : '',
    body: typeof candidate?.narration === 'string' ? candidate.narration : '',
  }
}

function candidateIssueCount(review: unknown) {
  const record = asRecord(review)
  return Array.isArray(record?.issues) ? record.issues.length : 0
}

function createSegmentId() {
  return `segment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export default function GuideNarrationEditor() {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.contentEditor')
  const runtime = useWorkspaceStageRuntime()
  const { contentPlan, contentReview } = useWorkspaceEpisodeStageData()
  const sourcePlan = useMemo(
    () => isGuidePlan(contentPlan) ? cloneWorkspaceValue(contentPlan) : null,
    [contentPlan],
  )
  const meta = useMemo(() => readContentArtifactMeta(contentPlan), [contentPlan])
  const [draftPlan, setDraftPlan] = useState<GuideContentPlan | null>(sourcePlan)
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [cursorByUnit, setCursorByUnit] = useState<Record<string, number>>({})
  const [selectedSegmentId, setSelectedSegmentId] = useState(sourcePlan?.segments[0]?.id || '')
  const [saveError, setSaveError] = useState('')
  const editVersionByUnitRef = useRef<Record<string, number>>({})
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const onContentEditingStateChange = runtime.onContentEditingStateChange

  useEffect(() => {
    if (dirtyIds.size === 0) setDraftPlan(sourcePlan)
  }, [dirtyIds.size, sourcePlan])

  useEffect(() => {
    if (!draftPlan?.segments.length) {
      setSelectedSegmentId('')
      return
    }
    if (!draftPlan.segments.some((segment) => segment.id === selectedSegmentId)) {
      setSelectedSegmentId(draftPlan.segments[0].id)
    }
  }, [draftPlan, selectedSegmentId])

  useEffect(() => {
    onContentEditingStateChange({ dirty: dirtyIds.size > 0, saving: savingIds.size > 0 })
  }, [dirtyIds.size, onContentEditingStateChange, savingIds.size])

  useEffect(() => () => {
    onContentEditingStateChange({ dirty: false, saving: false })
  }, [onContentEditingStateChange])

  const reviewIssues = useMemo(() => {
    const review = asRecord(contentReview)
    return Array.isArray(review?.issues) ? review.issues.map(asRecord).filter(Boolean) : []
  }, [contentReview])

  const markDirty = (unitIds: string[]) => {
    const ids = [...new Set(unitIds.filter(Boolean))]
    ids.forEach((unitId) => {
      editVersionByUnitRef.current[unitId] = (editVersionByUnitRef.current[unitId] || 0) + 1
    })
    setDirtyIds((previous) => new Set([...previous, ...ids]))
  }

  const savePlan = (plan: GuideContentPlan, unitIds: string[]) => {
    const ids = [...new Set(unitIds.filter(Boolean))]
    if (ids.length === 0) return Promise.resolve()
    const savedVersions = new Map(ids.map((unitId) => [
      unitId,
      editVersionByUnitRef.current[unitId] || 0,
    ]))
    setSavingIds((previous) => new Set([...previous, ...ids]))
    const operation = async () => {
      setSaveError('')
      try {
        await runtime.onSaveGuidePlan(plan, ids)
        setDirtyIds((previous) => {
          const next = new Set(previous)
          ids.forEach((id) => {
            if ((editVersionByUnitRef.current[id] || 0) === savedVersions.get(id)) {
              next.delete(id)
            }
          })
          return next
        })
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : t('saveFailed'))
      } finally {
        setSavingIds((previous) => {
          const next = new Set(previous)
          ids.forEach((id) => next.delete(id))
          return next
        })
      }
    }
    const queued = saveQueueRef.current.then(operation)
    saveQueueRef.current = queued
    return queued
  }

  const persistMutation = (mutation: GuidePlanMutation | null) => {
    if (!mutation) return
    const changedUnitIds = [...new Set([...dirtyIds, ...mutation.changedUnitIds])]
    setDraftPlan(mutation.plan)
    setSelectedSegmentId(mutation.focusUnitId)
    markDirty(changedUnitIds)
    void savePlan(mutation.plan, changedUnitIds)
    requestAnimationFrame(() => {
      document.getElementById(`guide-unit-${mutation.focusUnitId}`)?.scrollIntoView({ block: 'nearest' })
    })
  }

  const updateSegment = (index: number, field: EditableSegmentField, value: string) => {
    if (!draftPlan) return
    const next = cloneWorkspaceValue(draftPlan)
    next.segments[index] = { ...next.segments[index], [field]: value }
    setDraftPlan(next)
    markDirty([next.segments[index].id])
  }

  const updateSource = (index: number, field: SourceField, value: string) => {
    if (!draftPlan) return
    const next = cloneWorkspaceValue(draftPlan)
    next.segments[index] = {
      ...next.segments[index],
      sourceAnchor: {
        ...next.segments[index].sourceAnchor,
        [field]: value || undefined,
      },
    }
    setDraftPlan(next)
    markDirty([next.segments[index].id])
  }

  const updateVisualHints = (index: number, value: string) => {
    if (!draftPlan) return
    const next = cloneWorkspaceValue(draftPlan)
    next.segments[index] = {
      ...next.segments[index],
      visualHints: value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
    }
    setDraftPlan(next)
    markDirty([next.segments[index].id])
  }

  const saveUnitIfDirty = (unitId: string) => {
    if (draftPlan && dirtyIds.has(unitId) && !savingIds.has(unitId)) {
      void savePlan(draftPlan, [unitId])
    }
  }

  if (!draftPlan || draftPlan.segments.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#10110f] px-5 py-10 text-center">
        <AppIcon name="fileText" className="h-9 w-9 text-stone-600" />
        <h2 className="mt-3 text-base font-semibold text-stone-100">{t('emptyTitle')}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500">{t('emptyDescription')}</p>
      </div>
    )
  }

  const selectedIndex = Math.max(0, draftPlan.segments.findIndex((segment) => segment.id === selectedSegmentId))
  const segment = draftPlan.segments[selectedIndex]
  const unitState = meta?.units[segment.id]
  const locked = unitState?.locked === true
  const saving = savingIds.has(segment.id)
  const nextLocked = meta?.units[draftPlan.segments[selectedIndex + 1]?.id]?.locked === true
  const previousLocked = meta?.units[draftPlan.segments[selectedIndex - 1]?.id]?.locked === true
  const issueCount = reviewIssues.filter((issue) => issue?.segmentId === segment.id).length
  const candidate = candidatePreview(unitState?.candidate?.value)

  return (
    <section className="grid min-h-[640px] min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-lg border border-white/10 bg-[#10110f]">
        <div className="border-b border-white/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-stone-100">导读段落</h2>
            <span className="text-xs text-stone-500">{draftPlan.segments.length}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-stone-500">按叙事顺序编辑解读内容和视觉意图。</p>
        </div>
        <div className="space-y-1.5 p-2">
          {draftPlan.segments.map((item, index) => {
            const state = meta?.units[item.id]
            const active = item.id === segment.id
            const itemIssues = reviewIssues.filter((issue) => issue?.segmentId === item.id).length
            return (
              <button
                id={`guide-unit-${item.id}`}
                key={item.id}
                type="button"
                onClick={() => setSelectedSegmentId(item.id)}
                className={`grid w-full grid-cols-[28px_minmax(0,1fr)_16px] items-start gap-2 rounded-md border px-2.5 py-2.5 text-left transition-colors ${active ? 'border-[#e8d18a]/50 bg-[#e8d18a]/10' : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]'}`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded bg-white/[0.06] text-xs font-semibold text-stone-400">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-stone-200">{item.title || `段落 ${index + 1}`}</span>
                  <span className="mt-1 block truncate text-[11px] text-stone-500">{item.sourceAnchor.label || `${item.estimatedDurationSec} 秒`}</span>
                </span>
                {state?.candidate ? <AppIcon name="sparkles" className="mt-1 h-3.5 w-3.5 text-cyan-200" /> : state?.locked ? <AppIcon name="lock" className="mt-1 h-3.5 w-3.5 text-emerald-300" /> : itemIssues > 0 ? <AppIcon name="alert" className="mt-1 h-3.5 w-3.5 text-amber-300" /> : null}
              </button>
            )
          })}
        </div>
      </aside>

      <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#10110f]">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#c8a85f]">当前导读段落</p>
            <h2 className="mt-1 truncate text-base font-semibold text-stone-50">{segment.title || `段落 ${selectedIndex + 1}`}</h2>
            <p className={`mt-1 text-xs ${unitState?.candidate ? 'text-cyan-200' : 'text-stone-500'}`}>
              修订 {unitState?.revision || 0} · {unitState?.candidate ? 'AI 候选待确认' : locked ? '已锁定' : dirtyIds.has(segment.id) ? '有未保存修改' : '已同步'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 text-xs text-stone-500">
              <AppIcon name={savingIds.size > 0 ? 'loader' : dirtyIds.size > 0 ? 'edit' : 'check'} className={`h-3.5 w-3.5 ${savingIds.size > 0 ? 'animate-spin' : dirtyIds.size > 0 ? 'text-amber-300' : 'text-emerald-300'}`} />
              {savingIds.size > 0 ? t('saving') : dirtyIds.size > 0 ? t('unsaved') : t('autoSaved')}
            </span>
            {dirtyIds.size > 0 ? (
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { void savePlan(draftPlan, [...dirtyIds]) }} disabled={savingIds.size > 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:opacity-50">
                <AppIcon name={savingIds.size > 0 ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${savingIds.size > 0 ? 'animate-spin' : ''}`} />
                {t('saveChanges')}
              </button>
            ) : null}
          </div>
        </header>

        {saveError ? <p className="mx-5 mt-4 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{saveError}</p> : null}

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex flex-wrap gap-3 text-xs text-stone-500">
              <span>{t('duration', { seconds: segment.estimatedDurationSec })}</span>
              {issueCount > 0 ? <span className="text-amber-200">{t('reviewIssues', { count: issueCount })}</span> : null}
            </div>
            <div className="flex items-center gap-1">
              <IconAction title={t('moveUp')} icon="arrowUp" onClick={() => persistMutation(moveGuideSegment(draftPlan, selectedIndex, -1))} disabled={selectedIndex === 0 || locked || previousLocked || savingIds.size > 0} />
              <IconAction title={t('moveDown')} icon="arrowDown" onClick={() => persistMutation(moveGuideSegment(draftPlan, selectedIndex, 1))} disabled={selectedIndex === draftPlan.segments.length - 1 || locked || nextLocked || savingIds.size > 0} />
              <IconAction title={t('split')} icon="scissors" onClick={() => persistMutation(splitGuideSegment({ plan: draftPlan, index: selectedIndex, newId: createSegmentId(), newTitle: t('splitTitle', { title: segment.title }), cursor: cursorByUnit[segment.id] }))} disabled={locked || savingIds.size > 0 || segment.narration.trim().length < 8} />
              <IconAction title={t('mergeNext')} icon="merge" onClick={() => persistMutation(mergeGuideSegmentWithNext(draftPlan, selectedIndex))} disabled={selectedIndex === draftPlan.segments.length - 1 || locked || nextLocked || savingIds.size > 0} />
              <IconAction title={t('addAfter')} icon="plus" onClick={() => persistMutation(addGuideSegment({ plan: draftPlan, afterIndex: selectedIndex, newId: createSegmentId(), title: t('newSegmentTitle'), narration: t('newSegmentNarration'), sourceLabel: t('newSourceLabel') }))} disabled={savingIds.size > 0} />
              <IconAction title={t('delete')} icon="trash" danger onClick={() => persistMutation(removeGuideSegment(draftPlan, selectedIndex))} disabled={draftPlan.segments.length <= 1 || locked || savingIds.size > 0} />
            </div>
          </div>

          <label className="block text-xs font-semibold text-stone-400">
            段落标题
            <input value={segment.title} onChange={(event) => updateSegment(selectedIndex, 'title', event.target.value)} onBlur={() => saveUnitIfDirty(segment.id)} disabled={locked || saving} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#151613] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a] disabled:opacity-60" />
          </label>
          <label className="block text-xs font-semibold text-stone-400">
            导读旁白
            <textarea value={segment.narration} onChange={(event) => updateSegment(selectedIndex, 'narration', event.target.value)} onSelect={(event) => setCursorByUnit((previous) => ({ ...previous, [segment.id]: event.currentTarget.selectionStart }))} onBlur={() => saveUnitIfDirty(segment.id)} disabled={locked || saving} rows={9} className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#151613] px-3 py-3 text-sm leading-7 text-stone-200 outline-none focus:border-[#e8d18a] disabled:opacity-60" />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('sourceLabel')} value={segment.sourceAnchor.label} disabled={locked || saving} onChange={(value) => updateSource(selectedIndex, 'label', value)} onBlur={() => saveUnitIfDirty(segment.id)} />
            <Field label={t('sourceChapter')} value={segment.sourceAnchor.chapter || ''} disabled={locked || saving} onChange={(value) => updateSource(selectedIndex, 'chapter', value)} onBlur={() => saveUnitIfDirty(segment.id)} />
            <Field label={t('sourceQuote')} value={segment.sourceAnchor.quote || ''} disabled={locked || saving} onChange={(value) => updateSource(selectedIndex, 'quote', value)} onBlur={() => saveUnitIfDirty(segment.id)} multiline />
            <Field label={t('visualPurpose')} value={segment.visualPurpose} disabled={locked || saving} onChange={(value) => updateSegment(selectedIndex, 'visualPurpose', value)} onBlur={() => saveUnitIfDirty(segment.id)} multiline />
            <Field label={t('visualHints')} value={segment.visualHints.join('，')} disabled={locked || saving} onChange={(value) => updateVisualHints(selectedIndex, value)} onBlur={() => saveUnitIfDirty(segment.id)} multiline />
            <Field label={t('onScreenText')} value={segment.onScreenText || ''} disabled={locked || saving} onChange={(value) => updateSegment(selectedIndex, 'onScreenText', value)} onBlur={() => saveUnitIfDirty(segment.id)} multiline />
          </div>

          <ContentUnitActions unitId={segment.id} state={unitState} candidateTitle={candidate.title} candidateBody={candidate.body} candidateIssueCount={candidateIssueCount(unitState?.candidate?.review)} disabled={saving || dirtyIds.has(segment.id)} />
        </div>
      </div>
    </section>
  )
}

function IconAction({ title, icon, disabled, danger = false, onClick }: { title: string; icon: 'arrowUp' | 'arrowDown' | 'scissors' | 'merge' | 'plus' | 'trash'; disabled: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'text-rose-200' : 'text-stone-300'}`}>
      <AppIcon name={icon} className="h-3.5 w-3.5" />
    </button>
  )
}

function Field({
  label,
  value,
  disabled,
  multiline = false,
  onChange,
  onBlur,
}: {
  label: string
  value: string
  disabled: boolean
  multiline?: boolean
  onChange: (value: string) => void
  onBlur: () => void
}) {
  const className = 'mt-2 w-full rounded-md border border-white/10 bg-[#151613] px-3 py-2 text-sm text-stone-100 outline-none focus:border-[#e8d18a] disabled:cursor-not-allowed disabled:opacity-60'
  return (
    <label className="text-xs font-semibold text-stone-400">
      {label}
      {multiline ? (
        <textarea value={value} disabled={disabled} rows={2} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} className={`${className} resize-y`} />
      ) : (
        <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} className={className} />
      )}
    </label>
  )
}

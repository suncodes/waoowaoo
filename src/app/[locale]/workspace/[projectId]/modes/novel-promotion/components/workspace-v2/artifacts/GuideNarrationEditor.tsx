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
import ContentArtifactSummary from './ContentArtifactSummary'
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
  const [saveError, setSaveError] = useState('')
  const editVersionByUnitRef = useRef<Record<string, number>>({})
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const onContentEditingStateChange = runtime.onContentEditingStateChange

  useEffect(() => {
    if (dirtyIds.size === 0) setDraftPlan(sourcePlan)
  }, [dirtyIds.size, sourcePlan])

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
      <div className="flex min-h-72 flex-col items-center justify-center border-y border-[var(--glass-stroke-base)] px-5 py-10 text-center">
        <AppIcon name="fileText" className="h-9 w-9 text-[var(--glass-text-tertiary)]" />
        <h2 className="mt-3 text-base font-semibold text-[var(--glass-text-primary)]">{t('emptyTitle')}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('emptyDescription')}</p>
      </div>
    )
  }

  return (
    <section className="min-w-0">
      <ContentArtifactSummary meta={meta} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--glass-stroke-base)] pb-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
          <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('description', { count: draftPlan.segments.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 text-xs text-[var(--glass-text-tertiary)]">
            <AppIcon name={savingIds.size > 0 ? 'loader' : dirtyIds.size > 0 ? 'edit' : 'check'} className={`h-3.5 w-3.5 ${savingIds.size > 0 ? 'animate-spin' : dirtyIds.size > 0 ? 'text-[var(--glass-tone-warning-fg)]' : 'text-[var(--glass-tone-success-fg)]'}`} />
            {savingIds.size > 0 ? t('saving') : dirtyIds.size > 0 ? t('unsaved') : t('autoSaved')}
          </span>
          {dirtyIds.size > 0 ? (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { void savePlan(draftPlan, [...dirtyIds]) }} disabled={savingIds.size > 0} className="glass-btn-base glass-btn-primary h-8 px-3 text-xs">
              <AppIcon name={savingIds.size > 0 ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${savingIds.size > 0 ? 'animate-spin' : ''}`} />
              {t('saveChanges')}
            </button>
          ) : null}
        </div>
      </div>

      {saveError ? <p className="mb-3 rounded-md bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-xs text-[var(--glass-tone-danger-fg)]">{saveError}</p> : null}

      <div className="space-y-3">
        {draftPlan.segments.map((segment, index) => {
          const unitState = meta?.units[segment.id]
          const locked = unitState?.locked === true
          const saving = savingIds.has(segment.id)
          const nextLocked = meta?.units[draftPlan.segments[index + 1]?.id]?.locked === true
          const previousLocked = meta?.units[draftPlan.segments[index - 1]?.id]?.locked === true
          const issueCount = reviewIssues.filter((issue) => issue?.segmentId === segment.id).length
          const candidate = candidatePreview(unitState?.candidate?.value)
          return (
            <article id={`guide-unit-${segment.id}`} key={segment.id} className={`rounded-lg border bg-[var(--glass-bg-surface)] p-4 ${locked ? 'border-[var(--glass-tone-info-fg)]/40' : 'border-[var(--glass-stroke-base)]'}`}>
              <div className="flex flex-wrap items-start gap-3">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--glass-bg-muted)] text-xs font-semibold text-[var(--glass-text-secondary)]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    value={segment.title}
                    onChange={(event) => updateSegment(index, 'title', event.target.value)}
                    onBlur={() => saveUnitIfDirty(segment.id)}
                    disabled={locked || saving}
                    aria-label={t('segmentTitle', { index: index + 1 })}
                    className="h-8 w-full border-0 bg-transparent text-sm font-semibold text-[var(--glass-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-stroke-focus)] disabled:cursor-not-allowed disabled:opacity-70"
                  />
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--glass-text-tertiary)]">
                    <span>{t('duration', { seconds: segment.estimatedDurationSec })}</span>
                    {locked ? <span className="inline-flex items-center gap-1 text-[var(--glass-tone-info-fg)]"><AppIcon name="lock" className="h-3 w-3" />{t('locked')}</span> : null}
                    {issueCount > 0 ? <span className="text-[var(--glass-tone-warning-fg)]">{t('reviewIssues', { count: issueCount })}</span> : null}
                    {dirtyIds.has(segment.id) ? <span className="text-[var(--glass-tone-warning-fg)]">{t('changed')}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => persistMutation(moveGuideSegment(draftPlan, index, -1))} disabled={index === 0 || locked || previousLocked || savingIds.size > 0} className="glass-btn-base glass-btn-secondary h-8 w-8 p-0" title={t('moveUp')}><AppIcon name="arrowUp" className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => persistMutation(moveGuideSegment(draftPlan, index, 1))} disabled={index === draftPlan.segments.length - 1 || locked || nextLocked || savingIds.size > 0} className="glass-btn-base glass-btn-secondary h-8 w-8 p-0" title={t('moveDown')}><AppIcon name="arrowDown" className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => persistMutation(splitGuideSegment({ plan: draftPlan, index, newId: createSegmentId(), newTitle: t('splitTitle', { title: segment.title }), cursor: cursorByUnit[segment.id] }))} disabled={locked || savingIds.size > 0 || segment.narration.trim().length < 8} className="glass-btn-base glass-btn-secondary h-8 w-8 p-0" title={t('split')}><AppIcon name="scissors" className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => persistMutation(mergeGuideSegmentWithNext(draftPlan, index))} disabled={index === draftPlan.segments.length - 1 || locked || nextLocked || savingIds.size > 0} className="glass-btn-base glass-btn-secondary h-8 w-8 p-0" title={t('mergeNext')}><AppIcon name="merge" className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => persistMutation(addGuideSegment({ plan: draftPlan, afterIndex: index, newId: createSegmentId(), title: t('newSegmentTitle'), narration: t('newSegmentNarration'), sourceLabel: t('newSourceLabel') }))} disabled={savingIds.size > 0} className="glass-btn-base glass-btn-secondary h-8 w-8 p-0" title={t('addAfter')}><AppIcon name="plus" className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => persistMutation(removeGuideSegment(draftPlan, index))} disabled={draftPlan.segments.length <= 1 || locked || savingIds.size > 0} className="glass-btn-base glass-btn-secondary h-8 w-8 p-0 text-[var(--glass-tone-danger-fg)]" title={t('delete')}><AppIcon name="trash" className="h-3.5 w-3.5" /></button>
                </div>
              </div>

              <textarea
                value={segment.narration}
                onChange={(event) => updateSegment(index, 'narration', event.target.value)}
                onSelect={(event) => setCursorByUnit((previous) => ({ ...previous, [segment.id]: event.currentTarget.selectionStart }))}
                onBlur={() => saveUnitIfDirty(segment.id)}
                disabled={locked || saving}
                aria-label={t('narrationLabel', { index: index + 1 })}
                rows={4}
                className="mt-3 w-full resize-y rounded-md border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm leading-6 text-[var(--glass-text-secondary)] outline-none transition-colors focus:border-[var(--glass-stroke-focus)] focus:ring-2 focus:ring-[var(--glass-focus-ring)] disabled:cursor-not-allowed disabled:opacity-70"
              />

              <details className="group mt-3 rounded-md bg-[var(--glass-bg-muted)] px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-[var(--glass-text-secondary)]">
                  <span className="inline-flex items-center gap-2"><AppIcon name="link" className="h-3.5 w-3.5" />{t('sourceAndVisual')}</span>
                  <AppIcon name="chevronDown" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Field label={t('sourceLabel')} value={segment.sourceAnchor.label} disabled={locked || saving} onChange={(value) => updateSource(index, 'label', value)} onBlur={() => saveUnitIfDirty(segment.id)} />
                  <Field label={t('sourceChapter')} value={segment.sourceAnchor.chapter || ''} disabled={locked || saving} onChange={(value) => updateSource(index, 'chapter', value)} onBlur={() => saveUnitIfDirty(segment.id)} />
                  <Field label={t('sourceQuote')} value={segment.sourceAnchor.quote || ''} disabled={locked || saving} onChange={(value) => updateSource(index, 'quote', value)} onBlur={() => saveUnitIfDirty(segment.id)} multiline />
                  <Field label={t('visualPurpose')} value={segment.visualPurpose} disabled={locked || saving} onChange={(value) => updateSegment(index, 'visualPurpose', value)} onBlur={() => saveUnitIfDirty(segment.id)} multiline />
                  <Field label={t('visualHints')} value={segment.visualHints.join('，')} disabled={locked || saving} onChange={(value) => updateVisualHints(index, value)} onBlur={() => saveUnitIfDirty(segment.id)} multiline />
                  <Field label={t('onScreenText')} value={segment.onScreenText || ''} disabled={locked || saving} onChange={(value) => updateSegment(index, 'onScreenText', value)} onBlur={() => saveUnitIfDirty(segment.id)} multiline />
                </div>
              </details>

              <ContentUnitActions
                unitId={segment.id}
                state={unitState}
                candidateTitle={candidate.title}
                candidateBody={candidate.body}
                candidateIssueCount={candidateIssueCount(unitState?.candidate?.review)}
                disabled={saving || dirtyIds.has(segment.id)}
              />
            </article>
          )
        })}
      </div>
    </section>
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
  const className = 'mt-1 w-full rounded-md border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2.5 py-2 text-sm text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)] disabled:cursor-not-allowed disabled:opacity-70'
  return (
    <label className="text-xs font-medium text-[var(--glass-text-tertiary)]">
      {label}
      {multiline ? (
        <textarea value={value} disabled={disabled} rows={2} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} className={`${className} resize-y`} />
      ) : (
        <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} className={className} />
      )}
    </label>
  )
}

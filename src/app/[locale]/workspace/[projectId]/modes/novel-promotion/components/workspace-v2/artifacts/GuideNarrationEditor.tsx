'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceStageRuntime } from '../../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../../hooks/useWorkspaceEpisodeStageData'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function GuideNarrationEditor() {
  const t = useTranslations('novelPromotion.workspaceFlow.v2.contentEditor')
  const runtime = useWorkspaceStageRuntime()
  const { contentPlan } = useWorkspaceEpisodeStageData()
  const sourcePlan = useMemo(() => asRecord(contentPlan), [contentPlan])
  const [draftPlan, setDraftPlan] = useState<JsonRecord | null>(sourcePlan)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftPlan(sourcePlan)
  }, [sourcePlan])

  const segments = Array.isArray(draftPlan?.segments)
    ? draftPlan.segments.map(asRecord).filter((segment): segment is JsonRecord => !!segment)
    : []

  const updateSegment = (index: number, field: 'title' | 'narration', value: string) => {
    if (!draftPlan) return
    const nextSegments = Array.isArray(draftPlan.segments) ? [...draftPlan.segments] : []
    const current = asRecord(nextSegments[index]) || {}
    nextSegments[index] = { ...current, [field]: value }
    setDraftPlan({ ...draftPlan, segments: nextSegments })
  }

  const save = async () => {
    if (!draftPlan || saving) return
    setSaving(true)
    try {
      await runtime.onContentPlanChange(draftPlan)
    } finally {
      setSaving(false)
    }
  }

  if (!draftPlan || segments.length === 0) {
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--glass-stroke-base)] px-1 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
          <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('description', { count: segments.length })}</p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-[var(--glass-text-tertiary)]">
          <AppIcon name={saving ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : 'text-[var(--glass-tone-success-fg)]'}`} />
          {saving ? t('saving') : t('autoSaved')}
        </span>
      </div>

      <div className="space-y-3">
        {segments.map((segment, index) => (
          <article key={readString(segment.id) || String(index)} className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-w-0 flex-1 items-center gap-3">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--glass-bg-muted)] text-xs font-semibold text-[var(--glass-text-secondary)]">
                  {index + 1}
                </span>
                <input
                  value={readString(segment.title)}
                  onChange={(event) => updateSegment(index, 'title', event.target.value)}
                  onBlur={() => { void save() }}
                  aria-label={t('segmentTitle', { index: index + 1 })}
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-[var(--glass-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-stroke-focus)]"
                />
              </label>
              <span className="shrink-0 text-xs text-[var(--glass-text-tertiary)]">
                {t('duration', { seconds: readNumber(segment.estimatedDurationSec) })}
              </span>
            </div>
            <textarea
              value={readString(segment.narration)}
              onChange={(event) => updateSegment(index, 'narration', event.target.value)}
              onBlur={() => { void save() }}
              aria-label={t('narrationLabel', { index: index + 1 })}
              rows={4}
              className="mt-3 w-full resize-y rounded-md border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm leading-6 text-[var(--glass-text-secondary)] outline-none transition-colors focus:border-[var(--glass-stroke-focus)] focus:ring-2 focus:ring-[var(--glass-focus-ring)]"
            />
          </article>
        ))}
      </div>
    </section>
  )
}

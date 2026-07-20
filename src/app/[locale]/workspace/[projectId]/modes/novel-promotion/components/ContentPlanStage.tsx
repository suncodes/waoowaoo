'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { isBookGuideProfile } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import {
  PlanningDefinitionGrid,
  PlanningEmptyState,
  PlanningSection,
  PlanningStageBody,
  PlanningStageFrame,
  PlanningStageHeader,
  PlanningTagList,
  type PlanningTone,
} from './planning/PlanningStagePrimitives'
import {
  asPlanningRecord,
  readPlanningNumber,
  readPlanningRecords,
  readPlanningString,
  readPlanningStrings,
  type PlanningRecord,
} from './planning/planning-data'

function SourceAnchor({ value }: { value: unknown }) {
  const t = useTranslations('novelPromotion.workspaceFlow.contentPlan')
  const anchor = asPlanningRecord(value)
  if (!anchor) return null
  const label = readPlanningString(anchor.label)
  const chapter = readPlanningString(anchor.chapter)
  const quote = readPlanningString(anchor.quote)
  if (!label && !chapter && !quote) return null
  return (
    <div className="mt-3 border-l-2 border-[var(--glass-stroke-focus)] pl-3 text-xs leading-5 text-[var(--glass-text-secondary)]">
      <span className="font-medium text-[var(--glass-text-primary)]">{t('source')}</span>
      <span className="ml-2">{[chapter, label].filter(Boolean).join(' · ')}</span>
      {quote ? <p className="mt-1 break-words">{quote}</p> : null}
    </div>
  )
}

function ScoreMeter({ label, value }: { label: string; value: number }) {
  const normalized = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="text-[var(--glass-text-secondary)]">{label}</span>
        <span className="font-semibold text-[var(--glass-text-primary)]">{normalized}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--glass-bg-muted)]">
        <div
          className="h-full rounded-full bg-[var(--glass-accent-from)] transition-[width] duration-300"
          style={{ width: `${normalized}%` }}
        />
      </div>
    </div>
  )
}

function NarrativeStructure({ plan }: { plan: PlanningRecord }) {
  const t = useTranslations('novelPromotion.workspaceFlow.contentPlan')
  const beats = readPlanningRecords(plan.beats)
  return (
    <div className="space-y-5">
      <PlanningDefinitionGrid items={[
        { label: t('fields.title'), value: readPlanningString(plan.title, '-') },
        { label: t('fields.logline'), value: readPlanningString(plan.logline, '-') },
      ]} />
      <PlanningTagList items={readPlanningStrings(plan.themes)} emptyLabel={t('emptyValue')} />
      <div className="space-y-3">
        {beats.map((beat, index) => (
          <article key={readPlanningString(beat.id, String(index))} className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-[var(--glass-tone-info-bg)] px-2 text-xs font-semibold text-[var(--glass-tone-info-fg)]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-semibold text-[var(--glass-text-primary)]">{readPlanningString(beat.title, t('untitled'))}</h3>
                  <span className="text-xs text-[var(--glass-text-tertiary)]">
                    {t('durationSeconds', { seconds: readPlanningNumber(beat.estimatedDurationSec) })}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-[var(--glass-text-secondary)]">{readPlanningString(beat.purpose)}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--glass-text-secondary)]">{readPlanningString(beat.summary)}</p>
                <SourceAnchor value={beat.sourceAnchor} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function GuideStructure({ plan }: { plan: PlanningRecord }) {
  const t = useTranslations('novelPromotion.workspaceFlow.contentPlan')
  const outline = readPlanningRecords(plan.outline)
  const segments = readPlanningRecords(plan.segments)
  return (
    <div className="space-y-6">
      <PlanningDefinitionGrid items={[
        { label: t('fields.title'), value: readPlanningString(plan.title, '-') },
        { label: t('fields.thesis'), value: readPlanningString(plan.thesis, '-') },
        { label: t('fields.recommendationAngle'), value: readPlanningString(plan.recommendationAngle, '-') },
      ]} />
      <PlanningSection title={t('outlineTitle')}>
        <ol className="space-y-3">
          {outline.map((item, index) => (
            <li key={readPlanningString(item.id, String(index))} className="grid gap-2 border-b border-[var(--glass-stroke-soft)] pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[36px_minmax(0,1fr)]">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--glass-bg-muted)] text-xs font-semibold text-[var(--glass-text-secondary)]">{index + 1}</span>
              <div>
                <h3 className="font-semibold text-[var(--glass-text-primary)]">{readPlanningString(item.title, t('untitled'))}</h3>
                <p className="mt-1 text-sm text-[var(--glass-text-secondary)]">{readPlanningString(item.question)}</p>
                <p className="mt-1 text-sm font-medium text-[var(--glass-tone-info-fg)]">{readPlanningString(item.takeaway)}</p>
              </div>
            </li>
          ))}
        </ol>
      </PlanningSection>
      <PlanningSection title={t('segmentsTitle')}>
        <div className="space-y-4">
          {segments.map((segment, index) => (
            <article key={readPlanningString(segment.id, String(index))} className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold text-[var(--glass-text-primary)]">{readPlanningString(segment.title, t('untitled'))}</h3>
                <span className="text-xs text-[var(--glass-text-tertiary)]">
                  {t('durationSeconds', { seconds: readPlanningNumber(segment.estimatedDurationSec) })}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--glass-text-secondary)]">{readPlanningString(segment.narration)}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('fields.visualPurpose')}</div>
                  <p className="mt-1 text-sm leading-6 text-[var(--glass-text-secondary)]">{readPlanningString(segment.visualPurpose, '-')}</p>
                </div>
                <div>
                  <div className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('fields.visualHints')}</div>
                  <div className="mt-2"><PlanningTagList items={readPlanningStrings(segment.visualHints)} emptyLabel={t('emptyValue')} /></div>
                </div>
              </div>
              <SourceAnchor value={segment.sourceAnchor} />
            </article>
          ))}
        </div>
      </PlanningSection>
    </div>
  )
}

export default function ContentPlanStage() {
  const t = useTranslations('novelPromotion.workspaceFlow.contentPlan')
  const runtime = useWorkspaceStageRuntime()
  const { creativeBrief, contentPlan, contentReview } = useWorkspaceEpisodeStageData()
  const brief = asPlanningRecord(creativeBrief)
  const plan = asPlanningRecord(contentPlan)
  const review = asPlanningRecord(contentReview)
  const isBookGuide = isBookGuideProfile(runtime.videoProfile)
  const hasPlan = !!brief && !!plan && !!review
  const reviewStatus = readPlanningString(review?.status, 'approved')
  const statusTone: PlanningTone = reviewStatus === 'blocked'
    ? 'danger'
    : reviewStatus === 'warning'
      ? 'warning'
      : 'success'
  const statusLabel = reviewStatus === 'blocked'
    ? t('status.blocked')
    : reviewStatus === 'warning'
      ? t('status.warning')
      : t('status.approved')
  if (!hasPlan) {
    return (
      <PlanningStageFrame>
        <PlanningEmptyState
          icon="brain"
          title={t('empty.title')}
          description={t('empty.description')}
          actionLabel={t('empty.action')}
          onAction={() => runtime.onStageChange('config')}
        />
      </PlanningStageFrame>
    )
  }

  return (
    <PlanningStageFrame>
      <PlanningStageHeader
        icon="brain"
        title={isBookGuide ? t('titleGuide') : t('titleNarrative')}
        subtitle={readPlanningString(plan.title)}
        statusLabel={statusLabel}
        statusTone={statusTone}
      />
      <PlanningStageBody>
        <div className="space-y-8">
          <section className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('tabs.brief')}</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--glass-text-secondary)]">{t('briefOverview')}</p>
            </div>
            <PlanningDefinitionGrid items={[
              { label: t('fields.objective'), value: readPlanningString(brief.objective, '-') },
              { label: t('fields.audience'), value: readPlanningString(brief.audience, '-') },
              { label: t('fields.audiencePromise'), value: readPlanningString(brief.audiencePromise, '-') },
              { label: t('fields.targetDuration'), value: t('durationSeconds', { seconds: readPlanningNumber(brief.targetDurationSec) }) },
            ]} />
            <div className="grid gap-5 lg:grid-cols-3">
              <PlanningSection title={t('fields.tone')}>
                <PlanningTagList items={readPlanningStrings(brief.tone)} emptyLabel={t('emptyValue')} />
              </PlanningSection>
              <PlanningSection title={t('fields.mustInclude')}>
                <PlanningTagList items={readPlanningStrings(brief.mustInclude)} emptyLabel={t('emptyValue')} />
              </PlanningSection>
              <PlanningSection title={t('fields.mustAvoid')}>
                <PlanningTagList items={readPlanningStrings(brief.mustAvoid)} emptyLabel={t('emptyValue')} />
              </PlanningSection>
            </div>
          </section>

          <section className="space-y-5 border-t border-[var(--glass-stroke-base)] pt-7">
            <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('tabs.structure')}</h2>
            {
          readPlanningString(plan.planType) === 'guide'
            ? <GuideStructure plan={plan} />
            : <NarrativeStructure plan={plan} />
            }
          </section>

          <details className="group border-t border-[var(--glass-stroke-base)] pt-7" open={reviewStatus !== 'approved'}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('tabs.review')}</h2>
                <p className="mt-1 text-sm text-[var(--glass-text-secondary)]">{statusLabel}</p>
              </div>
              <AppIcon name="chevronDown" className="h-4 w-4 text-[var(--glass-text-tertiary)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-5 space-y-6">
              <div className="grid gap-5 md:grid-cols-3">
                <ScoreMeter label={t('scores.total')} value={readPlanningNumber(review.score)} />
                <ScoreMeter label={t('scores.profileFit')} value={readPlanningNumber(review.profileFitScore)} />
                <ScoreMeter label={t('scores.sourceSupport')} value={readPlanningNumber(review.sourceSupportScore)} />
              </div>
              <PlanningSection title={t('issuesTitle')}>
                {readPlanningRecords(review.issues).length > 0 ? (
                  <div className="space-y-3">
                    {readPlanningRecords(review.issues).map((issue, index) => {
                      const blocking = readPlanningString(issue.severity) === 'blocking'
                      return (
                        <div key={`${readPlanningString(issue.code)}-${index}`} className={`rounded-lg border px-4 py-3 ${blocking ? 'border-[var(--glass-tone-danger-fg)]/30 bg-[var(--glass-tone-danger-bg)]' : 'border-[var(--glass-stroke-warning)] bg-[var(--glass-tone-warning-bg)]'}`}>
                          <div className={`text-xs font-semibold ${blocking ? 'text-[var(--glass-tone-danger-fg)]' : 'text-[var(--glass-tone-warning-fg)]'}`}>
                            {blocking ? t('status.blocked') : t('status.warning')}
                          </div>
                          <p className="mt-1 text-sm leading-6 text-[var(--glass-text-primary)]">{readPlanningString(issue.message)}</p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-[var(--glass-tone-success-fg)]">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--glass-tone-success-bg)]">
                      <AppIcon name="check" className="h-3.5 w-3.5" />
                    </span>
                    <span>{t('noIssues')}</span>
                  </div>
                )}
              </PlanningSection>
              <PlanningSection title={t('revisionTitle')}>
                <PlanningTagList items={readPlanningStrings(review.revisionInstructions)} emptyLabel={t('noRevision')} />
              </PlanningSection>
            </div>
          </details>
        </div>
      </PlanningStageBody>
    </PlanningStageFrame>
  )
}

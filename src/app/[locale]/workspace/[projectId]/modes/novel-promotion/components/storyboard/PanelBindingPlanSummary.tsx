'use client'

import { useTranslations } from 'next-intl'
import {
  readPanelAssetBindingPlanFromRules,
  type PanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'
import type { PanelAssetBindingRole, VisualAssetKind } from '@/lib/visual-production/bindings'

interface PanelBindingPlanSummaryProps {
  photographyRules?: unknown
  referencePlan?: unknown
  className?: string
}

function kindLabel(kind: VisualAssetKind, t: (key: string) => string): string {
  if (kind === 'character') return t('panel.bindingKindCharacter')
  if (kind === 'location') return t('panel.bindingKindLocation')
  return t('panel.bindingKindProp')
}

function roleLabel(role: PanelAssetBindingRole, t: (key: string) => string): string {
  if (role === 'primary_identity') return t('panel.bindingRolePrimaryIdentity')
  if (role === 'supporting_identity') return t('panel.bindingRoleSupportingIdentity')
  if (role === 'environment') return t('panel.bindingRoleEnvironment')
  if (role === 'prop_detail') return t('panel.bindingRolePropDetail')
  if (role === 'cover_motif') return t('panel.bindingRoleCoverMotif')
  if (role === 'comparison_prop') return t('panel.bindingRoleComparisonProp')
  return t('panel.bindingRoleStyleOnly')
}

function sourceLabel(source: string, t: (key: string) => string): string {
  if (source === 'shot_spec') return t('panel.bindingSourceShotSpec')
  if (source === 'legacy_panel') return t('panel.bindingSourcePanel')
  return t('panel.bindingSourceAnchor')
}

function resolvePlan(photographyRules: unknown): PanelAssetBindingPlan | null {
  return readPanelAssetBindingPlanFromRules(photographyRules)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readDroppedReferenceNames(referencePlan: unknown): string[] {
  const selection = asRecord(asRecord(referencePlan).referenceSelection)
  const dropped = Array.isArray(selection.dropped) ? selection.dropped : []
  return Array.from(new Set(dropped.flatMap((item) => {
    const name = asRecord(item).assetName
    return typeof name === 'string' && name.trim() ? [name.trim()] : []
  })))
}

export default function PanelBindingPlanSummary({
  photographyRules,
  referencePlan,
  className = '',
}: PanelBindingPlanSummaryProps) {
  const t = useTranslations('storyboard')
  const plan = resolvePlan(photographyRules)
  const droppedReferenceNames = readDroppedReferenceNames(referencePlan)
  if (!plan && droppedReferenceNames.length === 0) return null

  return (
    <div className={`rounded-md border border-white/10 bg-white/[0.03] p-3 ${className}`}>
      {plan ? <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-stone-300">
            {t('panel.visualBindingLabel', { count: plan.bindings.length })}
          </span>
          <span className="text-[11px] text-stone-500">
            {plan.primarySubject}
          </span>
        </div>

        {plan.bindings.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {plan.bindings.map((binding) => (
              <span
                key={`${binding.kind}:${binding.id}:${binding.role}`}
                className="inline-flex items-center gap-1 rounded-md bg-black/20 px-2 py-1 text-[11px] text-stone-200 ring-1 ring-white/10"
                title={`${kindLabel(binding.kind, t)} · ${roleLabel(binding.role, t)} · ${sourceLabel(binding.source, t)}`}
              >
                <span className="text-stone-500">{kindLabel(binding.kind, t)}</span>
                <span>{binding.name}</span>
                <span className="text-[#c8a85f]">{roleLabel(binding.role, t)}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-stone-500">{t('panel.visualBindingNone')}</p>
        )}

        {plan.suppressed.length > 0 ? (
          <p className="mt-2 text-[11px] leading-5 text-stone-500">
            {t('panel.visualBindingSuppressed')}: {plan.suppressed.map((item) => item.name).join('、')}
          </p>
        ) : null}
      </> : null}

      {droppedReferenceNames.length > 0 ? (
        <p className="mt-2 text-[11px] leading-5 text-cyan-200">
          {t('panel.visualReferenceTrimmed')}: {droppedReferenceNames.join('、')}
        </p>
      ) : null}
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  asWorkspaceRecord,
  cloneWorkspaceValue,
  readVisualArtifactMeta,
  type WorkspaceArtifactStatus,
} from '@/lib/creation-workspace/artifact-state'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import type { VisualPlanResult, VisualUnit } from '@/lib/visual-planning'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioSectionHeader,
} from './StudioPrimitives'
import type { StudioWorkspaceModel } from './studio-types'

type EditableVisualPlan = {
  shotPlan: VisualPlanResult['shotPlan']
  visualUnits: VisualUnit[]
}

const VISUAL_TYPE_OPTIONS: Array<{ value: VisualUnit['visualType']; label: string }> = [
  { value: 'character_action', label: '角色动作' },
  { value: 'environment', label: '环境画面' },
  { value: 'book_cover', label: '书封' },
  { value: 'quote_card', label: '引用卡片' },
  { value: 'diagram', label: '图表' },
  { value: 'illustration', label: '插画' },
  { value: 'kinetic_text', label: '动态文字' },
]

const RENDER_MODE_OPTIONS: Array<{ value: VisualUnit['renderMode']; label: string }> = [
  { value: 'generated_image', label: '完整画面' },
  { value: 'text_card', label: '文字卡背景' },
  { value: 'composite', label: '合成素材' },
]

function readEditablePlan(productionBible: unknown): EditableVisualPlan | null {
  const meta = readVisualArtifactMeta(productionBible)
  if (!meta?.plan) return null
  const rawShotPlan = asWorkspaceRecord(meta.plan.shotPlan)
  const rawShotBudget = asWorkspaceRecord(rawShotPlan?.shotBudget)
  const summary = typeof rawShotPlan?.summary === 'string' ? rawShotPlan.summary : ''
  if (!summary || meta.plan.visualUnits.length === 0) return null
  const readBudgetNumber = (key: string, fallback: number) => (
    typeof rawShotBudget?.[key] === 'number' ? rawShotBudget[key] : fallback
  )
  return {
    shotPlan: {
      schemaVersion: 1,
      summary,
      totalEstimatedDurationSec: typeof rawShotPlan?.totalEstimatedDurationSec === 'number'
        ? rawShotPlan.totalEstimatedDurationSec
        : 0,
      shotBudget: {
        totalShots: readBudgetNumber('totalShots', meta.plan.visualUnits.length),
        averageDurationSec: readBudgetNumber('averageDurationSec', 0),
        hookShots: readBudgetNumber('hookShots', 0),
        setupShots: readBudgetNumber('setupShots', 0),
        evidenceShots: readBudgetNumber('evidenceShots', 0),
        payoffShots: readBudgetNumber('payoffShots', 0),
        breathShots: readBudgetNumber('breathShots', 0),
      },
      rhythmCurve: Array.isArray(rawShotPlan?.rhythmCurve)
        ? cloneWorkspaceValue(rawShotPlan.rhythmCurve) as EditableVisualPlan['shotPlan']['rhythmCurve']
        : [],
      functionMix: Array.isArray(rawShotPlan?.functionMix)
        ? cloneWorkspaceValue(rawShotPlan.functionMix) as EditableVisualPlan['shotPlan']['functionMix']
        : [],
      continuityChecks: Array.isArray(rawShotPlan?.continuityChecks)
        ? rawShotPlan.continuityChecks.filter((item): item is string => typeof item === 'string')
        : [],
    },
    visualUnits: cloneWorkspaceValue(meta.plan.visualUnits) as VisualUnit[],
  }
}

function planStatusLabel(status: WorkspaceArtifactStatus) {
  if (status === 'approved') return '已确认'
  if (status === 'stale') return '需要更新'
  if (status === 'draft') return '草稿'
  return '待确认'
}

interface StudioShotPlanEditorProps {
  model: StudioWorkspaceModel
  workflowState: CreationWorkflowState
  onStoryboardReady: () => void
}

export default function StudioShotPlanEditor({
  model,
  workflowState,
  onStoryboardReady,
}: StudioShotPlanEditorProps) {
  const runtime = useWorkspaceStageRuntime()
  const { clips, productionBible } = useWorkspaceEpisodeStageData()
  const visualMeta = useMemo(() => readVisualArtifactMeta(productionBible), [productionBible])
  const persistedPlan = useMemo(() => readEditablePlan(productionBible), [productionBible])
  const [draft, setDraft] = useState<EditableVisualPlan | null>(persistedPlan)
  const [baseline, setBaseline] = useState(() => persistedPlan ? JSON.stringify(persistedPlan) : '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const running = workflowState.activeTarget?.kind === 'visual_plan' || runtime.isTransitioning
  const clipMap = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips])
  const dirty = !!draft && JSON.stringify(draft) !== baseline

  useEffect(() => {
    setDraft(persistedPlan)
    setBaseline(persistedPlan ? JSON.stringify(persistedPlan) : '')
    setError('')
  }, [persistedPlan, visualMeta?.revision])

  const updateShotPlan = (updates: Partial<EditableVisualPlan['shotPlan']>) => {
    setDraft((current) => current ? {
      ...current,
      shotPlan: { ...current.shotPlan, ...updates },
    } : current)
  }

  const updateUnit = (unitId: string, updates: Partial<VisualUnit>) => {
    setDraft((current) => current ? {
      ...current,
      visualUnits: current.visualUnits.map((unit) => unit.id === unitId ? { ...unit, ...updates } : unit),
    } : current)
  }

  const save = async (): Promise<boolean> => {
    if (!draft || !dirty) return true
    setSaving(true)
    setError('')
    try {
      await runtime.onSaveVisualPlan(draft.shotPlan, draft.visualUnits)
      setBaseline(JSON.stringify(draft))
      return true
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '镜头规划保存失败'
      setError(message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const rewrite = async () => {
    const instruction = window.prompt('描述希望 AI 如何重写镜头规划，例如：减少静态文字卡，增加环境镜头和自然转场。')
    if (!instruction?.trim()) return
    setError('')
    try {
      await runtime.onRunVisualPlan(instruction.trim())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 重写失败')
    }
  }

  const regenerate = async () => {
    if (running || saving || confirming) return
    if (
      dirty
      && !window.confirm('重新生成镜头规划会丢弃当前未保存修改，是否继续？')
    ) return
    setError('')
    try {
      await runtime.onRunVisualPlan(undefined, { forceRegenerate: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重新生成镜头规划失败')
    }
  }

  const confirmAndGenerate = async () => {
    if (!draft || confirming) return
    if (
      model.workflow.isBookGuide
      && model.workflow.hasStoryboard
      && !window.confirm('重新生成分镜会更新现有镜头规划，是否继续？')
    ) return
    setConfirming(true)
    setError('')
    try {
      if (dirty && !(await save())) return
      await runtime.onApproveStage('visual-design')
      if (model.workflow.isBookGuide) {
        await runtime.onMaterializeGuideStoryboard()
      } else {
        await runtime.onRunScriptToStoryboard({ visualApprovalConfirmed: true })
      }
      onStoryboardReady()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成分镜失败')
    } finally {
      setConfirming(false)
    }
  }

  if (!draft) {
    return (
      <StudioPanel>
        <StudioEmptyState
          icon="clapperboard"
          title={running ? '正在生成镜头规划初稿' : '还没有镜头规划初稿'}
          description={running
            ? '任务会在后台继续执行，完成后将在这里展示完整镜头规划。'
            : '根据已确认的导读稿或剧本和视觉资产生成初稿，生成后可以逐镜头编辑或让 AI 重写。'}
          action={(
            <StudioButton icon="sparkles" loading={running} onClick={() => { void runtime.onRunVisualPlan() }} disabled={running}>
              {running ? '生成中' : '生成镜头规划初稿'}
            </StudioButton>
          )}
        />
      </StudioPanel>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}
      {running ? (
        <div className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          <AppIcon name="loader" className="mr-2 inline h-4 w-4 animate-spin" />
          AI 正在生成镜头规划，完成前保留当前版本供查看。
        </div>
      ) : null}

      <StudioPanel>
        <StudioSectionHeader
          title="镜头规划初稿"
          description="先检查整体节奏与逐镜头内容；保存不会生成图片，确认规划后进入台词与声音，再进入分镜图片。"
          actions={(
            <div className="flex flex-wrap gap-2">
              <StudioButton size="sm" variant="secondary" icon="sparkles" loading={running} onClick={() => { void rewrite() }} disabled={running || saving || confirming}>
                AI 重写
              </StudioButton>
              <StudioButton size="sm" variant="secondary" icon="refresh" loading={running} onClick={() => { void regenerate() }} disabled={running || saving || confirming}>
                重新生成
              </StudioButton>
              <StudioButton size="sm" variant="secondary" icon="check" loading={saving} onClick={() => { void save() }} disabled={!dirty || running || confirming}>
                保存修改
              </StudioButton>
              <StudioButton size="sm" icon="arrowRight" loading={confirming} onClick={() => { void confirmAndGenerate() }} disabled={running || saving}>
                {model.workflow.hasStoryboard ? '确认并重新生成分镜文稿' : '确认规划并生成分镜文稿'}
              </StudioButton>
            </div>
          )}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <StudioMetric label="规划状态" value={dirty ? '有未保存修改' : planStatusLabel(visualMeta?.status || 'needs_review')} />
          <StudioMetric label="镜头单元" value={draft.visualUnits.length} />
          <StudioMetric label="预计时长" value={`${Math.round(draft.shotPlan.totalEstimatedDurationSec)} 秒`} />
          <StudioMetric label="连续性检查" value={draft.shotPlan.continuityChecks.length} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <label className="block text-xs font-semibold text-stone-500">
            整体规划摘要
            <textarea
              value={draft.shotPlan.summary}
              onChange={(event) => updateShotPlan({ summary: event.target.value })}
              rows={5}
              className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
            />
          </label>
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-stone-500">
              预计总时长（秒）
              <input
                type="number"
                min={1}
                value={draft.shotPlan.totalEstimatedDurationSec}
                onChange={(event) => updateShotPlan({ totalEstimatedDurationSec: Math.max(1, Number(event.target.value) || 1) })}
                className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]"
              />
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              连续性检查（每行一项）
              <textarea
                value={draft.shotPlan.continuityChecks.join('\n')}
                onChange={(event) => updateShotPlan({
                  continuityChecks: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean),
                })}
                rows={4}
                className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
              />
            </label>
          </div>
        </div>
      </StudioPanel>

      <div className="space-y-3">
        {draft.visualUnits.map((unit, index) => {
          const clip = clipMap.get(unit.clipId)
          return (
            <StudioPanel key={unit.id} padding="none" className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-stone-100">镜头 {String(index + 1).padStart(2, '0')}</div>
                  <div className="mt-1 text-xs text-stone-500">{clip?.summary || `内容单元 ${unit.clipId}`}</div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-stone-500">
                  {(unit.assetRefs || []).map((asset) => (
                    <span key={asset.id} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{asset.name}</span>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-stone-500">
                    画面类型
                    <select
                      value={unit.visualType}
                      onChange={(event) => updateUnit(unit.id, { visualType: event.target.value as VisualUnit['visualType'] })}
                      className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]"
                    >
                      {VISUAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-stone-500">
                    生成方式
                    <select
                      value={unit.renderMode}
                      onChange={(event) => updateUnit(unit.id, { renderMode: event.target.value as VisualUnit['renderMode'] })}
                      className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]"
                    >
                      {RENDER_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-stone-500">
                    景别
                    <input value={unit.shotType} onChange={(event) => updateUnit(unit.id, { shotType: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]" />
                  </label>
                  <label className="block text-xs font-semibold text-stone-500">
                    运镜
                    <input value={unit.cameraMove} onChange={(event) => updateUnit(unit.id, { cameraMove: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]" />
                  </label>
                  <label className="block text-xs font-semibold text-stone-500">
                    时长（秒）
                    <input type="number" min={1} max={60} value={unit.durationSec} onChange={(event) => updateUnit(unit.id, { durationSec: Math.max(1, Number(event.target.value) || 1) })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]" />
                  </label>
                </div>
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-stone-500">
                    画面描述
                    <textarea value={unit.description} onChange={(event) => updateUnit(unit.id, { description: event.target.value })} rows={4} className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" />
                  </label>
                  <details className="rounded-md border border-white/10 bg-white/[0.02]" open={index === 0}>
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-stone-400">生成提示词与屏幕文字</summary>
                    <div className="space-y-3 border-t border-white/10 p-3">
                      <label className="block text-xs font-semibold text-stone-500">
                        图片提示词
                        <textarea value={unit.imagePrompt} onChange={(event) => updateUnit(unit.id, { imagePrompt: event.target.value })} rows={4} className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" />
                      </label>
                      <label className="block text-xs font-semibold text-stone-500">
                        视频提示词
                        <textarea value={unit.videoPrompt} onChange={(event) => updateUnit(unit.id, { videoPrompt: event.target.value })} rows={3} className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" />
                      </label>
                      <label className="block text-xs font-semibold text-stone-500">
                        屏幕文字（可选）
                        <input value={unit.onScreenText || ''} onChange={(event) => updateUnit(unit.id, { onScreenText: event.target.value || undefined })} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]" />
                      </label>
                    </div>
                  </details>
                </div>
              </div>
            </StudioPanel>
          )
        })}
      </div>
    </div>
  )
}

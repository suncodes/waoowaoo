'use client'

import Image from 'next/image'
import { useMemo, useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { VisualAssetSummary, AssetRenderSummary, AssetVariantSummary } from '@/lib/assets/contracts'
import { readVisualArtifactMeta, type VisualAnchor } from '@/lib/creation-workspace/artifact-state'
import { resolveVisualAnchorReadiness, resolveVisualAssetStatus, selectedVisualAssetImage } from '@/lib/creation-workspace/visual-readiness'
import { useAssetActions, useAssets } from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import ContentAssetRequirements from '../workspace-v2/artifacts/ContentAssetRequirements'
import VisualAnchorBoard from '../workspace-v2/artifacts/VisualAnchorBoard'
import { statusLabel, type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioVisualKitCanvasProps {
  model: StudioWorkspaceModel
}

interface VisualKitItem {
  id: string
  name: string
  kind: VisualAnchor['semanticKind']
  importance: 'core' | 'supporting'
  description: string
  status: StudioProductStatus
  imageUrl: string | null
  sourceCount: number
  asset?: VisualAssetSummary
}

type PendingAction = {
  key: string
  label: string
} | null

function statusClass(status: StudioProductStatus) {
  if (status === 'locked') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'generating') return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'
  if (status === 'failed') return 'border-rose-400/30 bg-rose-400/10 text-rose-100'
  if (status === 'stale' || status === 'needs_review') return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  return 'border-white/10 bg-white/5 text-stone-300'
}

function toProductStatus(status: ReturnType<typeof resolveVisualAssetStatus>): StudioProductStatus {
  if (status === 'running') return 'generating'
  if (status === 'failed') return 'failed'
  if (status === 'confirmed') return 'locked'
  if (status === 'candidate') return 'needs_review'
  return 'empty'
}

function assetDescription(asset: VisualAssetSummary) {
  if (asset.kind === 'character') return asset.introduction || asset.variants[0]?.description || ''
  return asset.summary || asset.variants[0]?.description || ''
}

function semanticKind(asset: VisualAssetSummary): VisualAnchor['semanticKind'] {
  return asset.kind
}

function actionDescriptionField(asset: VisualAssetSummary) {
  return asset.kind === 'character' ? 'introduction' : 'summary'
}

function assetKindLabel(kind: VisualKitItem['kind']) {
  if (kind === 'character') return '角色'
  if (kind === 'location') return '场景'
  if (kind === 'prop') return '道具'
  if (kind === 'vehicle') return '载具'
  if (kind === 'book_cover') return '书封'
  return '图表'
}

function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const className = variant === 'primary'
    ? 'bg-[#f3e9cf] text-[#161512] hover:bg-[#fff5d9]'
    : variant === 'secondary'
      ? 'border border-white/12 bg-white/[0.04] text-stone-100 hover:bg-white/[0.08]'
      : 'text-stone-400 hover:bg-white/[0.06] hover:text-stone-100'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

function flattenRenders(asset: VisualAssetSummary | undefined) {
  if (!asset) return []
  return asset.variants.flatMap((variant) => (
    variant.renders
      .filter((render) => !!render.imageUrl)
      .map((render) => ({ variant, render }))
  ))
}

function isSelectedRender(variant: AssetVariantSummary, render: AssetRenderSummary) {
  return render.isSelected || render.index === variant.selectionState.selectedRenderIndex
}

function useVisualKitActions(projectId: string) {
  const characterActions = useAssetActions({ scope: 'project', projectId, kind: 'character' })
  const locationActions = useAssetActions({ scope: 'project', projectId, kind: 'location' })
  const propActions = useAssetActions({ scope: 'project', projectId, kind: 'prop' })
  return (asset: VisualAssetSummary) => {
    if (asset.kind === 'character') return characterActions
    if (asset.kind === 'location') return locationActions
    return propActions
  }
}

function buildGeneratePayload(asset: VisualAssetSummary, count: number) {
  const primaryVariant = asset.variants[0]
  if (asset.kind === 'character') {
    return {
      id: asset.id,
      appearanceId: primaryVariant?.id,
      appearanceIndex: primaryVariant?.index ?? 0,
      count,
    }
  }
  return { id: asset.id, count }
}

function buildSelectPayload(asset: VisualAssetSummary, variant: AssetVariantSummary, render: AssetRenderSummary) {
  if (asset.kind === 'character') {
    return {
      id: asset.id,
      appearanceId: variant.id,
      selectedIndex: render.index,
    }
  }
  return {
    id: asset.id,
    imageIndex: render.index,
  }
}

function buildItems(anchors: VisualAnchor[], assets: VisualAssetSummary[]): VisualKitItem[] {
  const readiness = resolveVisualAnchorReadiness(anchors, assets)
  if (readiness.items.length > 0) {
    return readiness.items.map((item) => ({
      id: item.anchor.id,
      name: item.anchor.name,
      kind: item.anchor.semanticKind,
      importance: item.anchor.importance,
      description: item.anchor.description,
      status: toProductStatus(item.status),
      imageUrl: item.imageUrl,
      sourceCount: item.anchor.sourceUnitIds.length,
      asset: item.asset,
    }))
  }
  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    kind: semanticKind(asset),
    importance: 'supporting',
    description: assetDescription(asset),
    status: toProductStatus(resolveVisualAssetStatus(asset)),
    imageUrl: selectedVisualAssetImage(asset),
    sourceCount: 0,
    asset,
  }))
}

export default function StudioVisualKitCanvas({ model }: StudioVisualKitCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const { projectId } = useWorkspaceProvider()
  const { productionBible } = useWorkspaceEpisodeStageData()
  const assetsQuery = useAssets({ scope: 'project', projectId })
  const actionFor = useVisualKitActions(projectId)
  const [pending, setPending] = useState<PendingAction>(null)
  const [error, setError] = useState('')
  const visualAssets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
  const visualMeta = useMemo(() => readVisualArtifactMeta(productionBible), [productionBible])
  const items = useMemo(() => buildItems(visualMeta?.anchors || [], visualAssets), [visualAssets, visualMeta?.anchors])
  const coreItems = items.filter((item) => item.importance === 'core')
  const supportingItems = items.filter((item) => item.importance === 'supporting')

  const run = async (key: string, label: string, operation: () => Promise<unknown>) => {
    setPending({ key, label })
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setPending(null)
    }
  }

  const primaryAction = async () => {
    if (!model.workflow.hasVisualPlan) {
      await runtime.onRunVisualPlan()
      return
    }
    if (model.summary.missingCoreVisualAssets > 0) {
      runtime.onOpenAssetLibrary()
      return
    }
    if (!model.workflow.visualApproved) {
      await runtime.onApproveStage('visual-design')
      return
    }
    await runtime.onRunScriptToStoryboard()
  }
  const primaryLabel = !model.workflow.hasVisualPlan
    ? '生成视觉资产清单'
    : model.summary.missingCoreVisualAssets > 0
      ? '完善核心资产'
      : model.workflow.visualApproved
        ? '生成分镜'
        : '确认视觉资产'

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-white/10 bg-[#151613] px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Visual Kit</p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-50">角色、场景、道具一致性</h1>
            <p className="mt-2 text-sm text-stone-400">在分镜前确认跨镜头复用对象。生成候选、选择定稿和编辑标准描述都在这里完成。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={runtime.onOpenAssetLibrary}>
              <AppIcon name="folderOpen" className="h-4 w-4" />
              资产库
            </Button>
            <Button onClick={() => { void run('primary', primaryLabel, primaryAction) }} disabled={!!pending || runtime.isTransitioning}>
              <AppIcon name={pending?.key === 'primary' || runtime.isTransitioning ? 'loader' : 'sparkles'} className={`h-4 w-4 ${pending?.key === 'primary' || runtime.isTransitioning ? 'animate-spin' : ''}`} />
              {primaryLabel}
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {pending ? (
        <div className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          <AppIcon name="loader" className="mr-2 inline h-4 w-4 animate-spin" />
          {pending.label}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#151613] px-6 py-12 text-center">
          <AppIcon name="folderCards" className="h-8 w-8 text-[#e8d18a]" />
          <h2 className="mt-4 text-lg font-semibold text-stone-50">还没有视觉资产清单</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">确认文稿后，先提取需要跨镜头一致的角色、场景和关键道具。</p>
        </div>
      ) : (
        <>
          <AssetSection
            title="核心资产"
            description="主角、反派、重复场景和关键道具。未确认时不进入正式图片/视频生成。"
            items={coreItems}
            actionFor={actionFor}
            onRun={run}
            pendingKey={pending?.key || ''}
          />
          <AssetSection
            title="辅助资产"
            description="普通场景、次要物件和可自动处理的视觉元素。"
            items={supportingItems}
            actionFor={actionFor}
            onRun={run}
            pendingKey={pending?.key || ''}
          />
        </>
      )}

      <details className="group rounded-lg border border-white/10 bg-[#151613] p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stone-100">
          <span>高级资产详情</span>
          <AppIcon name="chevronDown" className="h-4 w-4 text-stone-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 space-y-5 rounded-md bg-white/[0.02] p-4 text-[var(--glass-text-primary)]">
          <VisualAnchorBoard />
          <ContentAssetRequirements />
        </div>
      </details>
    </div>
  )
}

function AssetSection({
  title,
  description,
  items,
  actionFor,
  onRun,
  pendingKey,
}: {
  title: string
  description: string
  items: VisualKitItem[]
  actionFor: (asset: VisualAssetSummary) => ReturnType<typeof useAssetActions>
  onRun: (key: string, label: string, operation: () => Promise<unknown>) => Promise<void>
  pendingKey: string
}) {
  if (items.length === 0) return null
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-stone-50">{title}</h2>
        <p className="mt-1 text-sm text-stone-500">{description}</p>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {items.map((item) => (
          <VisualAssetCard
            key={item.id}
            item={item}
            actions={item.asset ? actionFor(item.asset) : null}
            onRun={onRun}
            pendingKey={pendingKey}
          />
        ))}
      </div>
    </section>
  )
}

function VisualAssetCard({
  item,
  actions,
  onRun,
  pendingKey,
}: {
  item: VisualKitItem
  actions: ReturnType<typeof useAssetActions> | null
  onRun: (key: string, label: string, operation: () => Promise<unknown>) => Promise<void>
  pendingKey: string
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(item.asset?.name || item.name)
  const [draftDescription, setDraftDescription] = useState(item.asset ? assetDescription(item.asset) : item.description)
  const renders = flattenRenders(item.asset)
  const disabled = !!pendingKey
  const primaryVariant = item.asset?.variants[0]

  const save = async () => {
    if (!item.asset || !actions) return
    await onRun(`save:${item.id}`, '保存资产描述', async () => {
      await actions.update(item.asset!.id, {
        name: draftName.trim(),
        [actionDescriptionField(item.asset!)]: draftDescription.trim(),
      })
      if (primaryVariant && draftDescription.trim()) {
        await actions.updateVariant(item.asset!.id, primaryVariant.id, { description: draftDescription.trim() })
      }
      setEditing(false)
    })
  }

  const generate = async (count: number) => {
    if (!item.asset || !actions) return
    await onRun(`generate:${item.id}`, `生成 ${item.name} 候选图`, () => actions.generate(buildGeneratePayload(item.asset!, count)))
  }

  const select = async (variant: AssetVariantSummary, render: AssetRenderSummary) => {
    if (!item.asset || !actions) return
    await onRun(`select:${item.id}:${render.index}`, '设为定稿图', () => actions.selectRender(buildSelectPayload(item.asset!, variant, render)))
  }

  return (
    <article className="rounded-lg border border-white/10 bg-[#151613] p-4">
      <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-[#0f100e]">
          {item.imageUrl ? (
            <Image src={item.imageUrl} alt={item.name} fill sizes="220px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-600">
              <AppIcon name={item.kind === 'character' ? 'user' : item.kind === 'location' ? 'imageLandscape' : 'package'} className="h-8 w-8" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold text-stone-50">{item.name}</h3>
                <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] text-stone-400">{assetKindLabel(item.kind)}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
              </div>
              <p className="mt-1 text-xs text-stone-500">{item.importance === 'core' ? '核心资产' : '辅助资产'} · 来源 {item.sourceCount}</p>
            </div>
            <Button variant="ghost" onClick={() => setEditing((value) => !value)} disabled={!item.asset || disabled}>
              <AppIcon name="edit" className="h-4 w-4" />
              编辑
            </Button>
          </div>

          {editing ? (
            <div className="mt-4 space-y-3">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                className="h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
                placeholder="资产名称"
              />
              <textarea
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                rows={3}
                className="w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
                placeholder="标准描述"
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(false)}>取消</Button>
                <Button onClick={() => { void save() }} disabled={!draftName.trim() || disabled}>
                  <AppIcon name={pendingKey === `save:${item.id}` ? 'loader' : 'check'} className={`h-4 w-4 ${pendingKey === `save:${item.id}` ? 'animate-spin' : ''}`} />
                  保存
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-300">{item.asset ? assetDescription(item.asset) : item.description || '待补充标准描述'}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => { void generate(3) }} disabled={!item.asset || disabled}>
              <AppIcon name={pendingKey === `generate:${item.id}` ? 'loader' : 'imageEdit'} className={`h-4 w-4 ${pendingKey === `generate:${item.id}` ? 'animate-spin' : ''}`} />
              生成候选
            </Button>
            <Button variant="secondary" onClick={() => { void generate(1) }} disabled={!item.asset || disabled}>单张重试</Button>
          </div>
        </div>
      </div>

      {renders.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {renders.map(({ variant, render }) => {
            const selected = isSelectedRender(variant, render)
            return (
              <button
                key={`${variant.id}:${render.index}`}
                type="button"
                onClick={() => { void select(variant, render) }}
                disabled={disabled || selected}
                className={`group relative aspect-[4/3] overflow-hidden rounded-md border text-left ${selected ? 'border-emerald-400' : 'border-white/10 hover:border-[#e8d18a]'}`}
                title={selected ? '当前定稿图' : '设为定稿图'}
              >
                <Image src={render.imageUrl || ''} alt={`${item.name} candidate ${render.index + 1}`} fill sizes="160px" className="object-cover" unoptimized />
                <span className={`absolute left-2 top-2 rounded px-2 py-1 text-[11px] font-semibold ${selected ? 'bg-emerald-500 text-white' : 'bg-black/60 text-stone-100'}`}>
                  {selected ? '定稿' : `候选 ${render.index + 1}`}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      {!item.asset ? (
        <div className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          资产记录缺失，请在高级详情或资产库中补全后再生成候选图。
        </div>
      ) : null}
    </article>
  )
}

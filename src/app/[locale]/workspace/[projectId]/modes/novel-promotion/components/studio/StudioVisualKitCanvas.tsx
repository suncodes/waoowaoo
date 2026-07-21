'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
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
import {
  StudioAdvancedPanel,
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
} from './StudioPrimitives'
import { type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const visualAssets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
  const visualMeta = useMemo(() => readVisualArtifactMeta(productionBible), [productionBible])
  const items = useMemo(() => buildItems(visualMeta?.anchors || [], visualAssets), [visualAssets, visualMeta?.anchors])
  const coreItems = items.filter((item) => item.importance === 'core')
  const supportingItems = items.filter((item) => item.importance === 'supporting')
  const selectedItem = items.find((item) => item.id === selectedId) || items[0] || null
  const confirmedCount = items.filter((item) => item.status === 'locked').length
  const generatedCount = items.filter((item) => item.imageUrl).length

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) {
      setSelectedId(selectedItem.id)
    }
  }, [selectedId, selectedItem])

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
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="视觉库"
          title="角色、场景、道具一致性"
          description="先稳定跨镜头复用对象，再让分镜和视频生产沿用同一套视觉标准。"
          actions={(
            <>
              <StudioButton size="sm" variant="secondary" icon="folderOpen" onClick={runtime.onOpenAssetLibrary}>
              资产库
              </StudioButton>
              <StudioButton
                size="sm"
                icon="sparkles"
                loading={pending?.key === 'primary' || runtime.isTransitioning}
                onClick={() => { void run('primary', primaryLabel, primaryAction) }}
                disabled={!!pending}
              >
                {primaryLabel}
              </StudioButton>
            </>
          )}
        />
        <div className="grid gap-4 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
          <StudioMetric label="全部资产" value={items.length} />
          <StudioMetric label="核心资产" value={coreItems.length} />
          <StudioMetric label="已有定稿" value={`${confirmedCount}/${items.length}`} />
          <StudioMetric label="已有图片" value={generatedCount} />
        </div>
      </StudioPanel>

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
        <StudioEmptyState
          icon="folderCards"
          title="还没有视觉资产清单"
          description="确认文稿后，先提取需要跨镜头一致的角色、场景和关键道具。"
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <StudioPanel padding="none" className="overflow-hidden">
            <div className="border-b border-white/10 px-4 py-4">
              <StudioSectionHeader
                title="资产队列"
                description="先处理核心资产，再补充辅助资产。"
              />
            </div>
            <div className="max-h-[760px] space-y-4 overflow-y-auto p-3">
              <AssetRailSection
                title="核心资产"
                items={coreItems}
                selectedId={selectedItem?.id || ''}
                onSelect={setSelectedId}
              />
              <AssetRailSection
                title="辅助资产"
                items={supportingItems}
                selectedId={selectedItem?.id || ''}
                onSelect={setSelectedId}
              />
            </div>
          </StudioPanel>
          {selectedItem ? (
            <VisualAssetInspector
              key={selectedItem.id}
              item={selectedItem}
              actions={selectedItem.asset ? actionFor(selectedItem.asset) : null}
              onRun={run}
              pendingKey={pending?.key || ''}
            />
          ) : null}
        </div>
      )}

      <StudioAdvancedPanel title="资产专家面板" description="锚点、需求清单和细粒度资产维护集中在此面板。">
        {showAdvanced ? (
          <div className="space-y-5">
            <VisualAnchorBoard />
            <ContentAssetRequirements />
          </div>
        ) : (
          <StudioButton size="sm" variant="secondary" onClick={() => setShowAdvanced(true)}>
            打开资产专家工具
          </StudioButton>
        )}
      </StudioAdvancedPanel>
    </div>
  )
}

function AssetRailSection({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string
  items: VisualKitItem[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-stone-500">{title}</h3>
        <span className="text-[11px] text-stone-600">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <AssetRailItem
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={() => onSelect(item.id)}
          />
        ))}
      </div>
    </section>
  )
}

function AssetRailItem({
  item,
  selected,
  onSelect,
}: {
  item: VisualKitItem
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full grid-cols-[68px_minmax(0,1fr)] gap-3 rounded-md border p-2 text-left transition-colors ${selected
        ? 'border-[#e8d18a]/70 bg-[#1b1a14]'
        : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
      }`}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded bg-[#0f100e]">
        {item.imageUrl ? (
          <Image src={item.imageUrl} alt={item.name} fill sizes="80px" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-stone-600">
            <AppIcon name={item.kind === 'character' ? 'user' : item.kind === 'location' ? 'imageLandscape' : 'package'} className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-stone-100">{item.name}</div>
            <div className="mt-1 text-[11px] text-stone-500">{assetKindLabel(item.kind)} · 来源 {item.sourceCount}</div>
          </div>
          <StudioStatusBadge status={item.status} />
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-500">{item.asset ? assetDescription(item.asset) : item.description || '待补充标准描述'}</p>
      </div>
    </button>
  )
}

function VisualAssetInspector({
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
    <StudioPanel padding="none" className="overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-stone-50">{item.name}</h2>
            <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] text-stone-400">{assetKindLabel(item.kind)}</span>
            <StudioStatusBadge status={item.status} />
          </div>
          <p className="mt-1 text-xs text-stone-500">{item.importance === 'core' ? '核心资产' : '辅助资产'} · 来源 {item.sourceCount}</p>
        </div>
        <StudioButton size="sm" variant="ghost" icon="edit" onClick={() => setEditing((value) => !value)} disabled={!item.asset || disabled}>
          编辑
        </StudioButton>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-[#0f100e]">
          {item.imageUrl ? (
            <Image src={item.imageUrl} alt={item.name} fill sizes="380px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-600">
              <AppIcon name={item.kind === 'character' ? 'user' : item.kind === 'location' ? 'imageLandscape' : 'package'} className="h-8 w-8" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          {editing ? (
            <div className="space-y-3">
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
                <StudioButton size="sm" variant="secondary" onClick={() => setEditing(false)}>取消</StudioButton>
                <StudioButton size="sm" icon="check" loading={pendingKey === `save:${item.id}`} onClick={() => { void save() }} disabled={!draftName.trim() || disabled}>
                  保存
                </StudioButton>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-xs font-semibold text-stone-500">标准描述</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-300">{item.asset ? assetDescription(item.asset) : item.description || '待补充标准描述'}</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <StudioButton size="sm" icon="imageEdit" loading={pendingKey === `generate:${item.id}`} onClick={() => { void generate(3) }} disabled={!item.asset || disabled}>
              生成候选
            </StudioButton>
            <StudioButton size="sm" variant="secondary" onClick={() => { void generate(1) }} disabled={!item.asset || disabled}>单张重试</StudioButton>
          </div>
        </div>
      </div>

      {renders.length > 0 ? (
        <div className="border-t border-white/10 px-5 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-stone-50">候选图</h3>
            <span className="text-xs text-stone-500">{renders.length} 张</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
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
                <Image src={render.imageUrl || ''} alt={`${item.name} 候选图 ${render.index + 1}`} fill sizes="160px" className="object-cover" unoptimized />
                <span className={`absolute left-2 top-2 rounded px-2 py-1 text-[11px] font-semibold ${selected ? 'bg-emerald-500 text-white' : 'bg-black/60 text-stone-100'}`}>
                  {selected ? '定稿' : `候选 ${render.index + 1}`}
                </span>
              </button>
            )
          })}
          </div>
        </div>
      ) : null}

      {!item.asset ? (
        <div className="mx-5 mb-5 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          资产记录缺失，请在高级详情或资产库中补全后再生成候选图。
        </div>
      ) : null}
    </StudioPanel>
  )
}

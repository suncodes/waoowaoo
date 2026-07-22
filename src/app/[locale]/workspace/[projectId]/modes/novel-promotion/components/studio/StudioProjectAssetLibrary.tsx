'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import { resolveVisualAssetStatus, selectedVisualAssetImage } from '@/lib/creation-workspace/visual-readiness'
import { useAssetActions, useAssets } from '@/lib/query/hooks'
import ProductModalShell from '@/components/product/ProductModalShell'
import StudioVisualAssetInspector, { type VisualKitItem } from './StudioVisualAssetInspector'
import { StudioButton, StudioEmptyState, StudioMetric, StudioPanel, StudioSectionHeader, StudioStatusBadge } from './StudioPrimitives'
import type { StudioProductStatus } from './studio-types'

type AssetFilter = 'all' | 'character' | 'location' | 'prop'

function toStatus(status: ReturnType<typeof resolveVisualAssetStatus>): StudioProductStatus {
  if (status === 'running') return 'generating'
  if (status === 'failed') return 'failed'
  if (status === 'confirmed') return 'locked'
  if (status === 'candidate') return 'needs_review'
  return 'empty'
}

function descriptionOf(asset: VisualAssetSummary) {
  return asset.kind === 'character' ? asset.introduction || asset.variants[0]?.description || '' : asset.summary || asset.variants[0]?.description || ''
}

function kindLabel(kind: VisualKitItem['kind']) {
  if (kind === 'character') return '角色'
  if (kind === 'location') return '场景'
  if (kind === 'prop') return '道具'
  if (kind === 'vehicle') return '载具'
  if (kind === 'book_cover') return '书封'
  return '图表'
}

function toItem(asset: VisualAssetSummary): VisualKitItem {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    importance: 'supporting',
    description: descriptionOf(asset),
    status: toStatus(resolveVisualAssetStatus(asset)),
    imageUrl: selectedVisualAssetImage(asset),
    sourceCount: 0,
    asset,
  }
}

function AssetListItem({ item, selected, onSelect }: { item: VisualKitItem; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${selected ? 'border-[#e8d18a]/60 bg-[#1b1a14]' : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-stone-100">{item.name}</div>
          <div className="mt-1 text-[11px] text-stone-500">{kindLabel(item.kind)}</div>
        </div>
        <StudioStatusBadge status={item.status} />
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-500">{item.description || '待补充标准描述'}</p>
    </button>
  )
}

function CreateAssetForm({
  kind,
  pending,
  onCancel,
  onSubmit,
}: {
  kind: 'location' | 'prop'
  pending: boolean
  onCancel: () => void
  onSubmit: (name: string, description: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const label = kind === 'location' ? '场景' : '道具'
  return (
    <ProductModalShell open onClose={onCancel} size="md" eyebrow="新建资产" title={`新建${label}`} description="先建立标准描述，再在资产详情中生成候选图。" footer={(
      <div className="flex justify-end gap-2">
        <StudioButton size="sm" variant="secondary" onClick={onCancel}>取消</StudioButton>
        <StudioButton size="sm" icon="check" loading={pending} onClick={() => onSubmit(name, description)} disabled={!name.trim() || !description.trim()}>创建资产</StudioButton>
      </div>
    )}>
      <div className="space-y-4">
        <label className="block text-sm font-medium text-stone-300">名称<input value={name} onChange={(event) => setName(event.target.value)} autoFocus className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#10110f] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]" /></label>
        <label className="block text-sm font-medium text-stone-300">标准描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#10110f] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" /></label>
      </div>
    </ProductModalShell>
  )
}

export default function StudioProjectAssetLibrary({
  projectId,
  isAnalyzingAssets,
  focusCharacterId,
  focusCharacterRequestId = 0,
  triggerGlobalAnalyze,
  onAnalyzeAssets,
  onGlobalAnalyzeComplete,
}: {
  projectId: string
  isAnalyzingAssets: boolean
  focusCharacterId?: string | null
  focusCharacterRequestId?: number
  triggerGlobalAnalyze?: boolean
  onAnalyzeAssets?: () => Promise<unknown>
  onGlobalAnalyzeComplete?: () => void
}) {
  const assetsQuery = useAssets({ scope: 'project', projectId })
  const characterActions = useAssetActions({ scope: 'project', projectId, kind: 'character' })
  const locationActions = useAssetActions({ scope: 'project', projectId, kind: 'location' })
  const propActions = useAssetActions({ scope: 'project', projectId, kind: 'prop' })
  const [filter, setFilter] = useState<AssetFilter>('all')
  const [selectedId, setSelectedId] = useState('')
  const [createKind, setCreateKind] = useState<'location' | 'prop' | null>(null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const analyzeRequestRef = useRef<number | null>(null)
  const items = useMemo(() => assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual').map(toItem), [assetsQuery.data])
  const filteredItems = useMemo(() => filter === 'all' ? items : items.filter((item) => item.kind === filter), [filter, items])
  const selectedItem = filteredItems.find((item) => item.id === selectedId) || filteredItems[0] || null

  useEffect(() => {
    if (focusCharacterId && items.some((item) => item.id === focusCharacterId)) setSelectedId(focusCharacterId)
  }, [focusCharacterId, items])
  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) setSelectedId(selectedItem.id)
  }, [selectedId, selectedItem])
  useEffect(() => {
    if (!triggerGlobalAnalyze || !onAnalyzeAssets) return
    if (analyzeRequestRef.current === focusCharacterRequestId) return
    analyzeRequestRef.current = focusCharacterRequestId
    void onAnalyzeAssets().finally(() => onGlobalAnalyzeComplete?.())
  }, [focusCharacterRequestId, onAnalyzeAssets, onGlobalAnalyzeComplete, triggerGlobalAnalyze])

  const actionsFor = (item: VisualKitItem) => item.kind === 'character' ? characterActions : item.kind === 'location' ? locationActions : propActions
  const run = async (key: string, label: string, operation: () => Promise<unknown>) => {
    setPending(key)
    setError('')
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : `${label}失败`) } finally { setPending('') }
  }
  const create = async (name: string, description: string) => {
    if (!createKind) return
    await run(`create:${createKind}`, '创建资产', async () => {
      await (createKind === 'location' ? locationActions : propActions).create({ name, summary: description, description })
      setCreateKind(null)
    })
  }
  const remove = async (item: VisualKitItem) => {
    if (!item.asset || (item.kind !== 'location' && item.kind !== 'prop')) return
    if (!window.confirm(`确认删除“${item.name}”？`)) return
    await run(`remove:${item.id}`, '删除资产', async () => {
      await actionsFor(item).remove(item.asset!.id)
      setSelectedId('')
    })
  }

  const counts = {
    all: items.length,
    character: items.filter((item) => item.kind === 'character').length,
    location: items.filter((item) => item.kind === 'location').length,
    prop: items.filter((item) => item.kind === 'prop').length,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">项目资产</p>
          <h2 className="mt-1 text-xl font-semibold text-stone-50">资产工作台</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">项目内的角色、场景和道具。生成候选后必须明确选择定稿图。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StudioButton size="sm" variant="secondary" icon="sparkles" loading={isAnalyzingAssets} onClick={() => { void onAnalyzeAssets?.() }} disabled={!onAnalyzeAssets}>重新提取资产</StudioButton>
          <StudioButton size="sm" variant="secondary" icon="imageLandscape" onClick={() => setCreateKind('location')}>新建场景</StudioButton>
          <StudioButton size="sm" variant="secondary" icon="package" onClick={() => setCreateKind('prop')}>新建道具</StudioButton>
        </div>
      </div>

      {error ? <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        {(['all', 'character', 'location', 'prop'] as const).map((kind) => (
          <button key={kind} type="button" onClick={() => setFilter(kind)} className={`rounded-md border px-3 py-3 text-left ${filter === kind ? 'border-[#e8d18a]/60 bg-[#1b1a14]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
            <div className="text-xs text-stone-500">{kind === 'all' ? '全部资产' : kindLabel(kind)}</div>
            <div className="mt-1 text-lg font-semibold text-stone-100">{counts[kind]}</div>
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? <StudioEmptyState icon="folderCards" title="暂无项目资产" description="先提取文稿中的视觉资产，或手动新建场景和道具。" /> : (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <StudioPanel padding="none" className="overflow-hidden">
            <div className="border-b border-white/10 px-4 py-4"><StudioSectionHeader title="资产清单" description="选择一个资产查看候选图和标准描述。" /></div>
            <div className="space-y-2 p-3">{filteredItems.map((item) => <AssetListItem key={item.id} item={item} selected={selectedItem?.id === item.id} onSelect={() => setSelectedId(item.id)} />)}</div>
          </StudioPanel>
          {selectedItem ? <StudioVisualAssetInspector item={selectedItem} actions={actionsFor(selectedItem)} onRun={run} pendingKey={pending} onRemove={() => { void remove(selectedItem) }} /> : null}
        </div>
      )}

      <StudioPanel padding="sm">
        <div className="grid gap-3 sm:grid-cols-3"><StudioMetric label="图片待确认" value={items.filter((item) => item.status === 'needs_review').length} /><StudioMetric label="生成中" value={items.filter((item) => item.status === 'generating').length} /><StudioMetric label="已定稿" value={items.filter((item) => item.status === 'locked').length} /></div>
      </StudioPanel>

      {createKind ? <CreateAssetForm kind={createKind} pending={pending === `create:${createKind}`} onCancel={() => setCreateKind(null)} onSubmit={(name, description) => { void create(name, description) }} /> : null}
    </div>
  )
}

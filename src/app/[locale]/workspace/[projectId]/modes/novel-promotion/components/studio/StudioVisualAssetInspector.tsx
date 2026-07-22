'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { AssetRenderSummary, AssetVariantSummary, VisualAssetSummary } from '@/lib/assets/contracts'
import { useAssetActions } from '@/lib/query/hooks'
import { StudioButton, StudioPanel, StudioStatusBadge } from './StudioPrimitives'
import type { StudioProductStatus } from './studio-types'

export interface VisualKitItem {
  id: string
  name: string
  kind: 'character' | 'location' | 'prop' | 'vehicle' | 'book_cover' | 'diagram'
  importance: 'core' | 'supporting'
  description: string
  status: StudioProductStatus
  imageUrl: string | null
  sourceCount: number
  asset?: VisualAssetSummary
}

function assetDescription(asset: VisualAssetSummary) {
  if (asset.kind === 'character') return asset.introduction || asset.variants[0]?.description || ''
  return asset.summary || asset.variants[0]?.description || ''
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
  return asset.variants.flatMap((variant) => variant.renders
    .filter((render) => !!render.imageUrl)
    .map((render) => ({ variant, render })))
}

function isSelectedRender(variant: AssetVariantSummary, render: AssetRenderSummary) {
  return render.isSelected || render.index === variant.selectionState.selectedRenderIndex
}

function renderKey(variant: AssetVariantSummary, render: AssetRenderSummary) {
  return `${variant.id}:${render.index}`
}

function buildGeneratePayload(asset: VisualAssetSummary, count: number) {
  const primaryVariant = asset.variants[0]
  if (asset.kind === 'character') {
    return { id: asset.id, appearanceId: primaryVariant?.id, appearanceIndex: primaryVariant?.index ?? 0, count }
  }
  return { id: asset.id, count }
}

function buildSelectPayload(asset: VisualAssetSummary, variant: AssetVariantSummary, render: AssetRenderSummary) {
  if (asset.kind === 'character') return { id: asset.id, appearanceId: variant.id, selectedIndex: render.index }
  return { id: asset.id, imageIndex: render.index }
}

export default function StudioVisualAssetInspector({
  item,
  actions,
  onRun,
  pendingKey,
  onRemove,
}: {
  item: VisualKitItem
  actions: ReturnType<typeof useAssetActions> | null
  onRun: (key: string, label: string, operation: () => Promise<unknown>) => Promise<void>
  pendingKey: string
  onRemove?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(item.asset?.name || item.name)
  const [draftDescription, setDraftDescription] = useState(item.asset ? assetDescription(item.asset) : item.description)
  const renders = flattenRenders(item.asset)
  const disabled = !!pendingKey
  const primaryVariant = item.asset?.variants[0]
  const confirmedRender = renders.find(({ variant, render }) => isSelectedRender(variant, render))
  const confirmedRenderKey = confirmedRender ? renderKey(confirmedRender.variant, confirmedRender.render) : ''
  const [selectedRenderKey, setSelectedRenderKey] = useState(confirmedRenderKey)
  const selectedRender = renders.find(({ variant, render }) => renderKey(variant, render) === selectedRenderKey) || confirmedRender || null

  useEffect(() => setSelectedRenderKey(confirmedRenderKey), [confirmedRenderKey])

  const save = async () => {
    if (!item.asset || !actions) return
    await onRun(`save:${item.id}`, '保存资产描述', async () => {
      await actions.update(item.asset!.id, {
        name: draftName.trim(),
        [item.asset!.kind === 'character' ? 'introduction' : 'summary']: draftDescription.trim(),
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
        <div className="flex flex-wrap gap-2">
          {onRemove && (item.kind === 'location' || item.kind === 'prop') ? <StudioButton size="sm" variant="ghost" icon="trash" onClick={onRemove} disabled={disabled}>删除</StudioButton> : null}
          <StudioButton size="sm" variant="ghost" icon="edit" onClick={() => setEditing((value) => !value)} disabled={!item.asset || disabled}>编辑</StudioButton>
        </div>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-[#0f100e]">
          {selectedRender?.render.imageUrl || item.imageUrl ? (
            <Image src={selectedRender?.render.imageUrl || item.imageUrl || ''} alt={item.name} fill sizes="380px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-600"><AppIcon name={item.kind === 'character' ? 'user' : item.kind === 'location' ? 'imageLandscape' : 'package'} className="h-8 w-8" /></div>
          )}
        </div>
        <div className="min-w-0">
          {editing ? (
            <div className="space-y-3">
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]" placeholder="资产名称" />
              <textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} rows={3} className="w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" placeholder="标准描述" />
              <div className="flex justify-end gap-2">
                <StudioButton size="sm" variant="secondary" onClick={() => setEditing(false)}>取消</StudioButton>
                <StudioButton size="sm" icon="check" loading={pendingKey === `save:${item.id}`} onClick={() => { void save() }} disabled={!draftName.trim() || disabled}>保存</StudioButton>
              </div>
            </div>
          ) : (
            <div><div className="text-xs font-semibold text-stone-500">标准描述</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-300">{item.asset ? assetDescription(item.asset) : item.description || '待补充标准描述'}</p></div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <StudioButton size="sm" icon="imageEdit" loading={pendingKey === `generate:${item.id}`} onClick={() => { void generate(3) }} disabled={!item.asset || disabled}>生成候选</StudioButton>
            <StudioButton size="sm" variant="secondary" onClick={() => { void generate(1) }} disabled={!item.asset || disabled}>单张重试</StudioButton>
          </div>
        </div>
      </div>

      {renders.length > 0 ? (
        <div className="border-t border-white/10 px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-stone-50">候选图</h3><p className="mt-1 text-xs text-stone-500">先切换比较，再确认定稿。</p></div>
            <StudioButton size="sm" icon="check" loading={selectedRender ? pendingKey === `select:${item.id}:${selectedRender.render.index}` : false} onClick={() => { if (selectedRender) void select(selectedRender.variant, selectedRender.render) }} disabled={!selectedRender || selectedRenderKey === confirmedRenderKey || disabled}>
              {selectedRenderKey === confirmedRenderKey ? '当前已定稿' : '设为定稿'}
            </StudioButton>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {renders.map(({ variant, render }) => {
              const key = renderKey(variant, render)
              const selected = key === selectedRenderKey
              return (
                <button key={key} type="button" onClick={() => setSelectedRenderKey(key)} disabled={disabled} className={`group relative aspect-[4/3] overflow-hidden rounded-md border text-left ${selected ? 'border-emerald-400' : 'border-white/10 hover:border-[#e8d18a]'}`}>
                  <Image src={render.imageUrl || ''} alt={`${item.name} 候选图 ${render.index + 1}`} fill sizes="160px" className="object-cover" unoptimized />
                  <span className={`absolute left-2 top-2 rounded px-2 py-1 text-[11px] font-semibold ${selected ? 'bg-[#f3e9cf] text-[#161512]' : 'bg-black/60 text-stone-100'}`}>{selected ? '当前选择' : `候选 ${render.index + 1}`}</span>
                  {isSelectedRender(variant, render) ? <span className="absolute bottom-2 right-2 rounded bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white">已定稿</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {!item.asset ? <div className="mx-5 mb-5 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">资产记录缺失，请在项目资产库中补全后再生成候选图。</div> : null}
    </StudioPanel>
  )
}

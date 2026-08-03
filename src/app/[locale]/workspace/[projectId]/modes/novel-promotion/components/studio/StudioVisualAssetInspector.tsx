'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type {
  AssetCandidateGroupSummary,
  AssetRenderSummary,
  AssetVariantSummary,
  VisualAssetSummary,
} from '@/lib/assets/contracts'
import { useAssetActions } from '@/lib/query/hooks'
import { StudioButton, StudioPanel, StudioStatusBadge } from './StudioPrimitives'
import GenerationPromptSnapshotModal from './GenerationPromptSnapshotModal'
import { useGenerationPromptSnapshot } from './useGenerationPromptSnapshot'
import {
  fetchLatestPreparedGenerationPrompts,
  type PreparedGenerationPromptLookup,
} from '@/lib/query/prepared-generation-prompts'
import type { StudioProductStatus } from './studio-types'
import { resolveVisualAssetWorkflowPresentation } from './studio-visual-asset-status'
import {
  buildVisualAssetSelectPayload,
  visualAssetSelectionIndex,
} from './studio-visual-asset-selection'
import { buildVisualAssetGeneratePayload } from './studio-visual-asset-generation'

export interface VisualKitItem {
  id: string
  name: string
  kind: 'character' | 'location' | 'prop' | 'vehicle' | 'book_cover' | 'diagram'
  importance: 'core' | 'supporting'
  description: string
  status: StudioProductStatus
  statusLabel: string
  imageUrl: string | null
  sourceCount: number
  asset?: VisualAssetSummary
}

type RenderEntry = {
  variant: AssetVariantSummary
  render: AssetRenderSummary
}

type CandidateCard = RenderEntry & {
  key: string
  displayName: string
  sourceCandidateUrl: string | null
  action: AssetCandidateGroupSummary['action']
  sourceLabel: string
}

type CandidateDisplayGroup = {
  key: string
  label: string
  cards: CandidateCard[]
}

export type PreparedAssetPrompt = {
  artifactId: string
  refId: string
  targetId: string
  preparedAt: string
}

export function buildPreparedPromptLookups(
  asset: VisualAssetSummary,
  maxCount = 3,
): PreparedGenerationPromptLookup[] {
  if (asset.kind === 'character') {
    const appearanceId = asset.variants[0]?.id
    if (!appearanceId) return []
    return Array.from({ length: maxCount }, (_value, index) => ({
      kind: 'asset_image' as const,
      targetId: appearanceId,
      refId: `${appearanceId}:${index}`,
    }))
  }
  return asset.variants
    .slice()
    .sort((left, right) => left.index - right.index)
    .slice(0, maxCount)
    .map((variant) => ({
      kind: 'asset_image' as const,
      targetId: variant.id,
      refId: variant.id,
    }))
}

export async function loadPreparedAssetPrompts(
  projectId: string,
  asset: VisualAssetSummary,
  maxCount = 3,
): Promise<PreparedAssetPrompt[]> {
  const prepared = await fetchLatestPreparedGenerationPrompts(
    projectId,
    buildPreparedPromptLookups(asset, maxCount),
  )
  return prepared.map((item) => ({
    artifactId: item.artifactId,
    refId: item.refId,
    targetId: item.targetId,
    preparedAt: item.preparedAt,
  }))
}

export function buildPreparedPromptArtifactIds(
  asset: VisualAssetSummary,
  prompts: PreparedAssetPrompt[],
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const prompt of prompts) {
    if (asset.kind === 'character') {
      const index = prompt.refId.split(':').at(-1)
      if (index !== undefined) result[index] = prompt.artifactId
      continue
    }
    result[prompt.targetId] = prompt.artifactId
  }
  return result
}

export function preparedAssetImageCount(
  asset: VisualAssetSummary,
  prompts: PreparedAssetPrompt[],
): number {
  if (asset.kind === 'character') {
    const preparedIndexes = new Set(prompts.map((prompt) => Number(prompt.refId.split(':').at(-1))))
    let count = 0
    while (preparedIndexes.has(count)) count += 1
    return count
  }
  const preparedTargetIds = new Set(prompts.map((prompt) => prompt.targetId))
  const variants = asset.variants.slice().sort((left, right) => left.index - right.index)
  let count = 0
  for (const variant of variants) {
    if (!preparedTargetIds.has(variant.id)) break
    count += 1
  }
  return count
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

function flattenRenders(asset: VisualAssetSummary | undefined): RenderEntry[] {
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

function compareCandidateGroups(a: AssetCandidateGroupSummary, b: AssetCandidateGroupSummary) {
  if (a.origin !== b.origin) return a.origin === 'initial' ? -1 : 1
  if (a.origin === 'repair' && b.origin === 'repair' && a.attempt !== b.attempt) {
    return a.attempt - b.attempt
  }
  return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
}

function groupSectionKey(group: AssetCandidateGroupSummary) {
  return group.origin === 'initial' ? 'initial' : `repair:${Math.max(1, group.attempt)}`
}

function groupSectionLabel(group: AssetCandidateGroupSummary) {
  return group.origin === 'initial' ? '原始候选' : `第 ${Math.max(1, group.attempt)} 轮修复`
}

function candidateDisplayName(group: AssetCandidateGroupSummary, indexInGroup: number) {
  if (group.origin === 'initial') return `原始 #${indexInGroup}`
  return `修复${Math.max(1, group.attempt)}-#${indexInGroup}`
}

function buildFallbackInitialGroup(assetId: string, renders: RenderEntry[]): AssetCandidateGroupSummary {
  return {
    id: `${assetId}:initial`,
    origin: 'initial',
    attempt: 0,
    action: null,
    candidateUrls: renders.map(({ render }) => render.imageUrl).filter((url): url is string => !!url),
    sourceCandidateUrl: null,
    createdAt: '',
  }
}

function buildCandidateDisplayGroups(
  asset: VisualAssetSummary | undefined,
  renders: RenderEntry[],
): CandidateDisplayGroup[] {
  if (!asset || renders.length === 0) return []

  const renderEntriesByUrl = new Map<string, RenderEntry[]>()
  for (const entry of renders) {
    const imageUrl = entry.render.imageUrl
    if (!imageUrl) continue
    const entries = renderEntriesByUrl.get(imageUrl)
    if (entries) {
      entries.push(entry)
    } else {
      renderEntriesByUrl.set(imageUrl, [entry])
    }
  }

  const groups = (asset.candidateGroups?.length
    ? asset.candidateGroups
    : [buildFallbackInitialGroup(asset.id, renders)])
    .slice()
    .sort(compareCandidateGroups)
  const displayGroups = new Map<string, CandidateDisplayGroup>()
  const usedRenderKeys = new Set<string>()
  const cards: CandidateCard[] = []

  const ensureGroup = (group: AssetCandidateGroupSummary) => {
    const key = groupSectionKey(group)
    const existing = displayGroups.get(key)
    if (existing) return existing
    const created = {
      key,
      label: groupSectionLabel(group),
      cards: [],
    }
    displayGroups.set(key, created)
    return created
  }

  const addCard = (group: AssetCandidateGroupSummary, entry: RenderEntry) => {
    const key = renderKey(entry.variant, entry.render)
    if (usedRenderKeys.has(key)) return
    const displayGroup = ensureGroup(group)
    const card: CandidateCard = {
      ...entry,
      key,
      displayName: candidateDisplayName(group, displayGroup.cards.length + 1),
      sourceCandidateUrl: group.sourceCandidateUrl,
      action: group.action,
      sourceLabel: '',
    }
    displayGroup.cards.push(card)
    cards.push(card)
    usedRenderKeys.add(key)
  }

  for (const group of groups) {
    for (const imageUrl of group.candidateUrls) {
      const entry = renderEntriesByUrl.get(imageUrl)?.find((item) =>
        !usedRenderKeys.has(renderKey(item.variant, item.render)),
      )
      if (entry) addCard(group, entry)
    }
  }

  const fallbackGroup = buildFallbackInitialGroup(asset.id, [])
  for (const entry of renders) {
    if (!usedRenderKeys.has(renderKey(entry.variant, entry.render))) {
      addCard(fallbackGroup, entry)
    }
  }

  const displayNameByUrl = new Map<string, string>()
  for (const card of cards) {
    if (card.render.imageUrl) displayNameByUrl.set(card.render.imageUrl, card.displayName)
  }
  for (const card of cards) {
    if (!card.sourceCandidateUrl) {
      card.sourceLabel = card.action === 'regenerate' ? '重新生成 · 无单一来源' : ''
      continue
    }
    const sourceName = displayNameByUrl.get(card.sourceCandidateUrl) || '历史候选'
    card.sourceLabel = card.action === 'regenerate'
      ? `重新生成 · 参考：${sourceName}`
      : `来源：${sourceName}`
  }

  return Array.from(displayGroups.values()).filter((group) => group.cards.length > 0)
}

export default function StudioVisualAssetInspector({
  projectId,
  item,
  actions,
  onRun,
  pendingKey,
  onRemove,
  onPreparedPrompts,
}: {
  projectId: string
  item: VisualKitItem
  actions: ReturnType<typeof useAssetActions> | null
  onRun: (key: string, label: string, operation: () => Promise<unknown>) => Promise<void>
  pendingKey: string
  onRemove?: () => void
  onPreparedPrompts?: (assetId: string, prompts: PreparedAssetPrompt[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(item.asset?.name || item.name)
  const [draftDescription, setDraftDescription] = useState(item.asset ? assetDescription(item.asset) : item.description)
  const renders = useMemo(() => flattenRenders(item.asset), [item.asset])
  const candidateGroups = useMemo(
    () => buildCandidateDisplayGroups(item.asset, renders),
    [item.asset, renders],
  )
  const workflowPresentation = resolveVisualAssetWorkflowPresentation(item.asset, {
    isSubmitting: pendingKey === `generate:${item.id}`,
  })
  const workflowNotice = workflowPresentation.progress !== null
    ? `${workflowPresentation.label} · ${workflowPresentation.progress}%`
    : workflowPresentation.label
  const assetTaskError = item.asset?.variants.flatMap((variant) => [
    variant.taskState.lastError,
    ...variant.renders.map((render) => render.taskState.lastError),
  ]).find(Boolean) || item.asset?.taskState.lastError || null
  const disabled = !!pendingKey || workflowPresentation.blocksConfirmation
  const primaryVariant = item.asset?.variants[0]
  const confirmedRender = renders.find(({ variant, render }) => isSelectedRender(variant, render))
  const confirmedRenderKey = confirmedRender ? renderKey(confirmedRender.variant, confirmedRender.render) : ''
  const [selectedRenderKey, setSelectedRenderKey] = useState(confirmedRenderKey)
  const [actualPromptOpen, setActualPromptOpen] = useState(false)
  const [preparedPrompts, setPreparedPrompts] = useState<PreparedAssetPrompt[]>([])
  const [selectedPreparedPromptArtifactId, setSelectedPreparedPromptArtifactId] = useState<string | null>(null)
  const [preparedPromptOpen, setPreparedPromptOpen] = useState(false)
  const preparedImageCount = item.asset
    ? preparedAssetImageCount(item.asset, preparedPrompts)
    : 0
  const selectedRender = renders.find(({ variant, render }) => renderKey(variant, render) === selectedRenderKey) || confirmedRender || null
  const selectedCandidate = candidateGroups.flatMap((group) => group.cards).find((card) => card.key === selectedRenderKey) || null
  const actualPromptSnapshot = useGenerationPromptSnapshot({
    isOpen: actualPromptOpen,
    projectId,
    artifactId: selectedRender?.render.promptSnapshot?.artifactId || null,
    source: 'asset',
  })
  const preparedPromptSnapshot = useGenerationPromptSnapshot({
    isOpen: preparedPromptOpen,
    projectId,
    artifactId: selectedPreparedPromptArtifactId || preparedPrompts[0]?.artifactId || null,
    source: 'asset',
  })

  useEffect(() => setSelectedRenderKey(confirmedRenderKey), [confirmedRenderKey])

  useEffect(() => {
    let cancelled = false
    setPreparedPrompts([])
    setSelectedPreparedPromptArtifactId(null)
    if (!item.asset) return () => { cancelled = true }
    void loadPreparedAssetPrompts(projectId, item.asset)
      .then((prompts) => {
        if (cancelled) return
        setPreparedPrompts(prompts)
        setSelectedPreparedPromptArtifactId(prompts[0]?.artifactId || null)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [item.asset, projectId])

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
      setPreparedPrompts([])
      setSelectedPreparedPromptArtifactId(null)
      onPreparedPrompts?.(item.asset!.id, [])
      setEditing(false)
    })
  }

  const preparePrompt = async (count: number) => {
    if (!item.asset || !actions) return
    await onRun(`prepare:${item.id}`, `固定 ${item.name} 的生成提示词`, async () => {
      const result = await actions.prepareGenerationPrompt(buildVisualAssetGeneratePayload(item.asset!, count))
      setPreparedPrompts(result.preparedPrompts)
      setSelectedPreparedPromptArtifactId(result.preparedPrompts[0]?.artifactId || null)
      onPreparedPrompts?.(item.asset!.id, result.preparedPrompts)
      setPreparedPromptOpen(true)
    })
  }

  const generate = async () => {
    if (!item.asset || !actions) return
    const count = preparedAssetImageCount(item.asset, preparedPrompts)
    if (count === 0) {
      window.alert('请先固定提示词，再提交图片生成。')
      return
    }
    await onRun(`generate:${item.id}`, `按已固定提示词生成 ${item.name} 候选图`, () => actions.generate({
      ...buildVisualAssetGeneratePayload(item.asset!, count),
      preparedPromptArtifactIds: buildPreparedPromptArtifactIds(item.asset!, preparedPrompts),
    }))
  }

  const select = async (variant: AssetVariantSummary, render: AssetRenderSummary) => {
    if (!item.asset || !actions) return
    const selectedIndex = visualAssetSelectionIndex(item.asset, variant, render)
    await onRun(
      `select:${item.id}:${selectedIndex}`,
      '设为定稿图',
      () => actions.selectRender(buildVisualAssetSelectPayload(item.asset!, variant, render)),
    )
  }

  return (
    <StudioPanel padding="none" className="overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-stone-50">{item.name}</h2>
            <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] text-stone-400">{assetKindLabel(item.kind)}</span>
            <StudioStatusBadge status={workflowPresentation.status} label={workflowPresentation.label || item.statusLabel} />
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
          {workflowPresentation.blocksConfirmation ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-cyan-100">
              <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />
              {workflowNotice}
            </div>
          ) : null}
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
            <StudioButton size="sm" variant="secondary" icon="info" loading={pendingKey === `prepare:${item.id}`} onClick={() => { void preparePrompt(3) }} disabled={!item.asset || disabled}>固定 3 张提示词</StudioButton>
            <StudioButton size="sm" icon="imageEdit" loading={pendingKey === `generate:${item.id}`} onClick={() => { void generate() }} disabled={!item.asset || disabled || preparedImageCount === 0}>按已固定提示词生成（{preparedImageCount}）</StudioButton>
            <StudioButton size="sm" variant="secondary" onClick={() => { void preparePrompt(1) }} disabled={!item.asset || disabled}>重新固定单张提示词</StudioButton>
            {preparedPrompts.length > 0 ? <StudioButton size="sm" variant="ghost" icon="info" onClick={() => setPreparedPromptOpen(true)}>查看已固定提示词（{preparedPrompts.length}）</StudioButton> : null}
          </div>
        </div>
      </div>

      {renders.length > 0 ? (
        <div className="border-t border-white/10 px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-50">候选图</h3>
              <p className="mt-1 text-xs text-stone-500">
                {workflowPresentation.blocksConfirmation ? '流程完成前可预览比较，暂不能设为定稿。' : '先切换比较，再确认定稿。'}
                {selectedCandidate ? ` 当前选择：${selectedCandidate.displayName}` : ''}
              </p>
            </div>
            <StudioButton size="sm" icon="check" loading={selectedRender && item.asset ? pendingKey === `select:${item.id}:${visualAssetSelectionIndex(item.asset, selectedRender.variant, selectedRender.render)}` : false} onClick={() => { if (selectedRender) void select(selectedRender.variant, selectedRender.render) }} disabled={!selectedRender || selectedRenderKey === confirmedRenderKey || disabled}>
              {selectedRenderKey === confirmedRenderKey ? '当前已定稿' : '设为定稿'}
            </StudioButton>
            <StudioButton
              size="sm"
              variant="secondary"
              icon="info"
              onClick={() => setActualPromptOpen(true)}
              disabled={!selectedRender?.render.promptSnapshot}
            >
              查看实际提示词
            </StudioButton>
          </div>
          {workflowPresentation.blocksConfirmation ? (
            <div className="mb-3 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
              <AppIcon name="loader" className="mr-2 inline h-3.5 w-3.5 animate-spin" />
              {workflowNotice}。完成后可从所有候选中任选定稿。
            </div>
          ) : null}
          {assetTaskError ? (
            <div className="mb-3 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
              {assetTaskError.message}
            </div>
          ) : null}
          <div className="space-y-4">
            {candidateGroups.map((group) => (
              <section key={group.key}>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-stone-400">{group.label}</h4>
                  <span className="text-[11px] text-stone-600">{group.cards.length}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {group.cards.map((card) => {
                    const selected = card.key === selectedRenderKey
                    const confirmed = isSelectedRender(card.variant, card.render)
                    return (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => setSelectedRenderKey(card.key)}
                        disabled={!!pendingKey}
                        className={`group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-md border text-left transition-colors disabled:cursor-not-allowed ${selected ? 'border-emerald-400' : 'border-white/10 hover:border-[#e8d18a]'}`}
                      >
                        <Image src={card.render.imageUrl || ''} alt={`${item.name} ${card.displayName}`} fill sizes="160px" className="object-cover" unoptimized />
                        <span className={`absolute left-2 top-2 rounded px-2 py-1 text-[11px] font-semibold ${selected ? 'bg-[#f3e9cf] text-[#161512]' : 'bg-black/60 text-stone-100'}`}>{card.displayName}</span>
                        <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-end gap-1">
                          {card.sourceLabel ? (
                            <span className="max-w-full truncate rounded bg-black/65 px-2 py-1 text-[10px] font-medium text-cyan-100">
                              {card.sourceLabel}
                            </span>
                          ) : null}
                          {confirmed ? <span className="ml-auto rounded bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white">已定稿</span> : null}
                          {selected && !confirmed ? <span className="ml-auto rounded bg-[#f3e9cf] px-2 py-1 text-[10px] font-semibold text-[#161512]">当前选择</span> : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {!item.asset ? <div className="mx-5 mb-5 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">资产记录缺失，请在项目资产库中补全后再生成候选图。</div> : null}
      {actualPromptOpen ? (
        <GenerationPromptSnapshotModal
          title="资产图实际生成提示词"
          contextLabel={`${item.name}${selectedCandidate ? ` · ${selectedCandidate.displayName}` : ''}`}
          snapshot={actualPromptSnapshot.snapshot}
          loading={actualPromptSnapshot.loading}
          errorMessage={actualPromptSnapshot.errorMessage}
          onClose={() => setActualPromptOpen(false)}
        />
      ) : null}
      {preparedPromptOpen ? (
        <GenerationPromptSnapshotModal
          title="资产图已固定提示词"
          contextLabel={`${item.name} · 固定后按此版本生成，可重新固定创建新版本`}
          snapshot={preparedPromptSnapshot.snapshot}
          loading={preparedPromptSnapshot.loading}
          errorMessage={preparedPromptSnapshot.errorMessage}
          promptVersions={preparedPrompts.map((prompt, index) => ({
            artifactId: prompt.artifactId,
            label: `候选 ${index + 1}`,
          }))}
          selectedArtifactId={selectedPreparedPromptArtifactId}
          onSelectArtifact={setSelectedPreparedPromptArtifactId}
          onClose={() => setPreparedPromptOpen(false)}
        />
      ) : null}
    </StudioPanel>
  )
}

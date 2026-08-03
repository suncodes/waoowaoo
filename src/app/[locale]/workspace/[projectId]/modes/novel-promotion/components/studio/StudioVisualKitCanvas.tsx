'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { VisualAssetSummary } from '@/lib/assets/contracts'
import { readContentArtifactMeta, readVisualArtifactMeta, type VisualAnchor } from '@/lib/creation-workspace/artifact-state'
import { resolveVisualAnchorReadiness, selectedVisualAssetImage } from '@/lib/creation-workspace/visual-readiness'
import { useAssetActions, useAssets } from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
} from './StudioPrimitives'
import { type StudioWorkspaceModel } from './studio-types'
import { resolveVisualAssetWorkflowPresentation } from './studio-visual-asset-status'
import { buildVisualAssetGeneratePayload } from './studio-visual-asset-generation'
import StudioVisualAssetInspector, {
  buildPreparedPromptArtifactIds,
  loadPreparedAssetPrompts,
  preparedAssetImageCount,
  type PreparedAssetPrompt,
  type VisualKitItem,
} from './StudioVisualAssetInspector'

interface StudioVisualKitCanvasProps {
  model: StudioWorkspaceModel
}

type PendingAction = {
  key: string
  label: string
} | null

function assetDescription(asset: VisualAssetSummary) {
  if (asset.kind === 'character') return asset.introduction || asset.variants[0]?.description || ''
  return asset.summary || asset.variants[0]?.description || ''
}

function semanticKind(asset: VisualAssetSummary): VisualAnchor['semanticKind'] {
  return asset.kind
}
function assetKindLabel(kind: VisualKitItem['kind']) {
  if (kind === 'character') return '角色'
  if (kind === 'location') return '场景'
  if (kind === 'prop') return '道具'
  if (kind === 'vehicle') return '载具'
  if (kind === 'book_cover') return '书封'
  return '图表'
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

function buildItems(
  anchors: VisualAnchor[],
  assets: VisualAssetSummary[],
  requiredAssetIds: ReadonlySet<string>,
): VisualKitItem[] {
  const readiness = resolveVisualAnchorReadiness(anchors, assets)
  if (readiness.items.length > 0) {
    return readiness.items.map((item) => {
      const presentation = resolveVisualAssetWorkflowPresentation(item.asset)
      return {
        id: item.anchor.id,
        name: item.anchor.name,
        kind: item.anchor.semanticKind,
        importance: item.anchor.importance,
        description: item.anchor.description,
        status: presentation.status,
        statusLabel: presentation.label,
        imageUrl: item.imageUrl,
        sourceCount: item.anchor.sourceUnitIds.length,
        asset: item.asset,
      }
    })
  }
  const scopedAssets = requiredAssetIds.size > 0
    ? assets.filter((asset) => requiredAssetIds.has(asset.id))
    : assets
  return scopedAssets.map((asset) => {
    const presentation = resolveVisualAssetWorkflowPresentation(asset)
    return {
      id: asset.id,
      name: asset.name,
      kind: semanticKind(asset),
      importance: requiredAssetIds.has(asset.id) ? 'core' : 'supporting',
      description: assetDescription(asset),
      status: presentation.status,
      statusLabel: presentation.label,
      imageUrl: selectedVisualAssetImage(asset),
      sourceCount: 0,
      asset,
    }
  })
}

export default function StudioVisualKitCanvas({ model }: StudioVisualKitCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const { projectId } = useWorkspaceProvider()
  const { contentPlan, productionBible } = useWorkspaceEpisodeStageData()
  const assetsQuery = useAssets({ scope: 'project', projectId })
  const actionFor = useVisualKitActions(projectId)
  const [pending, setPending] = useState<PendingAction>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [preparedPromptsByAsset, setPreparedPromptsByAsset] = useState<Record<string, PreparedAssetPrompt[]>>({})
  const visualAssets = assetsQuery.data.filter((asset): asset is VisualAssetSummary => asset.family === 'visual')
  const contentMeta = useMemo(() => readContentArtifactMeta(contentPlan), [contentPlan])
  const visualMeta = useMemo(() => readVisualArtifactMeta(productionBible), [productionBible])
  const requiredAssetIds = useMemo(
    () => new Set(contentMeta?.assetRequirements.assetIds || []),
    [contentMeta?.assetRequirements.assetIds],
  )
  const items = useMemo(
    () => buildItems(visualMeta?.anchors || [], visualAssets, requiredAssetIds),
    [requiredAssetIds, visualAssets, visualMeta?.anchors],
  )
  const coreItems = items.filter((item) => item.importance === 'core')
  const supportingItems = items.filter((item) => item.importance === 'supporting')
  const selectedItem = items.find((item) => item.id === selectedId) || items[0] || null
  const confirmedCount = items.filter((item) => item.status === 'locked').length
  const generatedCount = items.filter((item) => item.imageUrl).length
  const availableAssetIds = useMemo(() => new Set(visualAssets.map((asset) => asset.id)), [visualAssets])
  const missingRequirementCount = [...requiredAssetIds].filter((assetId) => !availableAssetIds.has(assetId)).length
  const unresolvedCount = items.filter((item) => item.status !== 'locked').length + missingRequirementCount
  const batchGenerationTargets = useMemo(() => items.filter((item) => {
    if (!item.asset || !item.asset.capabilities.canGenerate) return false
    const hasAnyRender = item.asset.variants.some((variant) => variant.renders.some((render) => !!render.imageUrl))
    return !hasAnyRender && !resolveVisualAssetWorkflowPresentation(item.asset).blocksConfirmation
  }), [items])

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
    if (model.workflow.assetRequirementStatus === 'not_started' || model.workflow.assetRequirementStatus === 'stale') {
      await runtime.onAnalyzeAssets()
      return
    }
    if (model.workflow.assetRequirementStatus === 'needs_review') {
      await runtime.onApproveAssetRequirements()
      return
    }
    if (unresolvedCount > 0) {
      runtime.onOpenAssetLibrary()
      return
    }
    runtime.onStageChange('storyboard')
  }
  const primaryLabel = model.workflow.assetRequirementStatus === 'not_started'
    ? '提取视觉资产'
    : model.workflow.assetRequirementStatus === 'stale'
      ? '重新提取视觉资产'
      : model.workflow.assetRequirementStatus === 'needs_review'
        ? '确认资产清单'
          : unresolvedCount > 0
          ? `完善 ${unresolvedCount} 项视觉资产`
          : '进入镜头规划'
  const batchPrepare = async () => {
    if (batchGenerationTargets.length === 0 || pending) return
    const confirmed = window.confirm(
      `将为 ${batchGenerationTargets.length} 个待出图资产固定 3 张候选图提示词。固定后可先查看，再单独提交生成。是否继续？`,
    )
    if (!confirmed) return
    await run('batch-prepare', `批量固定 ${batchGenerationTargets.length} 个资产的候选图提示词`, async () => {
      const failedNames: string[] = []
      const nextPreparedPrompts: Record<string, PreparedAssetPrompt[]> = {}
      for (const target of batchGenerationTargets) {
        if (!target.asset) continue
        try {
          const payload = buildVisualAssetGeneratePayload(target.asset, 3)
          const preparation = await actionFor(target.asset).prepareGenerationPrompt(payload)
          nextPreparedPrompts[target.asset.id] = preparation.preparedPrompts
        } catch {
          failedNames.push(target.name)
        }
      }
      setPreparedPromptsByAsset((current) => ({ ...current, ...nextPreparedPrompts }))
      if (failedNames.length > 0) {
        throw new Error(`以下资产提示词固定失败：${failedNames.join('、')}`)
      }
    })
  }

  const batchGenerate = async () => {
    if (batchGenerationTargets.length === 0 || pending) return
    const confirmed = window.confirm(
      `将为已固定提示词的待出图资产分别创建候选图任务。未固定提示词的资产会被跳过，已有候选和已定稿资产不会被覆盖，是否继续？`,
    )
    if (!confirmed) return
    await run('batch-generate', `按已固定提示词提交 ${batchGenerationTargets.length} 个资产的候选图`, async () => {
      const failedNames: string[] = []
      for (const target of batchGenerationTargets) {
        if (!target.asset) continue
        try {
          const persistedPrompts = await loadPreparedAssetPrompts(projectId, target.asset)
          const preparedPrompts = persistedPrompts.length > 0
            ? persistedPrompts
            : preparedPromptsByAsset[target.asset.id] || []
          const count = preparedAssetImageCount(target.asset, preparedPrompts)
          if (count === 0) {
            failedNames.push(`${target.name}（未固定提示词）`)
            continue
          }
          await actionFor(target.asset).generate({
            ...buildVisualAssetGeneratePayload(target.asset, count),
            preparedPromptArtifactIds: buildPreparedPromptArtifactIds(target.asset, preparedPrompts),
          })
        } catch {
          failedNames.push(target.name)
        }
      }
      if (failedNames.length > 0) {
        throw new Error(`以下资产未提交：${failedNames.join('、')}`)
      }
    })
  }

  return (
    <div className="space-y-5">
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="视觉库"
          title="角色、场景、道具一致性"
          description="本阶段只处理角色、场景和道具的视觉定稿。全部资产就绪后，进入分镜制作中的镜头规划。"
          actions={(
            <>
              <StudioButton size="sm" variant="secondary" icon="folderOpen" onClick={runtime.onOpenAssetLibrary}>
              项目资产
              </StudioButton>
              <StudioButton
                size="sm"
                variant="secondary"
                icon="info"
                loading={pending?.key === 'batch-prepare'}
                onClick={() => { void batchPrepare() }}
                disabled={!!pending || batchGenerationTargets.length === 0}
              >
                批量固定提示词（{batchGenerationTargets.length}）
              </StudioButton>
              <StudioButton
                size="sm"
                variant="secondary"
                icon="imageEdit"
                loading={pending?.key === 'batch-generate'}
                onClick={() => { void batchGenerate() }}
                disabled={!!pending || batchGenerationTargets.length === 0}
              >
                按已固定提示词批量生成（{batchGenerationTargets.length}）
              </StudioButton>
              <StudioButton
                size="sm"
                icon="sparkles"
                loading={pending?.key === 'primary' || runtime.isTransitioning || runtime.isAssetAnalysisRunning}
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
          description="确认正式成稿后，先提取需要跨镜头一致的角色、场景和关键道具。"
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
            <div className="space-y-4 p-3">
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
            <StudioVisualAssetInspector
              key={selectedItem.id}
              projectId={projectId}
              item={selectedItem}
              actions={selectedItem.asset ? actionFor(selectedItem.asset) : null}
              onRun={run}
              pendingKey={pending?.key || ''}
              onPreparedPrompts={(assetId, prompts) => {
                setPreparedPromptsByAsset((current) => ({ ...current, [assetId]: prompts }))
              }}
            />
          ) : null}
        </div>
      )}

      <VisualConsistencyAudit items={items} onOpenAssets={runtime.onOpenAssetLibrary} />
    </div>
  )
}

function VisualConsistencyAudit({ items, onOpenAssets }: { items: VisualKitItem[]; onOpenAssets: () => void }) {
  const unresolved = items.filter((item) => item.status !== 'locked')
  const uncovered = items.filter((item) => item.sourceCount === 0)
  return (
    <StudioPanel>
      <StudioSectionHeader
        title="一致性审计"
        description="汇总跨镜头资产的定稿状态和成稿来源覆盖，不再重复展示第二套资产编辑器。"
        actions={<StudioButton size="sm" variant="secondary" icon="folderOpen" onClick={onOpenAssets}>打开项目资产库</StudioButton>}
      />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StudioMetric label="待处理资产" value={unresolved.length} helper="未定稿或生成失败" />
        <StudioMetric label="无来源锚点" value={uncovered.length} helper="未关联成稿段落" />
        <StudioMetric label="可复用资产" value={items.filter((item) => item.status === 'locked' && item.sourceCount > 1).length} helper="覆盖多个内容单元" />
      </div>
      {unresolved.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {unresolved.slice(0, 9).map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="truncate text-sm text-stone-300">{item.name}</span>
              <StudioStatusBadge status={item.status} label={item.statusLabel} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-3 text-sm text-emerald-100">
          <AppIcon name="check" className="h-4 w-4" />
          全部视觉资产已定稿，可进入分镜。
        </div>
      )}
    </StudioPanel>
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
          <StudioStatusBadge status={item.status} label={item.statusLabel} />
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-500">{item.asset ? assetDescription(item.asset) : item.description || '待补充标准描述'}</p>
      </div>
    </button>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import VisualQualityBadge from '@/components/visual-quality/VisualQualityBadge'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { parseVisualQualityState } from '@/lib/quality-workflow'
import { usePanelGenerationPromptPreview } from '@/lib/query/hooks'
import type { PanelGenerationPromptPreview } from '@/lib/query/mutations/storyboard-panel-mutations'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import { CharacterPickerModal, LocationPickerModal, PropPickerModal, type PanelEditData } from '../PanelEditForm'
import AIDataModal from '../storyboard/AIDataModal'
import ImageEditModal from '../storyboard/ImageEditModal'
import PanelBindingPlanSummary from '../storyboard/PanelBindingPlanSummary'
import { resolveConfirmedCandidateIndex } from '../storyboard/hooks/panel-candidate-runtime'
import { useStoryboardModalRuntime } from '../storyboard/hooks/useStoryboardModalRuntime'
import { useStoryboardStageController } from '../storyboard/hooks/useStoryboardStageController'
import { StudioButton, StudioEmptyState, StudioMetric, StudioSectionHeader, StudioStageHeader } from './StudioPrimitives'
import type { StudioWorkspaceModel } from './studio-types'
import {
  buildPanelCandidateDisplayGroups,
  resolvePanelImageWorkflowPresentation,
} from './studio-board-image-workflow'
import StudioBoardEmpty from './StudioBoardEmpty'
import StudioBoardShotCard from './StudioBoardShotCard'
import PanelGenerationPromptPreviewModal from './PanelGenerationPromptPreviewModal'
import GenerationPromptSnapshotModal from './GenerationPromptSnapshotModal'
import StudioShotPlanEditor from './StudioShotPlanEditor'
import { useGenerationPromptSnapshot } from './useGenerationPromptSnapshot'
import { fetchLatestPreparedGenerationPrompts } from '@/lib/query/prepared-generation-prompts'
import { currentImageUrl, flattenBoardItems, isPanelReadyForProduction, type BoardItem } from './studio-board-model'

interface StudioBoardCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
  workflowState: CreationWorkflowState
}

function BoardDetailPanel({
  projectId,
  item,
  controller,
  confirmLabel,
  onCandidateConfirmed,
}: {
  projectId: string
  item: BoardItem
  controller: ReturnType<typeof useStoryboardStageController>
  confirmLabel?: string
  onCandidateConfirmed?: () => void
}) {
  const panelData = controller.getPanelEditData(item.panel)
  const promptPreviewMutation = usePanelGenerationPromptPreview(projectId)
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)
  const [promptPreview, setPromptPreview] = useState<PanelGenerationPromptPreview | null>(null)
  const [promptPreviewError, setPromptPreviewError] = useState<string | null>(null)
  const [preparedPromptArtifactId, setPreparedPromptArtifactId] = useState<string | null>(null)
  const [preparedPromptOpen, setPreparedPromptOpen] = useState(false)
  const [actualPromptOpen, setActualPromptOpen] = useState(false)
  const saveState = controller.saveStateByPanel[item.panel.id]
  const candidates = controller.getPanelCandidates(item.sourcePanel)
  const qualityState = parseVisualQualityState(item.sourcePanel.visualQualityState)
  const hasConfirmedCandidate = !!qualityState?.humanConfirmedAt
  const selectedImageUrl = currentImageUrl(item, candidates)
  const localSubmitting = controller.submittingPanelImageIds.has(item.panel.id)
  const isSubmitting = localSubmitting || !!item.sourcePanel.imageTaskRunning
  const isModifying = controller.modifyingPanels.has(item.panel.id)
  const workflowPresentation = resolvePanelImageWorkflowPresentation({
    panel: item.sourcePanel,
    hasCandidates: !!candidates,
    isSubmitting: localSubmitting,
    isModifying,
  })
  const workflowNotice = workflowPresentation.progress !== null
    ? `${workflowPresentation.label} · ${workflowPresentation.progress}%`
    : workflowPresentation.label
  const disabled = workflowPresentation.blocksConfirmation
  const referenceBlocked = !selectedImageUrl
    && (item.sourcePanel.generationRoute === 'asset_backfill' || item.sourcePanel.generationRoute === 'human_required')
    && !isSubmitting
    && !localSubmitting
  const selectedCandidateUrl = candidates?.candidates[candidates.selectedIndex] || null
  const candidateDisplayGroups = candidates
    ? buildPanelCandidateDisplayGroups({
      candidates: candidates.candidates,
      groups: candidates.groups,
    })
    : []
  const selectedCandidateCard = candidateDisplayGroups
    .flatMap((group) => group.cards)
    .find((card) => card.index === candidates?.selectedIndex)
    || null
  const actualPromptSnapshot = useGenerationPromptSnapshot({
    isOpen: actualPromptOpen,
    projectId,
    artifactId: selectedCandidateCard?.promptSnapshot?.artifactId || null,
    source: 'panel',
    panelId: item.panel.id,
  })
  const preparedPromptSnapshot = useGenerationPromptSnapshot({
    isOpen: preparedPromptOpen,
    projectId,
    artifactId: preparedPromptArtifactId,
    source: 'panel',
    panelId: item.panel.id,
  })
  useEffect(() => {
    let cancelled = false
    setPreparedPromptArtifactId(null)
    void fetchLatestPreparedGenerationPrompts(projectId, [{
      kind: 'panel_image',
      targetId: item.panel.id,
    }])
      .then((prepared) => {
        if (!cancelled) setPreparedPromptArtifactId(prepared[0]?.artifactId || null)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [item.panel.id, projectId])
  const confirmedCandidateIndex = candidates
    ? resolveConfirmedCandidateIndex(item.sourcePanel, candidates.candidates)
    : -1
  const selectedIsCurrent = !!selectedCandidateUrl && (
    hasConfirmedCandidate
      ? confirmedCandidateIndex >= 0
        ? candidates?.selectedIndex === confirmedCandidateIndex
        : selectedCandidateUrl === item.panel.imageUrl
      : !qualityState && selectedCandidateUrl === item.panel.imageUrl
  )
  const update = (updates: Partial<PanelEditData>) => {
    setPreparedPromptArtifactId(null)
    controller.handlePanelUpdate(item.panel.id, item.panel, updates)
  }
  const saveCurrentPanel = async (): Promise<boolean> => {
    try {
      await controller.savePanelWithData(item.storyboard.id, panelData)
      return true
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '保存镜头数据失败')
      return false
    }
  }
  const regenerateCurrentPanelImage = async (forceNoReference: boolean) => {
    if (!await saveCurrentPanel()) return
    if (!preparedPromptArtifactId) {
      window.alert('请先固定提示词，再提交分镜图片生成。')
      return
    }
    await controller.regeneratePanelImage(
      item.panel.id,
      2,
      false,
      {
        ...(forceNoReference ? { forceNoReference: true } : {}),
        preparedPromptArtifactId,
      },
    )
  }
  const openImagePromptPreview = async () => {
    setPromptPreviewOpen(true)
    setPromptPreview(null)
    setPromptPreviewError(null)
    try {
      const result = await promptPreviewMutation.mutateAsync({
        panelId: item.panel.id,
        storyboardId: item.storyboard.id,
        panelIndex: item.panel.panelIndex,
        mode: 'image',
        forceNoReference: referenceBlocked,
        overrides: {
          panel: {
            shotType: panelData.shotType,
            cameraMove: panelData.cameraMove,
            description: panelData.description,
            imagePrompt: panelData.imagePrompt ?? null,
            videoPrompt: panelData.videoPrompt,
            location: panelData.location,
            characters: panelData.characters,
            props: panelData.props,
            duration: panelData.duration,
            photographyRules: panelData.photographyRules,
            actingNotes: panelData.actingNotes,
          },
        },
      })
      setPromptPreview(result.preview)
      setPreparedPromptArtifactId(result.prepared.artifactId)
    } catch (error) {
      setPromptPreviewError(error instanceof Error ? error.message : '获取最终提示词失败')
    }
  }

  return (
    <>
    <aside className="rounded-lg border border-white/10 bg-[#151613]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
        <div>
          <p className="text-xs font-semibold text-[#c8a85f]">镜头详情</p>
          <h2 className="mt-1 text-base font-semibold text-stone-50">镜头 {String(item.globalNumber).padStart(2, '0')}</h2>
        </div>
        <span className="text-xs text-stone-500">
          {saveState?.status === 'saving' ? '保存中' : saveState?.status === 'error' ? '保存失败' : '自动保存'}
        </span>
      </header>

      <div className="space-y-4 p-4">
        <div className="relative aspect-video overflow-hidden rounded-md bg-[#0b0c0a]">
          {selectedImageUrl ? (
            <MediaImageWithLoading
              src={selectedImageUrl}
              alt={`镜头 ${item.globalNumber}`}
              containerClassName="h-full w-full"
              className="h-full w-full object-cover"
              sizes="420px"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-600">
              <AppIcon name="image" className="h-8 w-8" />
            </div>
          )}
          {workflowPresentation.blocksConfirmation ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-cyan-100">
              <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />
              {workflowNotice}
            </div>
          ) : null}
          <VisualQualityBadge state={item.sourcePanel.visualQualityState} className="absolute bottom-2 left-2 z-20" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StudioButton size="sm" icon="sparkles" loading={isSubmitting} onClick={() => { void regenerateCurrentPanelImage(false) }} disabled={disabled || !preparedPromptArtifactId}>
            按已固定提示词生成
          </StudioButton>
          {referenceBlocked ? (
            <StudioButton
              size="sm"
              variant="secondary"
              icon="sparkles"
              onClick={() => { void regenerateCurrentPanelImage(true) }}
              disabled={!preparedPromptArtifactId}
            >
              按已固定提示词无参考生成
            </StudioButton>
          ) : null}
          <StudioButton
            size="sm"
            variant="secondary"
            icon="imageEdit"
            onClick={() => controller.setEditingPanel({ storyboardId: item.storyboard.id, panelIndex: item.panelOffset })}
            disabled={disabled || !item.panel.imageUrl}
          >
            改图
          </StudioButton>
          <StudioButton
            size="sm"
            variant="secondary"
            icon="clapperboard"
            onClick={() => controller.setAIDataPanel({ storyboardId: item.storyboard.id, panelIndex: item.panelOffset })}
          >
            生成参数
          </StudioButton>
          <StudioButton
            size="sm"
            variant="secondary"
            icon="info"
            loading={promptPreviewMutation.isPending}
            onClick={() => { void openImagePromptPreview() }}
          >
            固定并查看提示词
          </StudioButton>
          <StudioButton
            size="sm"
            variant="secondary"
            icon="info"
            onClick={() => setPreparedPromptOpen(true)}
            disabled={!preparedPromptArtifactId}
          >
            查看已固定提示词
          </StudioButton>
          <StudioButton
            size="sm"
            variant="secondary"
            icon="info"
            onClick={() => setActualPromptOpen(true)}
            disabled={!selectedCandidateCard?.promptSnapshot}
          >
            查看实际提示词
          </StudioButton>
          <StudioButton
            size="sm"
            variant="secondary"
            icon="image"
            onClick={() => selectedImageUrl && controller.setPreviewImage(selectedImageUrl)}
            disabled={!selectedImageUrl}
          >
            预览
          </StudioButton>
        </div>

        {workflowPresentation.blocksConfirmation ? (
          <div className="rounded-md border border-cyan-400/25 bg-cyan-400/10 p-3 text-sm text-cyan-100">
            <div className="flex items-center gap-2 font-semibold">
              <AppIcon name="loader" className="h-4 w-4 animate-spin" />
              {workflowNotice}
            </div>
            <p className="mt-1 text-xs leading-5 text-cyan-100/70">检查与修复流程完成前不能确认；已有候选图可继续预览和比较。</p>
          </div>
        ) : null}

        {candidates ? (
          <div className="rounded-md border border-amber-400/25 bg-amber-400/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-amber-100">{hasConfirmedCandidate ? '候选图（可随时切换）' : '候选图待确认'}</span>
              <div className="flex gap-2">
                <StudioButton
                  size="sm"
                  icon="check"
                  onClick={() => {
                    const imageUrl = candidates.candidates[candidates.selectedIndex]
                    if (imageUrl && !imageUrl.startsWith('PENDING:')) {
                      void controller.selectPanelCandidate(item.panel.id, imageUrl)
                        .then(() => onCandidateConfirmed?.())
                        .catch(() => undefined)
                    }
                  }}
                  disabled={disabled || selectedIsCurrent}
                >
                  {selectedIsCurrent ? '当前定稿' : confirmLabel || (hasConfirmedCandidate ? '确认切换' : '设为定稿')}
                </StudioButton>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-amber-100/70">
              {selectedCandidateCard ? `当前选择：${selectedCandidateCard.displayName}` : '可在所有候选中切换比较。'}
            </p>
            <div className="mt-3 space-y-3">
              {candidateDisplayGroups.map((group) => (
                <div key={group.key} className="rounded-md border border-white/10 bg-black/10 p-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-amber-50">{group.label}（{group.cards.length}）</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {group.cards.map((card) => {
                      const pending = card.candidateUrl.startsWith('PENDING:')
                      const selected = card.index === candidates.selectedIndex
                      const confirmed = hasConfirmedCandidate
                        ? card.candidateUrl === item.panel.imageUrl
                        : !qualityState && card.candidateUrl === item.panel.imageUrl
                      return (
                        <button
                          key={`${card.candidateUrl}:${card.index}`}
                          type="button"
                          onClick={() => {
                            if (!pending) controller.selectPanelCandidateIndex(item.panel.id, card.index)
                          }}
                          disabled={pending}
                          className={`relative aspect-video cursor-pointer overflow-hidden rounded-md border transition-colors disabled:cursor-not-allowed ${selected ? 'border-[#e8d18a]' : 'border-white/10 hover:border-white/30'}`}
                        >
                          {pending ? (
                            <div className="flex h-full items-center justify-center bg-black/30 text-[11px] text-stone-400">
                              <AppIcon name="loader" className="mr-1 h-3 w-3 animate-spin" />
                              等待
                            </div>
                          ) : (
                            <MediaImageWithLoading
                              src={card.candidateUrl}
                              alt={`${group.label} ${card.displayName}`}
                              containerClassName="h-full w-full"
                              className="h-full w-full object-cover"
                              sizes="140px"
                            />
                          )}
                          {!pending ? (
                            <span className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-[#f3e9cf] text-[#161512]' : 'bg-black/65 text-stone-100'}`}>{card.displayName}</span>
                          ) : null}
                          {!pending && (card.sourceLabel || confirmed) ? (
                            <div className="absolute inset-x-1 bottom-1 flex flex-wrap items-end gap-1">
                              {card.sourceLabel ? (
                                <span className="max-w-full truncate rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-cyan-100">{card.sourceLabel}</span>
                              ) : null}
                              {confirmed ? (
                                <span className="ml-auto rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">当前定稿</span>
                              ) : null}
                            </div>
                          ) : null}
                          {!pending && selected ? (
                            <span className="absolute right-1 top-1 rounded bg-[#f3e9cf] px-1.5 py-0.5 text-[10px] font-semibold text-[#161512]">当前选择</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-stone-500">
              镜头类型
              <input
                value={panelData.shotType || ''}
                onChange={(event) => update({ shotType: event.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]"
              />
            </label>
            <label className="text-xs font-semibold text-stone-500">
              运镜
              <input
                value={panelData.cameraMove || ''}
                onChange={(event) => update({ cameraMove: event.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]"
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-stone-500">
            画面描述
            <textarea
              value={panelData.description || ''}
              onChange={(event) => update({ description: event.target.value })}
              rows={4}
              className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
            />
          </label>
          <label className="block text-xs font-semibold text-stone-500">
            视频提示词
            <textarea
              value={panelData.videoPrompt || ''}
              onChange={(event) => update({ videoPrompt: event.target.value })}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {panelData.location ? (
              <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-stone-300">{panelData.location}</span>
            ) : (
              <span className="text-xs text-stone-500">未绑定场景</span>
            )}
            <StudioButton size="sm" variant="ghost" icon="imageLandscape" onClick={() => controller.setAssetPickerPanel({ panelId: item.panel.id, type: 'location' })}>
              选择场景
            </StudioButton>
            {panelData.location ? (
              <StudioButton size="sm" variant="ghost" onClick={() => controller.handleRemoveLocation(item.panel, item.storyboard.id)}>移除</StudioButton>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {panelData.characters.length > 0 ? (
              panelData.characters.map((character, index) => (
                <span key={`${character.name}:${character.appearance}:${index}`} className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-xs text-stone-300">
                  {character.name}
                  <button type="button" onClick={() => controller.handleRemoveCharacter(item.panel, index, item.storyboard.id)} className="text-stone-500 hover:text-stone-100">
                    <AppIcon name="closeSm" className="h-3 w-3" />
                  </button>
                </span>
              ))
            ) : (
              <span className="text-xs text-stone-500">未绑定角色</span>
            )}
            <StudioButton size="sm" variant="ghost" icon="user" onClick={() => controller.setAssetPickerPanel({ panelId: item.panel.id, type: 'character' })}>
              添加角色
            </StudioButton>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {panelData.props.length > 0 ? (
              panelData.props.map((prop, index) => (
                <span key={`${prop}:${index}`} className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-xs text-stone-300">
                  {prop}
                  <button type="button" onClick={() => controller.handleRemoveProp(item.panel, index, item.storyboard.id)} className="text-stone-500 hover:text-stone-100">
                    <AppIcon name="closeSm" className="h-3 w-3" />
                  </button>
                </span>
              ))
            ) : (
              <span className="text-xs text-stone-500">未绑定道具</span>
            )}
            <StudioButton size="sm" variant="ghost" icon="package" onClick={() => controller.setAssetPickerPanel({ panelId: item.panel.id, type: 'prop' })}>
              添加道具
            </StudioButton>
          </div>
          <PanelBindingPlanSummary photographyRules={panelData.photographyRules} />
          {saveState?.status === 'error' ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
              <span>{saveState.errorMessage || '保存失败'}</span>
              <StudioButton size="sm" variant="secondary" onClick={() => controller.retrySave(item.panel.id)}>重试</StudioButton>
            </div>
          ) : null}
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-stone-300">镜头结构</h3>
              <p className="mt-1 text-[11px] leading-5 text-stone-500">新增、插入和删除直接作用于当前分镜序列。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StudioButton size="sm" variant="secondary" icon="plus" onClick={() => { void controller.addPanel(item.storyboard.id) }}>
                末尾新增
              </StudioButton>
              <StudioButton
                size="sm"
                variant="secondary"
                icon="sparkles"
                loading={controller.insertingAfterPanelId === item.panel.id}
                onClick={() => {
                  const instruction = window.prompt('描述要插入的新镜头内容、动作或转场。')
                  if (instruction?.trim()) void controller.insertPanel(item.storyboard.id, item.panel.id, instruction.trim())
                }}
              >
                AI 插入镜头
              </StudioButton>
              <StudioButton
                size="sm"
                variant="ghost"
                icon="trash"
                loading={controller.deletingPanelIds.has(item.panel.id)}
                onClick={() => { void controller.deletePanel(item.panel.id, item.storyboard.id, controller.setLocalStoryboards) }}
              >
                删除镜头
              </StudioButton>
            </div>
          </div>
        </div>
      </div>

    </aside>
    {promptPreviewOpen ? (
      <PanelGenerationPromptPreviewModal
        preview={promptPreview}
        loading={promptPreviewMutation.isPending}
        errorMessage={promptPreviewError}
        onClose={() => setPromptPreviewOpen(false)}
      />
    ) : null}
    {actualPromptOpen ? (
      <GenerationPromptSnapshotModal
        title="分镜图片实际生成提示词"
        contextLabel={`镜头 ${String(item.globalNumber).padStart(2, '0')}${selectedCandidateCard ? ` · ${selectedCandidateCard.displayName}` : ''}`}
        snapshot={actualPromptSnapshot.snapshot}
        loading={actualPromptSnapshot.loading}
        errorMessage={actualPromptSnapshot.errorMessage}
        onClose={() => setActualPromptOpen(false)}
      />
    ) : null}
    {preparedPromptOpen ? (
      <GenerationPromptSnapshotModal
        title="分镜图片已固定提示词"
        contextLabel={`镜头 ${item.globalNumber} · 生成将严格使用该固定版本`}
        snapshot={preparedPromptSnapshot.snapshot}
        loading={preparedPromptSnapshot.loading}
        errorMessage={preparedPromptSnapshot.errorMessage}
        onClose={() => setPreparedPromptOpen(false)}
      />
    ) : null}
    </>
  )
}

function StudioBoardRuntime({
  model,
  onNavigate,
  workflowState,
  projectId,
  episodeId,
}: StudioBoardCanvasProps & { projectId: string; episodeId: string }) {
  const runtime = useWorkspaceStageRuntime()
  const { clips, storyboards } = useWorkspaceEpisodeStageData()
  const [selectedPanelId, setSelectedPanelId] = useState('')
  const activeStep: 'plan' | 'images' = model.activeMode === 'storyboard-images' ? 'images' : 'plan'
  const [reviewMode, setReviewMode] = useState(false)
  const [isBatchPreparingPrompts, setIsBatchPreparingPrompts] = useState(false)
  const [isBatchGeneratingImages, setIsBatchGeneratingImages] = useState(false)
  const [preparedPromptArtifactIds, setPreparedPromptArtifactIds] = useState<Record<string, string>>({})
  const batchPromptPreparationMutation = usePanelGenerationPromptPreview(projectId)
  const controller = useStoryboardStageController({
    projectId,
    episodeId,
    initialStoryboards: storyboards,
    clips,
    isTransitioning: runtime.isTransitioning,
  })
  const videoRatio = runtime.videoRatio || '9:16'
  const items = useMemo(
    () => flattenBoardItems(controller.sortedStoryboards, controller.getTextPanels),
    [controller.getTextPanels, controller.sortedStoryboards],
  )
  const itemReadyForProduction = (item: BoardItem) => {
    const candidates = controller.getPanelCandidates(item.sourcePanel)
    return isPanelReadyForProduction({
      panel: item.panel,
      sourcePanel: item.sourcePanel,
      hasCandidates: !!candidates,
      submitting: controller.submittingPanelImageIds.has(item.panel.id),
      modifying: controller.modifyingPanels.has(item.panel.id),
    })
  }
  const reviewItems = items.filter((item) => !itemReadyForProduction(item))
  const visibleItems = reviewMode ? reviewItems : items
  const selectedItem = visibleItems.find((item) => item.panel.id === selectedPanelId) || visibleItems[0] || null
  const blockedProductionCount = items.filter((item) => {
    const candidates = controller.getPanelCandidates(item.sourcePanel)
    return !isPanelReadyForProduction({
      panel: item.panel, sourcePanel: item.sourcePanel, hasCandidates: !!candidates,
      submitting: controller.submittingPanelImageIds.has(item.panel.id),
      modifying: controller.modifyingPanels.has(item.panel.id),
    })
  }).length
  const productionReady = items.length > 0 && blockedProductionCount === 0 && controller.runningCount === 0
  const missingImageItems = items.filter((item) => {
    const candidates = controller.getPanelCandidates(item.sourcePanel)
    return !currentImageUrl(item, candidates)
      && !item.sourcePanel.imageTaskRunning
      && !controller.submittingPanelImageIds.has(item.panel.id)
      && !controller.modifyingPanels.has(item.panel.id)
  })
  const productionBlockLabel = productionReady ? '确认并进入制作' : `${blockedProductionCount} 个镜头待确认`

  const modalRuntime = useStoryboardModalRuntime({
    projectId,
    videoRatio,
    localStoryboards: controller.localStoryboards,
    editingPanel: controller.editingPanel,
    setEditingPanel: controller.setEditingPanel,
    assetPickerPanel: controller.assetPickerPanel,
    setAssetPickerPanel: controller.setAssetPickerPanel,
    aiDataPanel: controller.aiDataPanel,
    setAIDataPanel: controller.setAIDataPanel,
    previewImage: controller.previewImage,
    setPreviewImage: controller.setPreviewImage,
    getTextPanels: controller.getTextPanels,
    getPanelEditData: controller.getPanelEditData,
    updatePanelEdit: controller.updatePanelEdit,
    savePanelWithData: controller.savePanelWithData,
    getDefaultAssetsForClip: controller.getDefaultAssetsForClip,
    handleEditSubmit: controller.handleEditSubmit,
    handleAddCharacter: controller.handleAddCharacter,
    handleSetLocation: controller.handleSetLocation,
    handleAddProp: controller.handleAddProp,
    updatePhotographyPlanMutation: controller.updatePhotographyPlanMutation,
    updatePanelActingNotesMutation: controller.updatePanelActingNotesMutation,
  })

  useEffect(() => {
    if (selectedItem && selectedItem.panel.id !== selectedPanelId) {
      setSelectedPanelId(selectedItem.panel.id)
    }
  }, [selectedItem, selectedPanelId])

  const advanceReview = () => {
    if (!selectedItem) return
    const currentIndex = reviewItems.findIndex((item) => item.panel.id === selectedItem.panel.id)
    const nextItem = reviewItems[currentIndex + 1]
      || reviewItems.find((item) => item.panel.id !== selectedItem.panel.id)
    if (nextItem) setSelectedPanelId(nextItem.panel.id)
  }

  const prepareMissingImagePrompts = async () => {
    if (missingImageItems.length === 0 || isBatchPreparingPrompts || isBatchGeneratingImages) return
    if (!window.confirm(`将为 ${missingImageItems.length} 个待生成镜头固定图片提示词。固定后可逐镜头查看，再按固定版本批量生成。是否继续？`)) {
      return
    }

    setIsBatchPreparingPrompts(true)
    try {
      const artifactIds: Record<string, string> = {}
      const failedNumbers: number[] = []
      for (const item of missingImageItems) {
        try {
          const result = await batchPromptPreparationMutation.mutateAsync({
            panelId: item.panel.id,
            storyboardId: item.storyboard.id,
            panelIndex: item.panel.panelIndex,
            mode: 'image',
          })
          artifactIds[item.panel.id] = result.prepared.artifactId
        } catch {
          failedNumbers.push(item.globalNumber)
        }
      }
      setPreparedPromptArtifactIds((current) => ({ ...current, ...artifactIds }))
      if (failedNumbers.length > 0) {
        window.alert(`以下镜头提示词固定失败：${failedNumbers.map((number) => `镜头 ${number}`).join('、')}`)
      }
    } finally {
      setIsBatchPreparingPrompts(false)
    }
  }

  const generateMissingImages = async () => {
    if (missingImageItems.length === 0 || isBatchPreparingPrompts || isBatchGeneratingImages) return
    setIsBatchGeneratingImages(true)
    try {
      const persistedPrompts = await fetchLatestPreparedGenerationPrompts(
        projectId,
        missingImageItems.map((item) => ({
          kind: 'panel_image' as const,
          targetId: item.panel.id,
        })),
      )
      const artifactIds = {
        ...preparedPromptArtifactIds,
        ...Object.fromEntries(persistedPrompts.map((prompt) => [prompt.targetId, prompt.artifactId])),
      }
      const targets = missingImageItems.flatMap((item) => {
        const preparedPromptArtifactId = artifactIds[item.panel.id]
        return preparedPromptArtifactId ? [{ item, preparedPromptArtifactId }] : []
      })
      const missingNumbers = missingImageItems
        .filter((item) => !artifactIds[item.panel.id])
        .map((item) => item.globalNumber)
      if (targets.length === 0) {
        window.alert('请先批量固定提示词，再提交分镜图片生成。')
        return
      }
      if (!window.confirm(`将按已固定提示词为 ${targets.length} 个镜头生成候选图。${missingNumbers.length > 0 ? `另有 ${missingNumbers.length} 个镜头未固定提示词并会跳过。` : ''}是否继续？`)) {
        return
      }
      await Promise.all(targets.map(({ item, preparedPromptArtifactId }) => controller.regeneratePanelImage(
        item.panel.id,
        2,
        false,
        { preparedPromptArtifactId },
      )))
      if (missingNumbers.length > 0) {
        window.alert(`以下镜头尚未固定提示词，未提交生成：${missingNumbers.map((number) => `镜头 ${number}`).join('、')}`)
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '批量提交分镜图片生成失败')
    } finally {
      setIsBatchGeneratingImages(false)
    }
  }

  return (
    <div className="space-y-4">
      {model.workflow.storyboardGenerating ? (
        <div className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          <AppIcon name="loader" className="mr-2 inline h-4 w-4 animate-spin" />
          镜头规划任务正在后台运行，当前内容会随任务结果继续更新。
        </div>
      ) : null}
      <section className="rounded-lg border border-white/10 bg-[#151613]">
        <StudioStageHeader
          eyebrow={activeStep === 'plan' ? '分镜文稿' : '分镜图片'}
          title={activeStep === 'plan' ? '镜头规划与资产绑定' : '关键帧候选与定稿'}
          description={activeStep === 'plan'
            ? '先查看、编辑并确认镜头文稿。这里不会生成图片，确认后进入台词与声音或分镜图片。'
            : '生成和确认分镜图片；口播版台词可在“台词与声音”中单独生成。'}
          actions={activeStep === 'images' ? (
            <>
              <StudioButton
                size="sm"
                variant="secondary"
                icon="info"
                loading={isBatchPreparingPrompts}
                onClick={() => { void prepareMissingImagePrompts() }}
                disabled={missingImageItems.length === 0 || isBatchGeneratingImages}
              >
                批量固定图片提示词（{missingImageItems.length}）
              </StudioButton>
              <StudioButton
                size="sm"
                variant="secondary"
                icon="sparkles"
                loading={isBatchGeneratingImages}
                onClick={() => { void generateMissingImages() }}
                disabled={missingImageItems.length === 0 || isBatchPreparingPrompts}
              >
                按已固定提示词批量生成
              </StudioButton>
              <StudioButton size="sm" icon="check" onClick={() => onNavigate('videos')} disabled={!productionReady}>
                {productionBlockLabel}
              </StudioButton>
            </>
          ) : undefined}
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-6 py-3">
          <button
            type="button"
            onClick={() => onNavigate('storyboard-script')}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${activeStep === 'plan' ? 'bg-[#f3e9cf] text-[#161512]' : 'bg-white/[0.04] text-stone-400 hover:bg-white/[0.08]'}`}
          >
            1. 分镜文稿
          </button>
          <AppIcon name="arrowRight" className="h-4 w-4 text-stone-600" />
          <button
            type="button"
            onClick={() => onNavigate('voice')}
            className="rounded-md bg-white/[0.04] px-4 py-2 text-sm font-semibold text-stone-400 transition-colors hover:bg-white/[0.08]"
          >
            2. 台词与声音
          </button>
          <AppIcon name="arrowRight" className="h-4 w-4 text-stone-600" />
          <button
            type="button"
            onClick={() => onNavigate('storyboard-images')}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${activeStep === 'images' ? 'bg-[#f3e9cf] text-[#161512]' : 'bg-white/[0.04] text-stone-400 hover:bg-white/[0.08]'}`}
          >
            3. 分镜图片
          </button>
        </div>

        {activeStep === 'plan' ? (
          <div className="p-4">
            <StudioShotPlanEditor model={model} workflowState={workflowState} onStoryboardReady={() => onNavigate('voice')} />
          </div>
        ) : (
          <>
            <div className="grid gap-4 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
              <StudioMetric label="镜头" value={items.length} />
              <StudioMetric label="图片完成" value={`${items.filter(itemReadyForProduction).length}/${items.length}`} />
              <StudioMetric label="生成中" value={controller.runningCount} />
              <StudioMetric label="待生成" value={controller.pendingPanelCount} />
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-b border-white/10 bg-white/[0.02] px-6 py-4">
              <StudioButton size="sm" variant="secondary" icon="mic" onClick={() => onNavigate('voice')}>
                台词与声音
              </StudioButton>
            </div>

            {!productionReady && items.length > 0 ? (
              <div className="border-b border-amber-400/20 bg-amber-400/[0.07] px-6 py-3 text-sm text-amber-100">
                进入生产台前，需要为每个镜头确认定稿图片，并等待所有图片任务结束。
              </div>
            ) : null}

            {items.length === 0 ? (
              <div className="p-6">
                <StudioEmptyState
                  icon="image"
                  title="还没有可制作的分镜图片"
                  description="先在“分镜文稿”中生成并确认镜头，完成台词与声音后再进入这里。"
                  action={<StudioButton icon="chevronLeft" variant="secondary" onClick={() => onNavigate('storyboard-script')}>返回分镜文稿</StudioButton>}
                />
              </div>
            ) : (
              <div className="grid min-h-[620px] gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-[#10110f]">
                  <div className="border-b border-white/10 px-4 py-4">
                    <StudioSectionHeader
                      title="镜头队列"
                      description={reviewMode ? `一次处理一个待确认镜头，完成后自动进入下一个（剩余 ${reviewItems.length}）` : '逐个确认画面描述、角色场景绑定和定稿图片。'}
                      actions={(
                        <div className="flex rounded-md border border-white/10 bg-[#0f100e] p-1">
                          <button type="button" onClick={() => setReviewMode(false)} className={`rounded px-3 py-1.5 text-xs font-semibold ${!reviewMode ? 'bg-[#f3e9cf] text-[#161512]' : 'text-stone-500 hover:text-stone-200'}`}>全部</button>
                          <button type="button" onClick={() => setReviewMode(true)} className={`rounded px-3 py-1.5 text-xs font-semibold ${reviewMode ? 'bg-[#f3e9cf] text-[#161512]' : 'text-stone-500 hover:text-stone-200'}`}>待确认 {reviewItems.length}</button>
                        </div>
                      )}
                    />
                  </div>
                  <div className="space-y-3 p-3">
                    {reviewMode && reviewItems.length === 0 ? (
                      <div className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-4 py-5 text-center text-sm text-emerald-100">全部镜头已确认，可以进入视频制作。</div>
                    ) : null}
                    {(reviewMode ? selectedItem ? [selectedItem] : [] : visibleItems).map((item) => {
                      const candidates = controller.getPanelCandidates(item.sourcePanel)
                      const submitting = controller.submittingPanelImageIds.has(item.panel.id)
                      const modifying = controller.modifyingPanels.has(item.panel.id)
                      const workflowPresentation = resolvePanelImageWorkflowPresentation({
                        panel: item.sourcePanel,
                        hasCandidates: !!candidates,
                        isSubmitting: submitting,
                        isModifying: modifying,
                      })
                      return (
                        <StudioBoardShotCard
                          key={item.panel.id}
                          item={item}
                          selected={selectedItem?.panel.id === item.panel.id}
                          status={workflowPresentation.status}
                          statusLabel={workflowPresentation.label}
                          imageUrl={currentImageUrl(item, candidates)}
                          running={workflowPresentation.blocksConfirmation}
                          runningLabel={workflowPresentation.label}
                          onSelect={() => setSelectedPanelId(item.panel.id)}
                          onPreview={controller.setPreviewImage}
                        />
                      )
                    })}
                  </div>
                </div>
                {selectedItem ? (
                  <BoardDetailPanel
                    projectId={projectId}
                    item={selectedItem}
                    controller={controller}
                    confirmLabel={reviewMode && reviewItems.length > 1 ? '确认并查看下一个' : undefined}
                    onCandidateConfirmed={reviewMode ? advanceReview : undefined}
                  />
                ) : null}
              </div>
            )}
          </>
        )}
      </section>

      {modalRuntime.editingPanel ? (
        <ImageEditModal
          projectId={modalRuntime.projectId}
          defaultAssets={modalRuntime.imageEditDefaults}
          onSubmit={modalRuntime.handleEditSubmit}
          onClose={modalRuntime.closeImageEditModal}
        />
      ) : null}

      {modalRuntime.aiDataPanel && modalRuntime.aiDataRuntime ? (
        <AIDataModal
          isOpen={true}
          onClose={modalRuntime.closeAIDataModal}
          syncKey={modalRuntime.aiDataRuntime.panel.id}
          projectId={projectId}
          panelId={modalRuntime.aiDataRuntime.panel.id}
          panelNumber={modalRuntime.aiDataRuntime.panelData.panelNumber || modalRuntime.aiDataPanel.panelIndex + 1}
          shotType={modalRuntime.aiDataRuntime.panelData.shotType}
          cameraMove={modalRuntime.aiDataRuntime.panelData.cameraMove}
          description={modalRuntime.aiDataRuntime.panelData.description}
          location={modalRuntime.aiDataRuntime.panelData.location}
          characters={modalRuntime.aiDataRuntime.characters}
          imagePrompt={modalRuntime.aiDataRuntime.panelData.imagePrompt || null}
          videoPrompt={modalRuntime.aiDataRuntime.panelData.videoPrompt}
          photographyRules={modalRuntime.aiDataRuntime.photographyRules}
          actingNotes={modalRuntime.aiDataRuntime.actingNotes}
          videoRatio={modalRuntime.videoRatio}
          onSave={modalRuntime.handleSaveAIData}
        />
      ) : null}

      {modalRuntime.previewImage ? (
        <ImagePreviewModal imageUrl={modalRuntime.previewImage} onClose={modalRuntime.closePreviewImage} />
      ) : null}

      {modalRuntime.hasCharacterPicker ? (
        <CharacterPickerModal
          projectId={projectId}
          currentCharacters={modalRuntime.pickerPanelRuntime ? controller.getPanelEditData(modalRuntime.pickerPanelRuntime.panel).characters : []}
          onSelect={modalRuntime.handleAddCharacter}
          onClose={modalRuntime.closeAssetPicker}
        />
      ) : null}

      {modalRuntime.hasLocationPicker ? (
        <LocationPickerModal
          projectId={projectId}
          currentLocation={modalRuntime.pickerPanelRuntime ? controller.getPanelEditData(modalRuntime.pickerPanelRuntime.panel).location || null : null}
          onSelect={modalRuntime.handleSetLocation}
          onClose={modalRuntime.closeAssetPicker}
        />
      ) : null}

      {modalRuntime.hasPropPicker ? (
        <PropPickerModal
          projectId={projectId}
          currentProps={modalRuntime.pickerPanelRuntime ? controller.getPanelEditData(modalRuntime.pickerPanelRuntime.panel).props : []}
          onSelect={modalRuntime.handleAddProp}
          onClose={modalRuntime.closeAssetPicker}
        />
      ) : null}
    </div>
  )
}

export default function StudioBoardCanvas({ model, onNavigate, workflowState }: StudioBoardCanvasProps) {
  const { projectId, episodeId } = useWorkspaceProvider()

  if (!episodeId) {
    return <StudioBoardEmpty />
  }

  return (
    <StudioBoardRuntime
      model={model}
      onNavigate={onNavigate}
      workflowState={workflowState}
      projectId={projectId}
      episodeId={episodeId}
    />
  )
}

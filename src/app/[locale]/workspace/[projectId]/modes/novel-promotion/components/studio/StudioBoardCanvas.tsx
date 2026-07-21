'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import { CharacterPickerModal, LocationPickerModal, type PanelEditData } from '../PanelEditForm'
import StoryboardStage from '../StoryboardStage'
import AIDataModal from '../storyboard/AIDataModal'
import ImageEditModal from '../storyboard/ImageEditModal'
import { useStoryboardModalRuntime } from '../storyboard/hooks/useStoryboardModalRuntime'
import { useStoryboardStageController } from '../storyboard/hooks/useStoryboardStageController'
import type { StoryboardPanel } from '../storyboard/hooks/useStoryboardState'
import { getStoryboardPanels } from '../storyboard/hooks/storyboard-state-utils'
import { statusLabel, type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioBoardCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
  workflowState: CreationWorkflowState
}

interface BoardItem {
  storyboard: NovelPromotionStoryboard
  panel: StoryboardPanel
  panelOffset: number
  sourcePanel: NovelPromotionPanel
  globalNumber: number
}

function statusClass(status: StudioProductStatus) {
  if (status === 'locked') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'generating') return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'
  if (status === 'failed') return 'border-rose-400/30 bg-rose-400/10 text-rose-100'
  if (status === 'stale' || status === 'needs_review') return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  return 'border-white/10 bg-white/5 text-stone-300'
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

function EmptyBoard({ model }: { model: StudioWorkspaceModel }) {
  const runtime = useWorkspaceStageRuntime()
  return (
    <div className="flex min-h-[440px] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#151613] px-6 py-12 text-center">
      <AppIcon name="image" className="h-8 w-8 text-[#e8d18a]" />
      <h2 className="mt-4 text-lg font-semibold text-stone-50">分镜还没有生成</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">Visual Kit 确认后再生成分镜，保证核心角色和场景在镜头间保持一致。</p>
      <div className="mt-5">
        <Button onClick={() => { void runtime.onRunScriptToStoryboard() }} disabled={!model.workflow.visualApproved || runtime.isTransitioning}>
          <AppIcon name={runtime.isTransitioning ? 'loader' : 'sparkles'} className={`h-4 w-4 ${runtime.isTransitioning ? 'animate-spin' : ''}`} />
          生成分镜
        </Button>
      </div>
    </div>
  )
}

function flattenBoardItems(
  storyboards: NovelPromotionStoryboard[],
  getTextPanels: ReturnType<typeof useStoryboardStageController>['getTextPanels'],
): BoardItem[] {
  return storyboards.flatMap((storyboard, storyboardIndex) => {
    const sourcePanels = getStoryboardPanels(storyboard)
    return getTextPanels(storyboard).flatMap((panel, panelOffset) => {
      const sourcePanel = sourcePanels.find((item) => item.id === panel.id)
      if (!sourcePanel) return []
      return [{
        storyboard,
        panel,
        panelOffset,
        sourcePanel,
        globalNumber: panel.panel_number || storyboardIndex * 100 + panelOffset + 1,
      }]
    })
  })
}

function resolvePanelStatus({
  panel,
  sourcePanel,
  hasCandidates,
  submitting,
  modifying,
}: {
  panel: BoardItem['panel']
  sourcePanel: NovelPromotionPanel
  hasCandidates: boolean
  submitting: boolean
  modifying: boolean
}): StudioProductStatus {
  if (submitting || modifying || sourcePanel.imageTaskRunning) return 'generating'
  if (sourcePanel.imageErrorMessage) return 'failed'
  if (hasCandidates) return 'needs_review'
  if (panel.imageUrl) return 'locked'
  if (panel.description) return 'drafting'
  return 'empty'
}

function currentImageUrl(item: BoardItem, candidates: { candidates: string[]; selectedIndex: number } | null) {
  const candidate = candidates?.candidates[candidates.selectedIndex]
  if (candidate && !candidate.startsWith('PENDING:')) return candidate
  return item.panel.imageUrl || null
}

function BoardShotCard({
  item,
  selected,
  status,
  imageUrl,
  running,
  onSelect,
  onPreview,
}: {
  item: BoardItem
  selected: boolean
  status: StudioProductStatus
  imageUrl: string | null
  running: boolean
  onSelect: () => void
  onPreview: (url: string) => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid min-h-[180px] gap-3 rounded-lg border p-3 text-left transition-colors sm:grid-cols-[160px_minmax(0,1fr)] ${selected
        ? 'border-[#e8d18a]/70 bg-[#1b1a14]'
        : 'border-white/10 bg-[#10110f] hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-[#0b0c0a]">
        {imageUrl ? (
          <MediaImageWithLoading
            src={imageUrl}
            alt={`Shot ${item.globalNumber}`}
            containerClassName="h-full w-full"
            className="h-full w-full object-cover"
            sizes="220px"
            onDoubleClick={(event) => {
              event.stopPropagation()
              onPreview(imageUrl)
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-stone-600">
            <AppIcon name="image" className="h-7 w-7" />
          </div>
        )}
        {running ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-cyan-100">
            <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />
            生成中
          </div>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-stone-50">Shot {String(item.globalNumber).padStart(2, '0')}</h2>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(status)}`}>{statusLabel(status)}</span>
        </div>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-300">{item.panel.description || '待补充画面描述'}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-400">
          {item.panel.location ? <span className="rounded bg-white/[0.05] px-2 py-1">{item.panel.location}</span> : null}
          {item.panel.characters.slice(0, 3).map((character) => (
            <span key={`${item.panel.id}:${character.name}:${character.appearance}`} className="rounded bg-white/[0.05] px-2 py-1">
              {character.name}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}

function BoardInspector({
  item,
  controller,
}: {
  item: BoardItem
  controller: ReturnType<typeof useStoryboardStageController>
}) {
  const panelData = controller.getPanelEditData(item.panel)
  const saveState = controller.saveStateByPanel[item.panel.id]
  const candidates = controller.getPanelCandidates(item.sourcePanel)
  const selectedImageUrl = currentImageUrl(item, candidates)
  const isSubmitting = controller.submittingPanelImageIds.has(item.panel.id) || !!item.sourcePanel.imageTaskRunning
  const isModifying = controller.modifyingPanels.has(item.panel.id)
  const disabled = isSubmitting || isModifying
  const update = (updates: Partial<PanelEditData>) => {
    controller.handlePanelUpdate(item.panel.id, item.panel, updates)
  }

  return (
    <aside className="rounded-lg border border-white/10 bg-[#151613]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8a85f]">Shot Inspector</p>
          <h2 className="mt-1 text-base font-semibold text-stone-50">Shot {String(item.globalNumber).padStart(2, '0')}</h2>
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
              alt={`Shot ${item.globalNumber}`}
              containerClassName="h-full w-full"
              className="h-full w-full object-cover"
              sizes="420px"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-600">
              <AppIcon name="image" className="h-8 w-8" />
            </div>
          )}
          {disabled ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-cyan-100">
              <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />
              {isModifying ? '改图中' : '生成中'}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => { void controller.regeneratePanelImage(item.panel.id, 3, false) }} disabled={disabled}>
            <AppIcon name={isSubmitting ? 'loader' : 'sparkles'} className={`h-4 w-4 ${isSubmitting ? 'animate-spin' : ''}`} />
            生成候选图
          </Button>
          <Button
            variant="secondary"
            onClick={() => controller.setEditingPanel({ storyboardId: item.storyboard.id, panelIndex: item.panelOffset })}
            disabled={disabled || !item.panel.imageUrl}
          >
            <AppIcon name="imageEdit" className="h-4 w-4" />
            改图
          </Button>
          <Button
            variant="secondary"
            onClick={() => controller.setAIDataPanel({ storyboardId: item.storyboard.id, panelIndex: item.panelOffset })}
          >
            <AppIcon name="clapperboard" className="h-4 w-4" />
            AI 数据
          </Button>
          <Button
            variant="secondary"
            onClick={() => selectedImageUrl && controller.setPreviewImage(selectedImageUrl)}
            disabled={!selectedImageUrl}
          >
            <AppIcon name="image" className="h-4 w-4" />
            预览
          </Button>
        </div>

        {candidates ? (
          <div className="rounded-md border border-amber-400/25 bg-amber-400/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-amber-100">候选图待确认</span>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    const imageUrl = candidates.candidates[candidates.selectedIndex]
                    if (imageUrl && !imageUrl.startsWith('PENDING:')) {
                      void controller.selectPanelCandidate(item.panel.id, imageUrl)
                    }
                  }}
                  disabled={disabled}
                >
                  <AppIcon name="check" className="h-4 w-4" />
                  设为定稿
                </Button>
                <Button variant="ghost" onClick={() => { void controller.cancelPanelCandidate(item.panel.id) }} disabled={disabled}>取消</Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {candidates.candidates.map((candidateUrl, index) => {
                const pending = candidateUrl.startsWith('PENDING:')
                const selected = index === candidates.selectedIndex
                return (
                  <button
                    key={`${candidateUrl}:${index}`}
                    type="button"
                    onClick={() => {
                      if (!pending) controller.selectPanelCandidateIndex(item.panel.id, index)
                    }}
                    disabled={pending}
                    className={`relative aspect-video overflow-hidden rounded-md border ${selected ? 'border-[#e8d18a]' : 'border-white/10 hover:border-white/30'}`}
                  >
                    {pending ? (
                      <div className="flex h-full items-center justify-center bg-black/30 text-[11px] text-stone-400">
                        <AppIcon name="loader" className="mr-1 h-3 w-3 animate-spin" />
                        等待
                      </div>
                    ) : (
                      <MediaImageWithLoading
                        src={candidateUrl}
                        alt={`候选 ${index + 1}`}
                        containerClassName="h-full w-full"
                        className="h-full w-full object-cover"
                        sizes="140px"
                      />
                    )}
                  </button>
                )
              })}
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
            <Button variant="ghost" onClick={() => controller.setAssetPickerPanel({ panelId: item.panel.id, type: 'location' })}>
              <AppIcon name="imageLandscape" className="h-4 w-4" />
              选择场景
            </Button>
            {panelData.location ? (
              <Button variant="ghost" onClick={() => controller.handleRemoveLocation(item.panel, item.storyboard.id)}>移除</Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {panelData.characters.map((character, index) => (
              <span key={`${character.name}:${character.appearance}:${index}`} className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-xs text-stone-300">
                {character.name}
                <button type="button" onClick={() => controller.handleRemoveCharacter(item.panel, index, item.storyboard.id)} className="text-stone-500 hover:text-stone-100">
                  <AppIcon name="closeSm" className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Button variant="ghost" onClick={() => controller.setAssetPickerPanel({ panelId: item.panel.id, type: 'character' })}>
              <AppIcon name="user" className="h-4 w-4" />
              添加角色
            </Button>
          </div>
          {saveState?.status === 'error' ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
              <span>{saveState.errorMessage || '保存失败'}</span>
              <Button variant="secondary" onClick={() => controller.retrySave(item.panel.id)}>重试</Button>
            </div>
          ) : null}
        </div>
      </div>

    </aside>
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
  const [showAdvanced, setShowAdvanced] = useState(false)
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
  const selectedItem = items.find((item) => item.panel.id === selectedPanelId) || items[0] || null

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
    updatePhotographyPlanMutation: controller.updatePhotographyPlanMutation,
    updatePanelActingNotesMutation: controller.updatePanelActingNotesMutation,
  })

  useEffect(() => {
    if (selectedItem && selectedItem.panel.id !== selectedPanelId) {
      setSelectedPanelId(selectedItem.panel.id)
    }
  }, [selectedItem, selectedPanelId])

  if (items.length === 0) {
    return <EmptyBoard model={model} />
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151613]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Board</p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-50">镜头分镜板</h1>
            <p className="mt-2 text-sm text-stone-400">在主画布直接编辑镜头、绑定角色场景、生成图片候选，并打开 AI 数据。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { void controller.handleGenerateAllPanels() }} disabled={controller.isEpisodeBatchSubmitting}>
              <AppIcon name={controller.isEpisodeBatchSubmitting ? 'loader' : 'sparkles'} className={`h-4 w-4 ${controller.isEpisodeBatchSubmitting ? 'animate-spin' : ''}`} />
              生成缺失图片
            </Button>
            <Button onClick={() => onNavigate('videos')}>
              <AppIcon name="check" className="h-4 w-4" />
              确认并进入制作
            </Button>
          </div>
        </header>

        <div className="grid gap-4 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
          <Metric label="镜头" value={items.length} />
          <Metric label="图片完成" value={`${items.filter((item) => item.panel.imageUrl).length}/${items.length}`} />
          <Metric label="生成中" value={controller.runningCount} />
          <Metric label="待生成" value={controller.pendingPanelCount} />
        </div>

        <div className="grid min-h-[620px] gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
            {items.map((item) => {
              const candidates = controller.getPanelCandidates(item.sourcePanel)
              const submitting = controller.submittingPanelImageIds.has(item.panel.id)
              const modifying = controller.modifyingPanels.has(item.panel.id)
              const status = resolvePanelStatus({
                panel: item.panel,
                sourcePanel: item.sourcePanel,
                hasCandidates: !!candidates,
                submitting,
                modifying,
              })
              return (
                <BoardShotCard
                  key={item.panel.id}
                  item={item}
                  selected={selectedItem?.panel.id === item.panel.id}
                  status={status}
                  imageUrl={currentImageUrl(item, candidates)}
                  running={submitting || modifying || !!item.sourcePanel.imageTaskRunning}
                  onSelect={() => setSelectedPanelId(item.panel.id)}
                  onPreview={controller.setPreviewImage}
                />
              )
            })}
          </div>
          {selectedItem ? (
            <BoardInspector item={selectedItem} controller={controller} />
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#151613] p-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
          className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-stone-100"
        >
          <span>完整分镜编辑器</span>
          <AppIcon name="chevronDown" className={`h-4 w-4 text-stone-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>
        {showAdvanced ? (
          <div className="mt-4 rounded-md bg-white/[0.02] p-4 text-[var(--glass-text-primary)]">
            <StoryboardStage workspaceLayout workflowState={workflowState} />
          </div>
        ) : null}
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
          panelNumber={modalRuntime.aiDataRuntime.panelData.panelNumber || modalRuntime.aiDataPanel.panelIndex + 1}
          shotType={modalRuntime.aiDataRuntime.panelData.shotType}
          cameraMove={modalRuntime.aiDataRuntime.panelData.cameraMove}
          description={modalRuntime.aiDataRuntime.panelData.description}
          location={modalRuntime.aiDataRuntime.panelData.location}
          characters={modalRuntime.aiDataRuntime.characters}
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
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-stone-100">{value}</div>
    </div>
  )
}

export default function StudioBoardCanvas({ model, onNavigate, workflowState }: StudioBoardCanvasProps) {
  const { projectId, episodeId } = useWorkspaceProvider()

  if (!episodeId || model.shots.length === 0) {
    return <EmptyBoard model={model} />
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

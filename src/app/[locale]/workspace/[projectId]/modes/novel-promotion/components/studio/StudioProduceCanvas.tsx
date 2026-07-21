'use client'

import { useEffect, useMemo, useState } from 'react'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import VideoStageRoute from '../VideoStageRoute'
import VoiceStageRoute from '../VoiceStageRoute'
import { getStoryboardPanels } from '../storyboard/hooks/storyboard-state-utils'
import {
  StudioAdvancedPanel,
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
  studioStatusClass,
} from './StudioPrimitives'
import { statusLabel, type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioProduceCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

interface ProduceItem {
  id: string
  storyboard: NovelPromotionStoryboard
  panel: NovelPromotionPanel
  number: number
}

function panelVideoUrl(panel: NovelPromotionPanel) {
  return panel.lipSyncVideoUrl || panel.videoUrl || null
}

function panelVideoError(panel: NovelPromotionPanel) {
  const record = panel as NovelPromotionPanel & { videoErrorMessage?: string | null; lipSyncErrorMessage?: string | null }
  return record.videoErrorMessage || record.lipSyncErrorMessage || null
}

function panelLipSyncTaskRunning(panel: NovelPromotionPanel) {
  const record = panel as NovelPromotionPanel & { lipSyncTaskRunning?: boolean | null }
  return !!record.lipSyncTaskRunning
}

function panelVideoModel(panel: NovelPromotionPanel) {
  const record = panel as NovelPromotionPanel & { videoModel?: string | null }
  return record.videoModel || null
}

function resolveImageStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panel.imageTaskRunning) return 'generating'
  if (panel.imageErrorMessage) return 'failed'
  if (panel.imageUrl) return 'locked'
  return 'empty'
}

function resolveVideoStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panel.videoTaskRunning || panelLipSyncTaskRunning(panel)) return 'generating'
  if (panelVideoError(panel)) return 'failed'
  if (panelVideoUrl(panel)) return 'locked'
  if (panel.imageUrl) return 'needs_review'
  return 'empty'
}

function resolveVoiceStatus(panel: NovelPromotionPanel): StudioProductStatus {
  if (panelLipSyncTaskRunning(panel)) return 'generating'
  if (panel.lipSyncVideoUrl) return 'locked'
  return 'empty'
}

function buildItems(storyboards: NovelPromotionStoryboard[]): ProduceItem[] {
  return storyboards.flatMap((storyboard, storyboardIndex) => (
    getStoryboardPanels(storyboard).map((panel, panelOffset) => ({
      id: panel.id,
      storyboard,
      panel,
      number: panel.panelNumber || storyboardIndex * 100 + panelOffset + 1,
    }))
  ))
}

function EmptyProduce({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <StudioEmptyState
      icon="video"
      title="没有可制作的镜头"
      description="先确认分镜，再进入镜头图片、视频和配音制作。"
      action={<StudioButton onClick={() => onNavigate('storyboard')}>返回分镜板</StudioButton>}
    />
  )
}

function ProduceQueueRow({
  item,
  selected,
  onSelect,
}: {
  item: ProduceItem
  selected: boolean
  onSelect: () => void
}) {
  const imageStatus = resolveImageStatus(item.panel)
  const videoStatus = resolveVideoStatus(item.panel)
  const voiceStatus = resolveVoiceStatus(item.panel)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full gap-3 rounded-lg border p-3 text-left transition-colors md:grid-cols-[92px_minmax(0,1fr)] ${selected
        ? 'border-[#e8d18a]/70 bg-[#1b1a14]'
        : 'border-white/10 bg-[#10110f] hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-black">
        {item.panel.imageUrl ? (
          <MediaImageWithLoading
            src={item.panel.imageUrl}
            alt={`镜头 ${item.number}`}
            containerClassName="h-full w-full"
            className="h-full w-full object-cover"
            sizes="120px"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-stone-600">
            <AppIcon name="image" className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-stone-50">镜头 {String(item.number).padStart(2, '0')}</span>
          <StudioStatusBadge status={videoStatus} />
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-400">{item.panel.description || item.panel.videoPrompt || '待补充镜头描述'}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className={`rounded border px-2 py-0.5 ${studioStatusClass(imageStatus)}`}>图 {statusLabel(imageStatus)}</span>
          <span className={`rounded border px-2 py-0.5 ${studioStatusClass(videoStatus)}`}>视频 {statusLabel(videoStatus)}</span>
          <span className={`rounded border px-2 py-0.5 ${studioStatusClass(voiceStatus)}`}>配音 {statusLabel(voiceStatus)}</span>
        </div>
      </div>
    </button>
  )
}

function ProductionDetailPanel({ item }: { item: ProduceItem }) {
  const runtime = useWorkspaceStageRuntime()
  const initialModel = panelVideoModel(item.panel) || runtime.videoModel || runtime.userVideoModels[0]?.value || ''
  const [prompt, setPrompt] = useState(item.panel.videoPrompt || '')
  const [selectedModel, setSelectedModel] = useState(initialModel)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [generating, setGenerating] = useState(false)
  const videoUrl = panelVideoUrl(item.panel)
  const videoStatus = resolveVideoStatus(item.panel)
  const error = panelVideoError(item.panel)

  useEffect(() => {
    setPrompt(item.panel.videoPrompt || '')
    setSelectedModel(panelVideoModel(item.panel) || runtime.videoModel || runtime.userVideoModels[0]?.value || '')
  }, [item.panel, runtime.userVideoModels, runtime.videoModel])

  const savePrompt = async () => {
    if (prompt === (item.panel.videoPrompt || '')) return
    setSavingPrompt(true)
    try {
      await runtime.onUpdateVideoPrompt(item.storyboard.id, item.panel.panelIndex, prompt)
    } finally {
      setSavingPrompt(false)
    }
  }

  const changeModel = async (value: string) => {
    setSelectedModel(value)
    if (value.trim()) {
      await runtime.onUpdatePanelVideoModel(item.storyboard.id, item.panel.panelIndex, value)
    }
  }

  const generate = async () => {
    await savePrompt()
    if (!selectedModel.trim()) {
      window.alert('请先在设置中配置视频模型。')
      return
    }
    setGenerating(true)
    try {
      await runtime.onGenerateVideo(
        item.storyboard.id,
        item.panel.panelIndex,
        selectedModel,
        undefined,
        undefined,
        item.panel.id,
      )
    } finally {
      setGenerating(false)
    }
  }

  return (
    <aside className="rounded-lg border border-white/10 bg-[#151613]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
        <div>
          <p className="text-xs font-semibold text-[#c8a85f]">视频生产</p>
          <h2 className="mt-1 text-base font-semibold text-stone-50">镜头 {String(item.number).padStart(2, '0')}</h2>
        </div>
        <StudioStatusBadge status={videoStatus} />
      </header>

      <div className="space-y-4 p-4">
        <div className="grid gap-3">
          <div className="relative aspect-video overflow-hidden rounded-md bg-black">
            {videoUrl ? (
              <video src={videoUrl} controls className="h-full w-full object-contain" />
            ) : item.panel.imageUrl ? (
              <MediaImageWithLoading
                src={item.panel.imageUrl}
                alt={`镜头 ${item.number}`}
                containerClassName="h-full w-full"
                className="h-full w-full object-cover"
                sizes="420px"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-stone-600">
                <AppIcon name="video" className="h-8 w-8" />
              </div>
            )}
            {(generating || item.panel.videoTaskRunning || panelLipSyncTaskRunning(item.panel)) ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-cyan-100">
                <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />
                生成中
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div>
          ) : null}
        </div>

        <label className="block text-xs font-semibold text-stone-500">
          视频模型
          <select
            value={selectedModel}
            onChange={(event) => { void changeModel(event.target.value) }}
            className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]"
          >
            {selectedModel && !runtime.userVideoModels.some((itemModel) => itemModel.value === selectedModel) ? (
              <option value={selectedModel}>{selectedModel}</option>
            ) : null}
            {runtime.userVideoModels.map((itemModel) => (
              <option key={itemModel.value} value={itemModel.value}>{itemModel.label}</option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold text-stone-500">
          视频提示词
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={() => { void savePrompt() }}
            rows={6}
            className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
            placeholder="描述视频运动、镜头节奏、主体动作和画面变化。"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-stone-500">{savingPrompt ? '提示词保存中' : prompt === (item.panel.videoPrompt || '') ? '提示词已保存' : '提示词未保存'}</span>
          <div className="flex gap-2">
            <StudioButton size="sm" variant="secondary" onClick={() => { void savePrompt() }} disabled={savingPrompt}>保存提示词</StudioButton>
            <StudioButton size="sm" icon="video" loading={generating || !!item.panel.videoTaskRunning} onClick={() => { void generate() }} disabled={!item.panel.imageUrl}>
              {videoUrl ? '重新生成视频' : '生成视频'}
            </StudioButton>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default function StudioProduceCanvas({ model, onNavigate }: StudioProduceCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const { storyboards } = useWorkspaceEpisodeStageData()
  const [selectedId, setSelectedId] = useState('')
  const [showVideoWorkbench, setShowVideoWorkbench] = useState(false)
  const [showVoiceWorkbench, setShowVoiceWorkbench] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const items = useMemo(() => buildItems(storyboards), [storyboards])
  const selectedItem = items.find((item) => item.id === selectedId) || items[0] || null
  const videoModel = runtime.videoModel || runtime.userVideoModels[0]?.value || ''

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) {
      setSelectedId(selectedItem.id)
    }
  }, [selectedId, selectedItem])

  const generateAll = async () => {
    if (!videoModel.trim()) {
      window.alert('请先在设置中配置视频模型。')
      return
    }
    setGeneratingAll(true)
    try {
      await runtime.onGenerateAllVideos({ videoModel })
    } finally {
      setGeneratingAll(false)
    }
  }

  if (items.length === 0 || model.productionItems.length === 0) {
    return <EmptyProduce onNavigate={onNavigate} />
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151613]">
        <StudioStageHeader
          eyebrow="生产台"
          title="镜头生产控制台"
          description="按镜头跟进图片、视频和配音状态，生产完成后进入成片检查。"
          actions={(
            <StudioButton icon="video" loading={generatingAll} onClick={() => { void generateAll() }} disabled={runtime.isTransitioning}>
            生成缺失镜头
            </StudioButton>
          )}
        />

        <div className="grid gap-4 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
          <StudioMetric label="镜头" value={items.length} />
          <StudioMetric label="图片完成" value={items.filter((item) => item.panel.imageUrl).length} />
          <StudioMetric label="视频完成" value={items.filter((item) => panelVideoUrl(item.panel)).length} />
          <StudioMetric label="失败" value={items.filter((item) => panelVideoError(item.panel)).length} />
        </div>

        <div className="grid min-h-[620px] gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-[#10110f]">
            <div className="border-b border-white/10 px-4 py-4">
              <StudioSectionHeader
                title="生产队列"
                description="按镜头查看图片、视频和配音的生产状态。"
              />
            </div>
            <div className="max-h-[660px] space-y-3 overflow-y-auto p-3">
              {items.map((item) => (
                <ProduceQueueRow
                  key={item.id}
                  item={item}
                  selected={selectedItem?.id === item.id}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
            </div>
          </div>
          {selectedItem ? <ProductionDetailPanel item={selectedItem} /> : null}
        </div>
      </section>

      <StudioAdvancedPanel title="视频专家面板" description="首尾帧、批量参数和更细的视频控制集中在此面板。">
        {showVideoWorkbench ? (
          <VideoStageRoute />
        ) : (
          <StudioButton size="sm" variant="secondary" onClick={() => setShowVideoWorkbench(true)}>
            打开视频专家工具
          </StudioButton>
        )}
      </StudioAdvancedPanel>

      <StudioAdvancedPanel title="配音专家面板" description="声音生成、音频检查和口型同步的细节控制集中在此面板。">
        {showVoiceWorkbench ? (
          <VoiceStageRoute />
        ) : (
          <StudioButton size="sm" variant="secondary" onClick={() => setShowVoiceWorkbench(true)}>
            打开配音专家工具
          </StudioButton>
        )}
      </StudioAdvancedPanel>
    </div>
  )
}

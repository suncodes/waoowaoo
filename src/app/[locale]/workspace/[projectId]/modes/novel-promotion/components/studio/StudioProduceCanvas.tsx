'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import VideoStageRoute from '../VideoStageRoute'
import VoiceStageRoute from '../VoiceStageRoute'
import { getStoryboardPanels } from '../storyboard/hooks/storyboard-state-utils'
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
    <div className="flex min-h-[440px] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#151613] px-6 py-12 text-center">
      <AppIcon name="video" className="h-8 w-8 text-[#e8d18a]" />
      <h2 className="mt-4 text-lg font-semibold text-stone-50">没有可制作的镜头</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">先确认分镜，再进入镜头图片、视频和配音制作。</p>
      <div className="mt-5">
        <Button onClick={() => onNavigate('storyboard')}>返回 Board</Button>
      </div>
    </div>
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
            alt={`Shot ${item.number}`}
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
          <span className="text-sm font-semibold text-stone-50">Shot {String(item.number).padStart(2, '0')}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(videoStatus)}`}>{statusLabel(videoStatus)}</span>
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-400">{item.panel.description || item.panel.videoPrompt || '待补充镜头描述'}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className={`rounded border px-2 py-0.5 ${statusClass(imageStatus)}`}>图 {statusLabel(imageStatus)}</span>
          <span className={`rounded border px-2 py-0.5 ${statusClass(videoStatus)}`}>视频 {statusLabel(videoStatus)}</span>
          <span className={`rounded border px-2 py-0.5 ${statusClass(voiceStatus)}`}>配音 {statusLabel(voiceStatus)}</span>
        </div>
      </div>
    </button>
  )
}

function ProduceInspector({ item }: { item: ProduceItem }) {
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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8a85f]">Render Inspector</p>
          <h2 className="mt-1 text-base font-semibold text-stone-50">Shot {String(item.number).padStart(2, '0')}</h2>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(videoStatus)}`}>{statusLabel(videoStatus)}</span>
      </header>

      <div className="space-y-4 p-4">
        <div className="grid gap-3">
          <div className="relative aspect-video overflow-hidden rounded-md bg-black">
            {videoUrl ? (
              <video src={videoUrl} controls className="h-full w-full object-contain" />
            ) : item.panel.imageUrl ? (
              <MediaImageWithLoading
                src={item.panel.imageUrl}
                alt={`Shot ${item.number}`}
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
            <Button variant="secondary" onClick={() => { void savePrompt() }} disabled={savingPrompt}>保存提示词</Button>
            <Button onClick={() => { void generate() }} disabled={generating || item.panel.videoTaskRunning || !item.panel.imageUrl}>
              <AppIcon name={generating || item.panel.videoTaskRunning ? 'loader' : 'video'} className={`h-4 w-4 ${generating || item.panel.videoTaskRunning ? 'animate-spin' : ''}`} />
              {videoUrl ? '重新生成视频' : '生成视频'}
            </Button>
          </div>
        </div>
      </div>
    </aside>
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
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Produce</p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-50">镜头生产控制台</h1>
            <p className="mt-2 text-sm text-stone-400">在主界面完成视频提示词编辑、模型选择、单镜头生成和结果预览。</p>
          </div>
          <Button onClick={() => { void generateAll() }} disabled={generatingAll || runtime.isTransitioning}>
            <AppIcon name={generatingAll ? 'loader' : 'video'} className={`h-4 w-4 ${generatingAll ? 'animate-spin' : ''}`} />
            生成缺失镜头
          </Button>
        </header>

        <div className="grid gap-4 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
          <Metric label="镜头" value={items.length} />
          <Metric label="图片完成" value={items.filter((item) => item.panel.imageUrl).length} />
          <Metric label="视频完成" value={items.filter((item) => panelVideoUrl(item.panel)).length} />
          <Metric label="失败" value={items.filter((item) => panelVideoError(item.panel)).length} />
        </div>

        <div className="grid min-h-[620px] gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
            {items.map((item) => (
              <ProduceQueueRow
                key={item.id}
                item={item}
                selected={selectedItem?.id === item.id}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </div>
          {selectedItem ? <ProduceInspector item={selectedItem} /> : null}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#151613] p-4">
        <button
          type="button"
          onClick={() => setShowVideoWorkbench((value) => !value)}
          className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-stone-100"
        >
          <span>完整视频工作台</span>
          <AppIcon name="chevronDown" className={`h-4 w-4 text-stone-500 transition-transform ${showVideoWorkbench ? 'rotate-180' : ''}`} />
        </button>
        {showVideoWorkbench ? (
          <div className="mt-4 rounded-md bg-white/[0.02] p-4 text-[var(--glass-text-primary)]">
            <VideoStageRoute />
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-white/10 bg-[#151613] p-4">
        <button
          type="button"
          onClick={() => setShowVoiceWorkbench((value) => !value)}
          className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-stone-100"
        >
          <span>配音工作台</span>
          <AppIcon name="chevronDown" className={`h-4 w-4 text-stone-500 transition-transform ${showVoiceWorkbench ? 'rotate-180' : ''}`} />
        </button>
        {showVoiceWorkbench ? (
          <div className="mt-4 rounded-md bg-white/[0.02] p-4 text-[var(--glass-text-primary)]">
            <VoiceStageRoute />
          </div>
        ) : null}
      </section>
    </div>
  )
}

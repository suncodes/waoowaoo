'use client'

import { useEffect, useMemo, useState } from 'react'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import { useUpdateProjectPanelLink } from '@/lib/query/hooks'
import { useVideoFirstLastFrameFlow } from '@/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import VoiceStageRoute from '../VoiceStageRoute'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
} from './StudioPrimitives'
import StudioProduceQueueRow from './StudioProduceQueueRow'
import {
  buildProduceItems,
  panelLinkedToNext,
  panelLipSyncTaskRunning,
  panelVideoError,
  panelVideoModel,
  panelVideoUrl,
  resolveVideoStatus,
  toVideoPanels,
  type ProduceItem,
} from './studio-produce-model'
import type { StudioWorkspaceModel } from './studio-types'

interface StudioProduceCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

type FirstLastFrameFlow = ReturnType<typeof useVideoFirstLastFrameFlow>

function EmptyProduce({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <StudioEmptyState
      icon="video"
      title="没有可制作的镜头"
      description="先确认分镜图片，再进入单图视频、首尾帧视频和配音制作。"
      action={<StudioButton onClick={() => onNavigate('storyboard')}>返回分镜制作</StudioButton>}
    />
  )
}

function ProductionDetailPanel({
  item,
  nextItem,
  linked,
  linkSaving,
  onToggleLink,
  firstLastFrameFlow,
}: {
  item: ProduceItem
  nextItem: ProduceItem | null
  linked: boolean
  linkSaving: boolean
  onToggleLink: () => Promise<void>
  firstLastFrameFlow: FirstLastFrameFlow
}) {
  const runtime = useWorkspaceStageRuntime()
  const initialModel = panelVideoModel(item.panel) || runtime.videoModel || runtime.userVideoModels[0]?.value || ''
  const panelKey = `${item.storyboard.id}-${item.panel.panelIndex}`
  const initialMode = item.panel.videoGenerationMode === 'firstlastframe' || linked ? 'firstlastframe' : 'normal'
  const [mode, setMode] = useState<'normal' | 'firstlastframe'>(initialMode)
  const [prompt, setPrompt] = useState(item.panel.videoPrompt || '')
  const [selectedModel, setSelectedModel] = useState(initialModel)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [generating, setGenerating] = useState(false)
  const videoUrl = panelVideoUrl(item.panel)
  const videoStatus = resolveVideoStatus(item.panel)
  const error = panelVideoError(item.panel)
  const defaultFirstLastPrompt = firstLastFrameFlow.getDefaultFlPrompt(item.panel.videoPrompt || '', nextItem?.panel.videoPrompt || '')
  const firstLastPrompt = firstLastFrameFlow.flCustomPrompts.get(panelKey)
    || item.panel.firstLastFramePrompt
    || defaultFirstLastPrompt
  const missingFirstLastFrameSetup = !nextItem
    || !item.panel.imageUrl
    || !nextItem.panel.imageUrl
    || !linked
    || !firstLastFrameFlow.flModel
    || firstLastFrameFlow.flMissingCapabilityFields.length > 0

  useEffect(() => {
    setMode(item.panel.videoGenerationMode === 'firstlastframe' || linked ? 'firstlastframe' : 'normal')
    setPrompt(item.panel.videoPrompt || '')
    setSelectedModel(panelVideoModel(item.panel) || runtime.videoModel || runtime.userVideoModels[0]?.value || '')
  }, [item, linked, runtime.userVideoModels, runtime.videoModel])

  const saveNormalPrompt = async () => {
    if (prompt === (item.panel.videoPrompt || '')) return
    setSavingPrompt(true)
    try {
      await runtime.onUpdateVideoPrompt(item.storyboard.id, item.panel.panelIndex, prompt)
    } finally {
      setSavingPrompt(false)
    }
  }

  const saveFirstLastPrompt = async () => {
    if (firstLastPrompt === (item.panel.firstLastFramePrompt || '')) return
    setSavingPrompt(true)
    try {
      await runtime.onUpdateVideoPrompt(item.storyboard.id, item.panel.panelIndex, firstLastPrompt, 'firstLastFramePrompt')
    } finally {
      setSavingPrompt(false)
    }
  }

  const changeModel = async (value: string) => {
    setSelectedModel(value)
    if (value.trim()) await runtime.onUpdatePanelVideoModel(item.storyboard.id, item.panel.panelIndex, value)
  }

  const generate = async () => {
    setGenerating(true)
    try {
      if (mode === 'firstlastframe') {
        if (missingFirstLastFrameSetup || !nextItem) return
        await saveFirstLastPrompt()
        await runtime.onGenerateVideo(
          item.storyboard.id,
          item.panel.panelIndex,
          firstLastFrameFlow.flModel,
          {
            lastFrameStoryboardId: nextItem.storyboard.id,
            lastFramePanelIndex: nextItem.panel.panelIndex,
            flModel: firstLastFrameFlow.flModel,
            customPrompt: firstLastPrompt,
          },
          firstLastFrameFlow.flGenerationOptions,
          item.panel.id,
        )
        return
      }

      await saveNormalPrompt()
      if (!selectedModel.trim()) {
        window.alert('请先在设置中配置视频模型。')
        return
      }
      await runtime.onGenerateVideo(item.storyboard.id, item.panel.panelIndex, selectedModel, undefined, undefined, item.panel.id)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <aside className="rounded-lg border border-white/10 bg-[#151613]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
        <div>
          <p className="text-xs font-semibold text-[#c8a85f]">视频制作</p>
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
              <MediaImageWithLoading src={item.panel.imageUrl} alt={`镜头 ${item.number}`} containerClassName="h-full w-full" className="h-full w-full object-cover" sizes="420px" />
            ) : (
              <div className="flex h-full items-center justify-center text-stone-600"><AppIcon name="video" className="h-8 w-8" /></div>
            )}
            {(generating || item.panel.videoTaskRunning || panelLipSyncTaskRunning(item.panel)) ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-cyan-100">
                <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />生成中
              </div>
            ) : null}
          </div>
          {error ? <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-stone-500">生成模式</div>
          <div className="grid grid-cols-2 rounded-md border border-white/10 bg-[#0f100e] p-1">
            <button type="button" onClick={() => setMode('normal')} className={`h-9 rounded text-sm font-semibold ${mode === 'normal' ? 'bg-[#f3e9cf] text-[#161512]' : 'text-stone-400 hover:bg-white/[0.05]'}`}>单图视频</button>
            <button type="button" onClick={() => setMode('firstlastframe')} disabled={!nextItem} className={`h-9 rounded text-sm font-semibold disabled:opacity-40 ${mode === 'firstlastframe' ? 'bg-[#f3e9cf] text-[#161512]' : 'text-stone-400 hover:bg-white/[0.05]'}`}>首尾帧视频</button>
          </div>
        </div>

        {mode === 'normal' ? (
          <>
            <label className="block text-xs font-semibold text-stone-500">
              视频模型
              <select value={selectedModel} onChange={(event) => { void changeModel(event.target.value) }} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]">
                {selectedModel && !runtime.userVideoModels.some((model) => model.value === selectedModel) ? <option value={selectedModel}>{selectedModel}</option> : null}
                {runtime.userVideoModels.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              视频提示词
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onBlur={() => { void saveNormalPrompt() }} rows={6} className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" placeholder="描述视频运动、镜头节奏、主体动作和画面变化。" />
            </label>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-white/10 bg-[#0f100e] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-stone-300">连接下一镜头</div>
                  <div className="mt-1 text-[11px] text-stone-500">当前镜头作为首帧，下一镜头作为尾帧。</div>
                </div>
                <StudioButton size="sm" variant={linked ? 'secondary' : 'primary'} icon={linked ? 'unplug' : 'link'} loading={linkSaving} onClick={() => { void onToggleLink() }} disabled={!nextItem}>
                  {linked ? '断开' : '连接'}
                </StudioButton>
              </div>
              {nextItem ? (
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div className="relative aspect-video overflow-hidden rounded bg-black">
                    {item.panel.imageUrl ? <MediaImageWithLoading src={item.panel.imageUrl} alt="首帧" containerClassName="h-full w-full" className="h-full w-full object-cover" sizes="180px" /> : null}
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">首帧</span>
                  </div>
                  <AppIcon name="arrowRight" className="h-4 w-4 text-stone-500" />
                  <div className="relative aspect-video overflow-hidden rounded bg-black">
                    {nextItem.panel.imageUrl ? <MediaImageWithLoading src={nextItem.panel.imageUrl} alt="尾帧" containerClassName="h-full w-full" className="h-full w-full object-cover" sizes="180px" /> : null}
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">尾帧 · 镜头 {nextItem.number}</span>
                  </div>
                </div>
              ) : <p className="mt-3 text-xs text-stone-500">最后一个镜头没有可连接的下一镜头。</p>}
            </div>

            <label className="block text-xs font-semibold text-stone-500">
              首尾帧模型
              <select value={firstLastFrameFlow.flModel} onChange={(event) => firstLastFrameFlow.setFlModel(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]">
                {firstLastFrameFlow.flModelOptions.length === 0 ? <option value="">没有支持首尾帧的模型</option> : null}
                {firstLastFrameFlow.flModelOptions.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
              </select>
            </label>

            {firstLastFrameFlow.flCapabilityFields.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {firstLastFrameFlow.flCapabilityFields.map((field) => (
                  <label key={field.field} className="block text-xs font-semibold text-stone-500">
                    {field.label}
                    <select value={field.value === undefined ? '' : String(field.value)} onChange={(event) => firstLastFrameFlow.setFlCapabilityValue(field.field, event.target.value)} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm font-normal text-stone-100 outline-none focus:border-[#e8d18a]">
                      <option value="" disabled>请选择</option>
                      {field.options.map((option) => (
                        <option key={String(option)} value={String(option)} disabled={field.disabledOptions?.includes(option)}>{String(option)}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}

            <label className="block text-xs font-semibold text-stone-500">
              首尾帧提示词
              <textarea value={firstLastPrompt} onChange={(event) => firstLastFrameFlow.setFlCustomPrompt(panelKey, event.target.value)} onBlur={() => { void saveFirstLastPrompt() }} rows={6} className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" placeholder="描述首帧如何自然变化到尾帧。" />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-stone-500">{savingPrompt ? '提示词保存中' : mode === 'firstlastframe' && !linked ? '连接下一镜头后可生成' : '生成参数已就绪'}</span>
          <div className="flex gap-2">
            <StudioButton size="sm" variant="secondary" onClick={() => { void (mode === 'normal' ? saveNormalPrompt() : saveFirstLastPrompt()) }} disabled={savingPrompt}>保存提示词</StudioButton>
            <StudioButton size="sm" icon="video" loading={generating || !!item.panel.videoTaskRunning} onClick={() => { void generate() }} disabled={mode === 'normal' ? !item.panel.imageUrl : missingFirstLastFrameSetup}>
              {videoUrl ? '重新生成' : mode === 'firstlastframe' ? '生成首尾帧视频' : '生成单图视频'}
            </StudioButton>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default function StudioProduceCanvas({ model, onNavigate }: StudioProduceCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const { projectId } = useWorkspaceProvider()
  const { storyboards } = useWorkspaceEpisodeStageData()
  const updatePanelLinkMutation = useUpdateProjectPanelLink(projectId)
  const [selectedId, setSelectedId] = useState('')
  const [showVoiceWorkbench, setShowVoiceWorkbench] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [linkSavingKey, setLinkSavingKey] = useState('')
  const items = useMemo(() => buildProduceItems(storyboards), [storyboards])
  const videoPanels = useMemo(() => toVideoPanels(items), [items])
  const persistedLinks = useMemo(() => new Map(items.map((item) => [`${item.storyboard.id}-${item.panel.panelIndex}`, panelLinkedToNext(item.panel)])), [items])
  const [linkedPanels, setLinkedPanels] = useState<Map<string, boolean>>(persistedLinks)
  const selectedIndex = items.findIndex((item) => item.id === selectedId)
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : items[0] || null
  const effectiveSelectedIndex = selectedItem ? items.findIndex((item) => item.id === selectedItem.id) : -1
  const nextItem = effectiveSelectedIndex >= 0 && effectiveSelectedIndex < items.length - 1 ? items[effectiveSelectedIndex + 1] : null
  const videoModel = runtime.videoModel || runtime.userVideoModels[0]?.value || ''
  const firstLastFrameFlow = useVideoFirstLastFrameFlow({
    allPanels: videoPanels,
    linkedPanels,
    videoModelOptions: runtime.userVideoModels,
    onGenerateVideo: runtime.onGenerateVideo,
    t: (key) => key === 'firstLastFrame.thenTransitionTo' ? '然后自然过渡到' : key,
  })

  useEffect(() => {
    setLinkedPanels(persistedLinks)
  }, [persistedLinks])

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) setSelectedId(selectedItem.id)
  }, [selectedId, selectedItem])

  const toggleLink = async (item: ProduceItem) => {
    const key = `${item.storyboard.id}-${item.panel.panelIndex}`
    const previous = linkedPanels.get(key) || false
    const next = !previous
    setLinkSavingKey(key)
    setLinkedPanels((current) => new Map(current).set(key, next))
    try {
      await updatePanelLinkMutation.mutateAsync({ storyboardId: item.storyboard.id, panelIndex: item.panel.panelIndex, linked: next })
    } catch (error) {
      setLinkedPanels((current) => new Map(current).set(key, previous))
      window.alert(error instanceof Error ? error.message : '保存镜头连接失败')
    } finally {
      setLinkSavingKey('')
    }
  }

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

  if (items.length === 0 || model.productionItems.length === 0) return <EmptyProduce onNavigate={onNavigate} />

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151613]">
        <StudioStageHeader
          eyebrow="视频制作"
          title="镜头视频控制台"
          description="逐镜头选择单图或首尾帧模式，配置提示词、模型和连接关系，并跟进视频与配音状态。"
          actions={<StudioButton icon="video" loading={generatingAll} onClick={() => { void generateAll() }} disabled={runtime.isTransitioning}>批量生成单图视频</StudioButton>}
        />

        <div className="grid gap-4 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
          <StudioMetric label="镜头" value={items.length} />
          <StudioMetric label="图片完成" value={items.filter((item) => item.panel.imageUrl).length} />
          <StudioMetric label="视频完成" value={items.filter((item) => panelVideoUrl(item.panel)).length} />
          <StudioMetric label="首尾帧连接" value={[...linkedPanels.values()].filter(Boolean).length} />
        </div>

        <div className="grid min-h-[620px] gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-[#10110f]">
            <div className="border-b border-white/10 px-4 py-4"><StudioSectionHeader title="镜头队列" description="按执行顺序查看图片、视频、配音和首尾帧连接状态。" /></div>
            <div className="space-y-3 p-3">
              {items.map((item) => {
                const key = `${item.storyboard.id}-${item.panel.panelIndex}`
                return <StudioProduceQueueRow key={item.id} item={item} linked={linkedPanels.get(key) || false} selected={selectedItem?.id === item.id} onSelect={() => setSelectedId(item.id)} />
              })}
            </div>
          </div>
          {selectedItem ? (
            <ProductionDetailPanel
              item={selectedItem}
              nextItem={nextItem}
              linked={linkedPanels.get(`${selectedItem.storyboard.id}-${selectedItem.panel.panelIndex}`) || false}
              linkSaving={linkSavingKey === `${selectedItem.storyboard.id}-${selectedItem.panel.panelIndex}`}
              onToggleLink={() => toggleLink(selectedItem)}
              firstLastFrameFlow={firstLastFrameFlow}
            />
          ) : null}
        </div>
      </section>

      <StudioPanel padding="none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <StudioSectionHeader title="配音与口型" description="在独立工作台中处理说话人音色、台词音频和口型同步。" />
          <StudioButton size="sm" variant="secondary" icon={showVoiceWorkbench ? 'chevronUp' : 'mic'} onClick={() => setShowVoiceWorkbench((value) => !value)}>{showVoiceWorkbench ? '收起配音工作台' : '打开配音工作台'}</StudioButton>
        </div>
        {showVoiceWorkbench ? (
          <div className="bg-[#10110f] p-4 text-stone-100"><VoiceStageRoute embedded /></div>
        ) : (
          <div className="grid gap-3 px-5 py-5 md:grid-cols-3">
            <StudioMetric label="工作范围" value="音色、台词、口型" />
            <StudioMetric label="进入方式" value="按需打开" helper="不与视频队列重复展示" />
            <StudioMetric label="输出" value="音频与口型视频" />
          </div>
        )}
      </StudioPanel>
    </div>
  )
}

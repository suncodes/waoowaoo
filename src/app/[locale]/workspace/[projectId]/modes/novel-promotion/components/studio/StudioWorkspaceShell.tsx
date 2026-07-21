'use client'

import { useMemo, useState } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { VIDEO_PROFILE_PRESET, type VideoProfile } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import type { WorkspaceRunStreamState } from '../workspace-run-types'
import type { CreationTaskDescriptor } from '../workspace-v2/CreationTaskDetails'
import {
  hasRenderableTaskDetails,
  StudioGenerationQueue,
  StudioTaskDetailsModal,
} from './StudioGenerationQueue'
import { studioStatusDotClass } from './StudioPrimitives'
import StudioStageCanvas from './StudioStageCanvas'
import {
  statusFromCreationStage,
  type StudioModeId,
  type StudioNavItem,
  type StudioProductStatus,
  type StudioWorkspaceModel,
} from './studio-types'
import { useStudioWorkspaceModel } from './useStudioWorkspaceModel'

interface StudioEpisodeOption {
  id: string
  name: string
  episodeNumber?: number
}

interface StudioWorkspaceShellProps {
  projectName: string
  episodes: StudioEpisodeOption[]
  currentEpisodeId?: string
  currentStage: string
  stageView?: string | null
  videoProfile: VideoProfile
  workflowState: CreationWorkflowState
  contentPlanStream: WorkspaceRunStreamState
  storyToScriptStream: WorkspaceRunStreamState
  visualPlanStream: WorkspaceRunStreamState
  scriptToStoryboardStream: WorkspaceRunStreamState
  onStageChange: (stage: string) => void
  onEpisodeSelect?: (episodeId: string) => void
  onEpisodeCreate?: () => void
  onOpenAssetLibrary: () => void
  onOpenSettings: () => void
  onRefresh: () => Promise<void> | void
}

const MODE_CONFIG: Array<Omit<StudioNavItem, 'status' | 'disabled'>> = [
  { id: 'start', route: 'config', label: '项目简报', subtitle: '输入', icon: 'fileText' },
  { id: 'draft', route: 'content', label: '文稿', subtitle: '脚本', icon: 'bookOpen' },
  { id: 'visual-kit', route: 'assets', label: '视觉库', subtitle: '角色场景', icon: 'folderCards' },
  { id: 'board', route: 'storyboard', label: '分镜板', subtitle: '镜头', icon: 'image' },
  { id: 'produce', route: 'videos', label: '生产台', subtitle: '视频配音', icon: 'video' },
  { id: 'edit', route: 'editor', label: '成片检查', subtitle: '预览', icon: 'film' },
  { id: 'export', route: 'export', label: '交付', subtitle: '导出', icon: 'download' },
]

function navStatus(mode: StudioModeId, model: StudioWorkspaceModel): StudioProductStatus {
  if (mode === 'start') return model.novelText.trim() ? 'locked' : 'drafting'
  if (mode === 'draft') return statusFromCreationStage(model.workflow.stageStatuses.content || 'not_started')
  if (mode === 'visual-kit') return statusFromCreationStage(model.workflow.stageStatuses['visual-design'] || 'not_started')
  if (mode === 'board') return statusFromCreationStage(model.workflow.stageStatuses['storyboard-preview'] || 'not_started')
  if (mode === 'produce') return statusFromCreationStage(model.workflow.stageStatuses.production || 'not_started')
  if (mode === 'edit') return model.workflow.hasVideo ? 'drafting' : 'empty'
  return model.workflow.hasVideo ? 'needs_review' : 'empty'
}

function progressWeight(status: StudioProductStatus) {
  if (status === 'locked') return 1
  if (status === 'generating') return 0.7
  if (status === 'drafting' || status === 'needs_review' || status === 'stale') return 0.45
  return 0
}

function StudioTopBar({
  projectName,
  episodes,
  currentEpisodeId,
  videoProfile,
  activeItem,
  progressPercent,
  taskDetailsAvailable,
  onEpisodeSelect,
  onEpisodeCreate,
  onOpenAssetLibrary,
  onOpenSettings,
  onRefresh,
  onOpenTaskDetails,
}: Pick<StudioWorkspaceShellProps,
  | 'projectName'
  | 'episodes'
  | 'currentEpisodeId'
  | 'videoProfile'
  | 'onEpisodeSelect'
  | 'onEpisodeCreate'
  | 'onOpenAssetLibrary'
  | 'onOpenSettings'
  | 'onRefresh'
> & {
  activeItem: StudioNavItem
  progressPercent: number
  taskDetailsAvailable: boolean
  onOpenTaskDetails: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const currentEpisode = episodes.find((episode) => episode.id === currentEpisodeId)
  const profileLabel = videoProfile.preset === VIDEO_PROFILE_PRESET.BOOK_GUIDE ? '书籍导读' : 'AI 漫剧'
  const durationText = videoProfile.targetDurationSec > 0 ? `${Math.round(videoProfile.targetDurationSec / 60)} 分钟` : '未限定'
  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.resolve(onRefresh())
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <header className="overflow-hidden rounded-lg border border-white/10 bg-[#0b0c0a]/95 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[#e8d18a]/25 bg-[#e8d18a]/10 text-[#f3e9cf] sm:flex">
            <AppIcon name="clapperboard" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-lg font-semibold text-stone-50">{projectName}</h1>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-stone-400">
                {profileLabel} · {durationText}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
              <span className="truncate">{currentEpisode?.name || '未选择剧集'}</span>
              <span className="hidden text-stone-700 sm:inline">/</span>
              <span className="inline-flex items-center gap-1.5 text-stone-300">
                <span className={`h-1.5 w-1.5 rounded-full ${studioStatusDotClass(activeItem.status)}`} />
                {activeItem.label}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 lg:justify-end">
          {episodes.length > 0 ? (
            <select
              value={currentEpisodeId || ''}
              onChange={(event) => onEpisodeSelect?.(event.target.value)}
              className="h-9 max-w-[240px] rounded-md border border-white/10 bg-[#12130f] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
              aria-label="选择剧集"
            >
              {episodes.map((episode) => (
                <option key={episode.id} value={episode.id}>{episode.name}</option>
              ))}
            </select>
          ) : null}
          <IconButton icon="receipt" label="生成日志" onClick={onOpenTaskDetails} disabled={!taskDetailsAvailable} />
          <IconButton icon="plus" label="新建剧集" onClick={onEpisodeCreate} />
          <IconButton icon="folderOpen" label="资产库" onClick={onOpenAssetLibrary} />
          <IconButton icon="settingsHexMinor" label="设置" onClick={onOpenSettings} />
          <IconButton icon="refresh" label="刷新" onClick={() => { void refresh() }} spinning={refreshing} />
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-3 lg:px-5">
        <div className="flex items-center justify-between gap-4 text-xs text-stone-500">
          <span>制作进度</span>
          <span>{progressPercent}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#e8d18a] transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    </header>
  )
}

function IconButton({
  icon,
  label,
  onClick,
  spinning,
  disabled,
}: {
  icon: AppIconName
  label: string
  onClick?: () => void
  spinning?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-stone-200 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/[0.04]"
    >
      <AppIcon name={icon} className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} />
    </button>
  )
}

function StudioNav({
  items,
  activeMode,
  onNavigate,
}: {
  items: StudioNavItem[]
  activeMode: StudioModeId
  onNavigate: (route: string) => void
}) {
  return (
    <nav aria-label="制作流程" className="overflow-hidden rounded-lg border border-white/10 bg-[#0b0c0a]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <span className="text-xs font-semibold text-stone-500">流程导航</span>
        <AppIcon name="barChart" className="h-4 w-4 text-stone-600" />
      </div>
      <ol className="flex gap-1 overflow-x-auto p-2 lg:grid lg:grid-cols-1 lg:gap-1.5 lg:overflow-visible">
        {items.map((item, index) => {
          const active = item.id === activeMode
          return (
            <li key={item.id} className="min-w-[154px] lg:min-w-0">
              <button
                type="button"
                onClick={() => onNavigate(item.route)}
                className={`grid w-full grid-cols-[34px_minmax(0,1fr)_16px] items-center gap-3 rounded-lg border px-2.5 py-2.5 text-left transition-colors ${active
                  ? 'border-[#e8d18a]/45 bg-[#e8d18a]/10 text-stone-50'
                  : 'border-transparent text-stone-300 hover:border-white/10 hover:bg-white/[0.05]'
                }`}
              >
                <span className={`relative flex h-8 w-8 items-center justify-center rounded-md ${active ? 'bg-[#f3e9cf] text-[#15130f]' : 'bg-white/[0.06] text-stone-400'}`}>
                  <AppIcon name={item.icon} className="h-4 w-4" />
                  <span className="absolute -right-1 -top-1 rounded bg-[#0b0c0a] px-1 text-[9px] leading-4 text-stone-500">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-stone-500">
                    {item.subtitle}
                  </span>
                </span>
                <span className={`h-2 w-2 rounded-full ${studioStatusDotClass(item.status)}`} />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function StructurePanel({ model, onNavigate }: { model: StudioWorkspaceModel; onNavigate: (route: string) => void }) {
  const rows = [
    { label: '文稿段落', value: model.draftSegments.length, route: 'content' },
    { label: '核心资产', value: model.coreVisualAssets.length, route: 'assets' },
    { label: '分镜镜头', value: model.shots.length, route: 'storyboard' },
    { label: '已完成视频', value: model.summary.completedVideos, route: 'videos' },
  ]
  return (
    <aside className="space-y-3 rounded-lg border border-white/10 bg-[#0f100d] p-4">
      <div>
        <h2 className="text-sm font-semibold text-stone-50">作品账本</h2>
        <p className="mt-1 text-xs leading-5 text-stone-500">文稿、资产、镜头和视频的当前数量。</p>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.label}
            type="button"
            onClick={() => onNavigate(row.route)}
            className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-sm hover:bg-white/[0.06]"
          >
            <span className="text-stone-400">{row.label}</span>
            <span className="font-semibold text-stone-100">{row.value}</span>
          </button>
        ))}
      </div>
      {model.novelText ? (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="text-xs font-semibold text-stone-400">原始材料</div>
          <p className="mt-2 line-clamp-5 text-xs leading-5 text-stone-500">{model.novelText}</p>
        </div>
      ) : null}
    </aside>
  )
}

function AssistantPanel({
  model,
  onNavigate,
  onOpenTaskDetails,
  taskDetailsAvailable,
}: {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
  onOpenTaskDetails: () => void
  taskDetailsAvailable: boolean
}) {
  const runtime = useWorkspaceStageRuntime()
  const activeAsset = model.coreVisualAssets.find((asset) => asset.status !== 'locked') || model.coreVisualAssets[0]
  const activeShot = model.shots.find((shot) => shot.status === 'failed') || model.shots.find((shot) => !shot.videoUrl) || model.shots[0]
  const modeTitle = {
    start: '项目简报',
    draft: '文稿状态',
    'visual-kit': '视觉资产',
    board: '镜头状态',
    produce: '生产状态',
    edit: '成片检查',
    export: '交付状态',
  }[model.activeMode]
  const suggestions = model.activeMode === 'visual-kit'
    ? [`核心资产待确认：${model.summary.missingCoreVisualAssets}`, activeAsset ? `当前资产：${activeAsset.name}` : '暂无核心资产']
    : model.activeMode === 'board' || model.activeMode === 'produce'
      ? [activeShot ? `当前镜头：第 ${activeShot.number} 镜` : '暂无镜头', `失败镜头：${model.summary.failedShots}`]
      : [`文稿段落：${model.draftSegments.length}`, `预计时长：${model.summary.totalDurationSec || '-'} 秒`]

  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-[#0b0c0a]">
      <header className="border-b border-white/10 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8a85f]">Operator</p>
        <h2 className="mt-2 text-base font-semibold text-stone-50">{modeTitle}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <h3 className="text-xs font-semibold text-stone-500">当前对象</h3>
          <div className="mt-2 space-y-2">
            {suggestions.map((item) => (
              <div key={item} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-stone-300">{item}</div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-xs font-semibold text-stone-500">上下文动作</h3>
          <div className="mt-2 grid gap-2">
            {model.activeMode === 'draft' ? (
              <ActionButton icon="sparkles" label="重写当前段落" onClick={() => onNavigate('script')} />
            ) : null}
            {model.activeMode === 'visual-kit' ? (
              <ActionButton icon="folderOpen" label="打开资产库" onClick={runtime.onOpenAssetLibrary} />
            ) : null}
            {model.activeMode === 'board' ? (
              <ActionButton icon="sparkles" label="重新生成分镜" onClick={() => { void runtime.onRunScriptToStoryboard() }} />
            ) : null}
            {model.activeMode === 'produce' ? (
              <ActionButton icon="video" label="批量生成视频" onClick={() => {
                const videoModel = runtime.videoModel || runtime.userVideoModels[0]?.value
                if (!videoModel) {
                  window.alert('请先在设置中配置视频模型。')
                  return
                }
                void runtime.onGenerateAllVideos({ videoModel })
              }} />
            ) : null}
            <ActionButton
              icon="receipt"
              label={taskDetailsAvailable ? '查看生成日志' : '暂无生成日志'}
              onClick={onOpenTaskDetails}
              disabled={!taskDetailsAvailable}
            />
          </div>
        </section>
      </div>
    </aside>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: AppIconName
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm font-medium text-stone-200 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white/[0.03]"
    >
      <AppIcon name={icon} className="h-4 w-4 text-[#e8d18a]" />
      {label}
    </button>
  )
}

export default function StudioWorkspaceShell({
  projectName,
  episodes,
  currentEpisodeId,
  currentStage,
  stageView,
  videoProfile,
  workflowState,
  contentPlanStream,
  storyToScriptStream,
  visualPlanStream,
  scriptToStoryboardStream,
  onStageChange,
  onEpisodeSelect,
  onEpisodeCreate,
  onOpenAssetLibrary,
  onOpenSettings,
  onRefresh,
}: StudioWorkspaceShellProps) {
  const model = useStudioWorkspaceModel({
    currentStage,
    stageView,
    workflowState,
    contentPlanStream,
    storyToScriptStream,
    visualPlanStream,
    scriptToStoryboardStream,
  })
  const navItems = useMemo<StudioNavItem[]>(
    () => MODE_CONFIG.map((item) => ({ ...item, status: navStatus(item.id, model) })),
    [model],
  )
  const activeItem = navItems.find((item) => item.id === model.activeMode) || navItems[0]
  const progressPercent = Math.round((navItems.reduce((sum, item) => sum + progressWeight(item.status), 0) / navItems.length) * 100)
  const taskDescriptors = useMemo<CreationTaskDescriptor[]>(() => [
    { id: 'content-plan', label: '文稿规划', stream: contentPlanStream },
    { id: 'story-script', label: '剧本生成', stream: storyToScriptStream },
    { id: 'visual-plan', label: '视觉方案', stream: visualPlanStream },
    { id: 'storyboard', label: '分镜生成', stream: scriptToStoryboardStream },
  ], [contentPlanStream, scriptToStoryboardStream, storyToScriptStream, visualPlanStream])
  const [taskDetailId, setTaskDetailId] = useState<string | null>(null)
  const renderableTaskDescriptors = useMemo(
    () => taskDescriptors.filter(hasRenderableTaskDetails),
    [taskDescriptors],
  )
  const orderedTaskDetailDescriptors = useMemo(() => {
    if (!taskDetailId) return renderableTaskDescriptors
    const selected = renderableTaskDescriptors.find((descriptor) => descriptor.id === taskDetailId)
    if (!selected) return renderableTaskDescriptors
    return [
      selected,
      ...renderableTaskDescriptors.filter((descriptor) => descriptor.id !== selected.id),
    ]
  }, [renderableTaskDescriptors, taskDetailId])
  const openTaskDetails = (taskId?: string) => {
    if (renderableTaskDescriptors.length === 0) return
    setTaskDetailId(taskId || renderableTaskDescriptors[0]?.id || null)
  }

  return (
    <section className="mx-auto flex w-full max-w-[1840px] flex-col gap-4 text-stone-100">
      <StudioTopBar
        projectName={projectName}
        episodes={episodes}
        currentEpisodeId={currentEpisodeId}
        videoProfile={videoProfile}
        activeItem={activeItem}
        progressPercent={progressPercent}
        taskDetailsAvailable={renderableTaskDescriptors.length > 0}
        onEpisodeSelect={onEpisodeSelect}
        onEpisodeCreate={onEpisodeCreate}
        onOpenAssetLibrary={onOpenAssetLibrary}
        onOpenSettings={onOpenSettings}
        onRefresh={onRefresh}
        onOpenTaskDetails={() => openTaskDetails()}
      />
      <div className="grid min-h-[calc(100vh-12rem)] gap-4 lg:grid-cols-[236px_minmax(0,1fr)_312px]">
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <StudioNav items={navItems} activeMode={model.activeMode} onNavigate={onStageChange} />
          <StructurePanel model={model} onNavigate={onStageChange} />
        </div>
        <main id="workspace-stage-content" className="min-w-0">
          <StudioStageCanvas model={model} onNavigate={onStageChange} workflowState={workflowState} />
        </main>
        <div className="min-h-0 lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)]">
          <AssistantPanel
            model={model}
            onNavigate={onStageChange}
            onOpenTaskDetails={() => openTaskDetails()}
            taskDetailsAvailable={renderableTaskDescriptors.length > 0}
          />
        </div>
      </div>
      <StudioGenerationQueue
        jobs={model.generationJobs}
        detailsAvailable={renderableTaskDescriptors.length > 0}
        onOpenDetails={openTaskDetails}
      />
      {taskDetailId && orderedTaskDetailDescriptors.length > 0 ? (
        <StudioTaskDetailsModal descriptors={orderedTaskDetailDescriptors} onClose={() => setTaskDetailId(null)} />
      ) : null}
    </section>
  )
}

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
  StudioTaskCenterModal,
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
  { id: 'overview', route: 'overview', label: '项目概览', subtitle: '状态与任务', icon: 'barChart' },
  { id: 'planning', route: 'config', label: '内容策划', subtitle: '输入与方案', icon: 'brain' },
  { id: 'draft', route: 'script', label: '成稿制作', subtitle: '剧本与导读稿', icon: 'bookOpen' },
  { id: 'visual-kit', route: 'assets', label: '视觉资产', subtitle: '角色场景道具', icon: 'folderCards' },
  { id: 'board', route: 'storyboard', label: '分镜制作', subtitle: '规划与画面', icon: 'image' },
  { id: 'narration', route: 'voice', label: '台词与声音', subtitle: '台词计划与音色', icon: 'mic' },
  { id: 'produce', route: 'videos', label: '视频制作', subtitle: '生成镜头视频', icon: 'video' },
  { id: 'edit', route: 'editor', label: '成片检查', subtitle: '预览', icon: 'film' },
  { id: 'export', route: 'export', label: '交付', subtitle: '导出', icon: 'download' },
  { id: 'audio', route: 'audio', label: '音频与字幕', subtitle: '待过期', icon: 'audioWave' },
]

function navStatus(mode: StudioModeId, model: StudioWorkspaceModel): StudioProductStatus {
  if (mode === 'overview') return 'drafting'
  if (mode === 'planning') return model.draftSegments.length > 0 ? 'locked' : model.novelText.trim() ? 'drafting' : 'empty'
  if (mode === 'draft') return statusFromCreationStage(model.workflow.stageStatuses.content || 'not_started')
  if (mode === 'narration') {
    if (!model.workflow.hasStoryboard) return 'empty'
    if (model.summary.voiceLines > 0 && model.summary.speechPlanInvalid === 0) return 'locked'
    if (model.summary.voiceLines > 0) return 'needs_review'
    return 'drafting'
  }
  if (mode === 'visual-kit') return statusFromCreationStage(model.workflow.stageStatuses['visual-design'] || 'not_started')
  if (mode === 'board') return model.workflow.storyboardGenerating
    ? 'generating'
    : statusFromCreationStage(model.workflow.stageStatuses['storyboard-preview'] || 'not_started')
  if (mode === 'produce') return statusFromCreationStage(model.workflow.stageStatuses.production || 'not_started')
  if (mode === 'audio') return model.workflow.hasVideo ? 'drafting' : 'empty'
  if (mode === 'edit') return model.workflow.hasVideo ? 'drafting' : 'empty'
  return model.workflow.hasVideo ? 'needs_review' : 'empty'
}

function StudioTopBar({
  projectName,
  episodes,
  currentEpisodeId,
  videoProfile,
  activeItem,
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
  onOpenTaskDetails: (taskId?: string) => void
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
          <IconButton icon="receipt" label="任务中心" onClick={onOpenTaskDetails} />
          <IconButton icon="plus" label="新建剧集" onClick={onEpisodeCreate} />
          <IconButton icon="folderOpen" label="项目资产" onClick={onOpenAssetLibrary} />
          <IconButton icon="settingsHexMinor" label="设置" onClick={onOpenSettings} />
          <IconButton icon="refresh" label="刷新" onClick={() => { void refresh() }} spinning={refreshing} />
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
                    {item.id === 'overview' ? 'OV' : String(index).padStart(2, '0')}
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

function AssistantPanel({
  model,
  onNavigate,
}: {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}) {
  const runtime = useWorkspaceStageRuntime()
  const activeAsset = model.coreVisualAssets.find((asset) => asset.status !== 'locked') || model.coreVisualAssets[0]
  const activeShot = model.shots.find((shot) => shot.status === 'failed') || model.shots.find((shot) => !shot.videoUrl) || model.shots[0]
  const modeTitle = {
    overview: '项目概览',
    planning: '内容策划',
    draft: model.workflow.isBookGuide ? '导读稿制作' : '剧本制作',
    narration: '台词与声音',
    'visual-kit': '视觉资产',
    board: '镜头状态',
    produce: '生产状态',
    audio: '音频与字幕',
    edit: '成片检查',
    export: '交付状态',
  }[model.activeMode]
  const suggestions = model.activeMode === 'visual-kit'
    ? [`核心资产待确认：${model.summary.missingCoreVisualAssets}`, activeAsset ? `当前资产：${activeAsset.name}` : '暂无核心资产']
    : model.activeMode === 'narration'
      ? [`台词：${model.summary.voiceLines}`, `异常计划：${model.summary.speechPlanInvalid}`]
    : model.activeMode === 'board' || model.activeMode === 'produce' || model.activeMode === 'audio'
      ? [activeShot ? `当前镜头：第 ${activeShot.number} 镜` : '暂无镜头', `失败镜头：${model.summary.failedShots}`]
      : [`内容段落：${model.draftSegments.length}`, `预计时长：${model.summary.totalDurationSec || '-'} 秒`]

  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-[#0b0c0a]">
      <header className="border-b border-white/10 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8a85f]">Operator</p>
        <h2 className="mt-2 text-base font-semibold text-stone-50">{modeTitle}</h2>
      </header>
      <div className="space-y-4 p-4">
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
              <ActionButton icon="edit" label={model.workflow.isBookGuide ? '打开导读稿编辑' : '打开剧本编辑'} onClick={() => onNavigate('script')} />
            ) : null}
            {model.activeMode === 'visual-kit' ? (
              <ActionButton icon="folderOpen" label="打开项目资产" onClick={runtime.onOpenAssetLibrary} />
            ) : null}
            {model.activeMode === 'narration' ? (
              <ActionButton icon="image" label="返回分镜制作" onClick={() => onNavigate('storyboard')} />
            ) : null}
            {model.activeMode === 'board' ? (
              <ActionButton
                icon="sparkles"
                label={runtime.isTransitioning ? '镜头规划处理中' : model.workflow.hasVisualPlan ? 'AI 重写镜头规划' : '生成镜头规划初稿'}
                onClick={() => { void runtime.onRunVisualPlan() }}
                disabled={runtime.isTransitioning}
              />
            ) : null}
            {model.activeMode === 'produce' ? (
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-5 text-stone-400">
                页面顶部提供“批量生成单图视频”和“批量生成首尾帧视频”两个入口，提交前都会先预检并二次确认。
              </div>
            ) : null}
            {model.activeMode === 'audio' ? (
              <ActionButton icon="video" label="返回视频制作" onClick={() => onNavigate('videos')} />
            ) : null}
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
  const runtime = useWorkspaceStageRuntime()
  const model = useStudioWorkspaceModel({
    currentStage,
    stageView,
    workflowState,
    contentPlanStream,
    storyToScriptStream,
    visualPlanStream,
    scriptToStoryboardStream,
    isAssetAnalysisRunning: runtime.isAssetAnalysisRunning,
  })
  const navItems = useMemo<StudioNavItem[]>(
    () => MODE_CONFIG.map((item) => ({ ...item, status: navStatus(item.id, model) })),
    [model],
  )
  const activeItem = navItems.find((item) => item.id === model.activeMode) || navItems[0]
  const incompleteShotCount = model.shots.filter((shot) => (
    !shot.imageUrl
    || shot.status === 'generating'
    || shot.status === 'failed'
    || shot.status === 'needs_review'
  )).length
  const productionReady = model.shots.length > 0 && incompleteShotCount === 0
  const navigate = (route: string) => {
    if (route === 'voice' && !model.workflow.hasStoryboard) {
      window.alert('请先完成分镜制作。台词与声音会基于已确认分镜分析台词并绑定镜头。')
      return
    }
    if (route === 'videos' && !productionReady) {
      window.alert(model.shots.length === 0
        ? '请先生成并确认分镜。'
        : `还有 ${incompleteShotCount} 个镜头缺少定稿图片、正在生成或生成失败，暂时不能进入生产台。`)
      return
    }
    onStageChange(route)
  }
  const taskDescriptors = useMemo<CreationTaskDescriptor[]>(() => [
    { id: 'content-plan', label: '内容方案生成', stream: contentPlanStream },
    { id: 'story-script', label: model.workflow.isBookGuide ? '导读稿生成' : '剧本生成', stream: storyToScriptStream },
    { id: 'visual-plan', label: '视觉方案与镜头规划初稿', stream: visualPlanStream },
    { id: 'storyboard', label: '镜头规划生成', stream: scriptToStoryboardStream },
  ], [contentPlanStream, model.workflow.isBookGuide, scriptToStoryboardStream, storyToScriptStream, visualPlanStream])
  const [taskDetailId, setTaskDetailId] = useState<string | null>(null)
  const [taskCenterOpen, setTaskCenterOpen] = useState(false)
  const renderableTaskDescriptors = useMemo(
    () => taskDescriptors.filter(hasRenderableTaskDetails),
    [taskDescriptors],
  )
  const openTaskDetails = (taskId?: string) => {
    setTaskDetailId(taskId || renderableTaskDescriptors[0]?.id || model.generationJobs[0]?.id || null)
    setTaskCenterOpen(true)
  }

  return (
    <section className="mx-auto flex w-full max-w-[1840px] flex-col gap-4 text-stone-100">
      <StudioTopBar
        projectName={projectName}
        episodes={episodes}
        currentEpisodeId={currentEpisodeId}
        videoProfile={videoProfile}
        activeItem={activeItem}
        onEpisodeSelect={onEpisodeSelect}
        onEpisodeCreate={onEpisodeCreate}
        onOpenAssetLibrary={onOpenAssetLibrary}
        onOpenSettings={onOpenSettings}
        onRefresh={onRefresh}
        onOpenTaskDetails={() => openTaskDetails()}
      />
      <div className="grid min-h-[calc(100vh-12rem)] gap-4 lg:grid-cols-[236px_minmax(0,1fr)_312px]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <StudioNav items={navItems} activeMode={model.activeMode} onNavigate={navigate} />
        </div>
        <main id="workspace-stage-content" className="min-w-0">
          <StudioStageCanvas model={model} onNavigate={navigate} workflowState={workflowState} />
        </main>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <AssistantPanel
            model={model}
            onNavigate={navigate}
          />
        </div>
      </div>
      {taskCenterOpen ? (
        <StudioTaskCenterModal
          jobs={model.generationJobs}
          descriptors={renderableTaskDescriptors}
          initialTaskId={taskDetailId}
          onClose={() => {
            setTaskCenterOpen(false)
            setTaskDetailId(null)
          }}
        />
      ) : null}
    </section>
  )
}

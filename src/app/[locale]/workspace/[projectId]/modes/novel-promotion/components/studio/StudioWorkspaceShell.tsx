'use client'

import { useMemo, useState } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { CreationWorkflowRunState, CreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import type { VideoProfile } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import StudioStageCanvas from './StudioStageCanvas'
import {
  statusFromCreationStage,
  statusLabel,
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
  contentPlanStream: CreationWorkflowRunState
  storyToScriptStream: CreationWorkflowRunState
  visualPlanStream: CreationWorkflowRunState
  scriptToStoryboardStream: CreationWorkflowRunState
  onStageChange: (stage: string) => void
  onEpisodeSelect?: (episodeId: string) => void
  onEpisodeCreate?: () => void
  onOpenAssetLibrary: () => void
  onOpenSettings: () => void
  onRefresh: () => Promise<void> | void
}

const MODE_CONFIG: Array<Omit<StudioNavItem, 'status' | 'disabled'>> = [
  { id: 'start', route: 'config', label: 'Start', subtitle: '起始', icon: 'fileText' },
  { id: 'draft', route: 'content', label: 'Draft', subtitle: '草稿', icon: 'bookOpen' },
  { id: 'visual-kit', route: 'assets', label: 'Visual Kit', subtitle: '视觉资产', icon: 'folderCards' },
  { id: 'board', route: 'storyboard', label: 'Board', subtitle: '分镜', icon: 'image' },
  { id: 'produce', route: 'videos', label: 'Produce', subtitle: '制作', icon: 'video' },
  { id: 'edit', route: 'editor', label: 'Edit', subtitle: '成片', icon: 'film' },
  { id: 'export', route: 'export', label: 'Export', subtitle: '导出', icon: 'download' },
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

function dotClass(status: StudioProductStatus) {
  if (status === 'locked') return 'bg-emerald-400'
  if (status === 'generating') return 'bg-cyan-300'
  if (status === 'failed') return 'bg-rose-300'
  if (status === 'stale' || status === 'needs_review') return 'bg-amber-300'
  if (status === 'drafting') return 'bg-stone-300'
  return 'bg-stone-700'
}

function StatusPill({ status }: { status: StudioProductStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-stone-300">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass(status)}`} />
      {statusLabel(status)}
    </span>
  )
}

function StudioTopBar({
  projectName,
  episodes,
  currentEpisodeId,
  onEpisodeSelect,
  onEpisodeCreate,
  onOpenAssetLibrary,
  onOpenSettings,
  onRefresh,
}: Pick<StudioWorkspaceShellProps,
  | 'projectName'
  | 'episodes'
  | 'currentEpisodeId'
  | 'onEpisodeSelect'
  | 'onEpisodeCreate'
  | 'onOpenAssetLibrary'
  | 'onOpenSettings'
  | 'onRefresh'
>) {
  const [refreshing, setRefreshing] = useState(false)
  const currentEpisode = episodes.find((episode) => episode.id === currentEpisodeId)
  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.resolve(onRefresh())
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#131410]/95 px-4 py-3 shadow-[0_16px_50px_rgba(0,0,0,0.25)]">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-stone-50">{projectName}</div>
        <div className="mt-0.5 text-xs text-stone-500">{currentEpisode?.name || '未选择剧集'}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {episodes.length > 0 ? (
          <select
            value={currentEpisodeId || ''}
            onChange={(event) => onEpisodeSelect?.(event.target.value)}
            className="h-9 max-w-[220px] rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
          >
            {episodes.map((episode) => (
              <option key={episode.id} value={episode.id}>{episode.name}</option>
            ))}
          </select>
        ) : null}
        <IconButton icon="plus" label="新建剧集" onClick={onEpisodeCreate} />
        <IconButton icon="folderOpen" label="资产库" onClick={onOpenAssetLibrary} />
        <IconButton icon="settingsHexMinor" label="设置" onClick={onOpenSettings} />
        <IconButton icon="refresh" label="刷新" onClick={() => { void refresh() }} spinning={refreshing} />
      </div>
    </header>
  )
}

function IconButton({
  icon,
  label,
  onClick,
  spinning,
}: {
  icon: AppIconName
  label: string
  onClick?: () => void
  spinning?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-stone-200 transition-colors hover:bg-white/[0.08]"
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
    <nav aria-label="Studio workflow" className="rounded-lg border border-white/10 bg-[#131410] p-2">
      <ol className="flex gap-1 overflow-x-auto lg:grid lg:grid-cols-1 lg:overflow-visible">
        {items.map((item) => {
          const active = item.id === activeMode
          return (
            <li key={item.id} className="min-w-[132px] lg:min-w-0">
              <button
                type="button"
                onClick={() => onNavigate(item.route)}
                className={`grid w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-3 rounded-md px-3 py-3 text-left transition-colors ${active
                  ? 'bg-[#f3e9cf] text-[#15130f]'
                  : 'text-stone-300 hover:bg-white/[0.06]'
                }`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded ${active ? 'bg-black/10' : 'bg-white/[0.06]'}`}>
                  <AppIcon name={item.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{item.label}</span>
                  <span className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${active ? 'text-[#4c4637]' : 'text-stone-500'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${dotClass(item.status)}`} />
                    {item.subtitle}
                  </span>
                </span>
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
    <aside className="space-y-3 rounded-lg border border-white/10 bg-[#131410] p-4">
      <div>
        <h2 className="text-sm font-semibold text-stone-50">素材与结构</h2>
        <p className="mt-1 text-xs leading-5 text-stone-500">围绕作品对象导航，不展示内部任务阶段。</p>
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
        <div className="rounded-md bg-white/[0.03] p-3">
          <div className="text-xs font-semibold text-stone-400">原始材料</div>
          <p className="mt-2 line-clamp-5 text-xs leading-5 text-stone-500">{model.novelText}</p>
        </div>
      ) : null}
    </aside>
  )
}

function InspectorPanel({ model, onNavigate }: { model: StudioWorkspaceModel; onNavigate: (route: string) => void }) {
  const runtime = useWorkspaceStageRuntime()
  const activeAsset = model.coreVisualAssets.find((asset) => asset.status !== 'locked') || model.coreVisualAssets[0]
  const activeShot = model.shots.find((shot) => shot.status === 'failed') || model.shots.find((shot) => !shot.videoUrl) || model.shots[0]
  const modeTitle = {
    start: '项目起始',
    draft: '文稿 Inspector',
    'visual-kit': '资产 Inspector',
    board: '镜头 Inspector',
    produce: '生产 Inspector',
    edit: '成片 Inspector',
    export: '导出 Inspector',
  }[model.activeMode]
  const suggestions = model.activeMode === 'visual-kit'
    ? [`核心资产待确认：${model.summary.missingCoreVisualAssets}`, activeAsset ? `当前资产：${activeAsset.name}` : '暂无核心资产']
    : model.activeMode === 'board' || model.activeMode === 'produce'
      ? [activeShot ? `当前镜头：Shot ${activeShot.number}` : '暂无镜头', `失败镜头：${model.summary.failedShots}`]
      : [`文稿段落：${model.draftSegments.length}`, `预计时长：${model.summary.totalDurationSec || '-'} 秒`]

  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-[#131410]">
      <header className="border-b border-white/10 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8a85f]">AI / Inspector</p>
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
            <ActionButton icon="receipt" label="查看生成日志" onClick={() => onNavigate(model.generationJobs.length ? model.activeMode === 'visual-kit' ? 'visual-plan' : 'content' : 'config')} />
          </div>
        </section>
      </div>
    </aside>
  )
}

function ActionButton({ icon, label, onClick }: { icon: AppIconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm font-medium text-stone-200 transition-colors hover:bg-white/[0.07]"
    >
      <AppIcon name={icon} className="h-4 w-4 text-[#e8d18a]" />
      {label}
    </button>
  )
}

function GenerationQueue({ model }: { model: StudioWorkspaceModel }) {
  const jobs = model.generationJobs
  if (jobs.length === 0) {
    return (
      <footer className="rounded-lg border border-white/10 bg-[#131410] px-4 py-3 text-sm text-stone-500">
        生成队列空闲
      </footer>
    )
  }
  return (
    <footer className="rounded-lg border border-white/10 bg-[#131410] px-4 py-3">
      <div className="flex gap-3 overflow-x-auto">
        {jobs.map((job) => (
          <div key={job.id} className="min-w-[240px] rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-stone-100">{job.label}</span>
              <StatusPill status={job.status} />
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[#e8d18a]" style={{ width: `${Math.max(job.progress, job.status === 'generating' ? 8 : 0)}%` }} />
            </div>
            <p className="mt-2 truncate text-xs text-stone-500">{job.message || `${job.progress}%`}</p>
          </div>
        ))}
      </div>
    </footer>
  )
}

export default function StudioWorkspaceShell({
  projectName,
  episodes,
  currentEpisodeId,
  currentStage,
  stageView,
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

  return (
    <section className="mx-auto flex w-full max-w-[1840px] flex-col gap-4 text-stone-100">
      <StudioTopBar
        projectName={projectName}
        episodes={episodes}
        currentEpisodeId={currentEpisodeId}
        onEpisodeSelect={onEpisodeSelect}
        onEpisodeCreate={onEpisodeCreate}
        onOpenAssetLibrary={onOpenAssetLibrary}
        onOpenSettings={onOpenSettings}
        onRefresh={onRefresh}
      />
      <div className="grid min-h-[calc(100vh-11rem)] gap-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <StudioNav items={navItems} activeMode={model.activeMode} onNavigate={onStageChange} />
          <StructurePanel model={model} onNavigate={onStageChange} />
        </div>
        <main id="workspace-stage-content" className="min-w-0">
          <StudioStageCanvas model={model} onNavigate={onStageChange} workflowState={workflowState} />
        </main>
        <div className="min-h-0 lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)]">
          <InspectorPanel model={model} onNavigate={onStageChange} />
        </div>
      </div>
      <GenerationQueue model={model} />
    </section>
  )
}

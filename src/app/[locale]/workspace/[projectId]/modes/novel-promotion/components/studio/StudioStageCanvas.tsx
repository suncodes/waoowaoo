'use client'

import Image from 'next/image'
import { useEffect, useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { VIDEO_PROFILE_PRESET } from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { statusLabel, type StudioProductStatus, type StudioVisualAsset, type StudioWorkspaceModel } from './studio-types'

interface StudioStageCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

function statusClass(status: StudioProductStatus) {
  if (status === 'locked') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'generating') return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'
  if (status === 'failed') return 'border-rose-400/30 bg-rose-400/10 text-rose-100'
  if (status === 'stale' || status === 'needs_review') return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  return 'border-white/10 bg-white/5 text-stone-300'
}

function StudioButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variant === 'primary'
        ? 'bg-[#f3e9cf] text-[#161512] hover:bg-[#fff5d9]'
        : 'border border-white/12 bg-white/[0.04] text-stone-100 hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  )
}

function EmptyCanvas({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[440px] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#151613] px-6 py-12 text-center">
      <AppIcon name="sparkles" className="h-8 w-8 text-[#e8d18a]" />
      <h2 className="mt-4 text-lg font-semibold text-stone-50">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function StartCanvas({ model }: { model: StudioWorkspaceModel }) {
  const runtime = useWorkspaceStageRuntime()
  const [text, setText] = useState(model.novelText)
  const [saving, setSaving] = useState(false)

  useEffect(() => setText(model.novelText), [model.novelText])

  const saveText = async () => {
    if (text === model.novelText) return
    setSaving(true)
    try {
      await runtime.onNovelTextChange(text)
    } finally {
      setSaving(false)
    }
  }

  const start = async () => {
    await saveText()
    await runtime.onRunStoryToScript()
  }

  return (
    <div className="grid min-h-[620px] grid-rows-[auto_1fr_auto] rounded-lg border border-white/10 bg-[#151613]">
      <header className="border-b border-white/10 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Start</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-50">创建一条可发布视频</h1>
        <p className="mt-2 text-sm leading-6 text-stone-400">粘贴故事、书稿、产品资料或链接，先生成视频方案和文稿初稿。</p>
      </header>
      <div className="grid min-h-0 gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => { void saveText() }}
          placeholder="输入原文、梗概或资料。"
          className="min-h-[420px] resize-none rounded-md border border-white/10 bg-[#0f100e] p-5 text-base leading-7 text-stone-100 outline-none transition-colors placeholder:text-stone-600 focus:border-[#e8d18a]"
        />
        <aside className="space-y-4">
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-stone-100">输出规格</div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-stone-500">画幅</dt><dd className="text-stone-200">{runtime.videoRatio || '默认'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-stone-500">类型</dt><dd className="text-stone-200">{runtime.videoProfile.preset === VIDEO_PROFILE_PRESET.BOOK_GUIDE ? '书籍导读' : 'AI 漫剧'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-stone-500">风格</dt><dd className="text-stone-200">{runtime.artStyle || '默认'}</dd></div>
            </dl>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-stone-400">
            第一版只要求足够启动，模型、并发、质量阈值继续放在设置里。
          </div>
        </aside>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
        <span className="text-xs text-stone-500">{saving ? '正在保存输入...' : `${text.trim().length} 字`}</span>
        <StudioButton onClick={() => { void start() }} disabled={!text.trim() || runtime.isTransitioning}>
          <AppIcon name={runtime.isTransitioning ? 'loader' : 'sparkles'} className={`h-4 w-4 ${runtime.isTransitioning ? 'animate-spin' : ''}`} />
          生成第一版视频方案
        </StudioButton>
      </footer>
    </div>
  )
}

function DraftCanvas({ model, onNavigate }: StudioStageCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const [pending, setPending] = useState(false)
  const confirmDraft = async () => {
    if (model.draftSegments.length === 0) {
      await runtime.onRunStoryToScript()
      return
    }
    setPending(true)
    try {
      if (!model.workflow.contentApproved) {
        await runtime.onApproveStage('content')
      }
      if (model.workflow.assetRequirementStatus !== 'approved') {
        await runtime.onAnalyzeAssets()
      }
      onNavigate('assets')
    } finally {
      setPending(false)
    }
  }

  if (model.draftSegments.length === 0) {
    return (
      <EmptyCanvas
        title="还没有视频文稿"
        description="先从 Start 生成文稿初稿，或补充原始材料后重新生成。"
        action={<StudioButton onClick={() => onNavigate('config')}>返回 Start</StudioButton>}
      />
    )
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#151613]">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Draft</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-50">{model.draftTitle}</h1>
          <p className="mt-2 text-sm text-stone-400">文稿是视频入口，每段都绑定时长、画面建议和锁定状态。</p>
        </div>
        <StudioButton onClick={() => { void confirmDraft() }} disabled={pending || runtime.isAssetAnalysisRunning}>
          <AppIcon name={pending || runtime.isAssetAnalysisRunning ? 'loader' : 'clipboardCheck'} className={`h-4 w-4 ${pending || runtime.isAssetAnalysisRunning ? 'animate-spin' : ''}`} />
          确认文稿并提取视觉资产
        </StudioButton>
      </header>
      <div className="divide-y divide-white/10">
        {model.draftSegments.map((segment, index) => (
          <article key={segment.id} className="grid gap-4 px-6 py-5 lg:grid-cols-[56px_minmax(0,1fr)_180px]">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/[0.06] text-sm font-semibold text-stone-200">{index + 1}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-stone-50">{segment.title}</h2>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(segment.status)}`}>{statusLabel(segment.status)}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-300">{segment.text}</p>
              {segment.visualHints.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {segment.visualHints.map((hint) => <span key={hint} className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-stone-400">{hint}</span>)}
                </div>
              ) : null}
            </div>
            <div className="flex flex-row items-center gap-2 lg:flex-col lg:items-stretch">
              <span className="rounded-md border border-white/10 px-3 py-2 text-center text-xs text-stone-400">{segment.durationSec || '-'} 秒</span>
              <StudioButton
                variant="secondary"
                onClick={() => { void runtime.onToggleContentLock(segment.id, !segment.locked) }}
              >
                <AppIcon name={segment.locked ? 'lock' : 'unlock'} className="h-4 w-4" />
                {segment.locked ? '已锁定' : '锁定'}
              </StudioButton>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function AssetTile({ asset }: { asset: StudioVisualAsset }) {
  return (
    <article className="rounded-md border border-white/10 bg-[#151613] p-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-[#0f100e]">
        {asset.imageUrl ? (
          <Image src={asset.imageUrl} alt={asset.name} fill sizes="260px" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-stone-600">
            <AppIcon name={asset.kind === 'character' ? 'user' : asset.kind === 'location' ? 'imageLandscape' : 'package'} className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-stone-50">{asset.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-400">{asset.description || '待补充标准描述'}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${statusClass(asset.status)}`}>{statusLabel(asset.status)}</span>
      </div>
    </article>
  )
}

function VisualKitCanvas({ model }: { model: StudioWorkspaceModel }) {
  const runtime = useWorkspaceStageRuntime()
  const [pending, setPending] = useState(false)
  const action = async () => {
    setPending(true)
    try {
      if (!model.workflow.hasVisualPlan) {
        await runtime.onRunVisualPlan()
      } else if (model.summary.missingCoreVisualAssets > 0) {
        runtime.onOpenAssetLibrary()
      } else if (!model.workflow.visualApproved) {
        await runtime.onApproveStage('visual-design')
      } else {
        await runtime.onRunScriptToStoryboard()
      }
    } finally {
      setPending(false)
    }
  }
  const primaryLabel = !model.workflow.hasVisualPlan
    ? '生成视觉资产清单'
    : model.summary.missingCoreVisualAssets > 0
      ? '完善核心资产'
      : model.workflow.visualApproved
        ? '生成分镜'
        : '确认视觉资产'

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-white/10 bg-[#151613] px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Visual Kit</p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-50">角色、场景、道具一致性</h1>
            <p className="mt-2 text-sm text-stone-400">核心资产必须先确认或显式处理，后续分镜只做绑定和镜头表达。</p>
          </div>
          <div className="flex gap-2">
            <StudioButton variant="secondary" onClick={runtime.onOpenAssetLibrary}><AppIcon name="folderOpen" className="h-4 w-4" />资产库</StudioButton>
            <StudioButton onClick={() => { void action() }} disabled={pending || runtime.isTransitioning}>
              <AppIcon name={pending || runtime.isTransitioning ? 'loader' : 'sparkles'} className={`h-4 w-4 ${pending || runtime.isTransitioning ? 'animate-spin' : ''}`} />
              {primaryLabel}
            </StudioButton>
          </div>
        </div>
      </section>
      {model.visualAssets.length === 0 ? (
        <EmptyCanvas title="还没有视觉资产清单" description="确认文稿后，先提取需要跨镜头一致的角色、场景和关键道具。" />
      ) : (
        <>
          <AssetSection title="核心资产" description="主角、反派、重复场景和关键道具。未确认时不进入正式图片/视频生成。" items={model.coreVisualAssets} />
          <AssetSection title="辅助资产" description="普通场景、次要物件和可自动处理的视觉元素。" items={model.supportingVisualAssets} />
        </>
      )}
    </div>
  )
}

function AssetSection({ title, description, items }: { title: string; description: string; items: StudioVisualAsset[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-stone-50">{title}</h2>
        <p className="mt-1 text-sm text-stone-500">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((asset) => <AssetTile key={asset.id} asset={asset} />)}
      </div>
    </section>
  )
}

function BoardCanvas({ model, onNavigate }: StudioStageCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  if (model.shots.length === 0) {
    return (
      <EmptyCanvas
        title="分镜还没有生成"
        description="Visual Kit 确认后再生成分镜，保证核心角色和场景在镜头间保持一致。"
        action={<StudioButton onClick={() => { void runtime.onRunScriptToStoryboard() }} disabled={!model.workflow.visualApproved}>生成分镜</StudioButton>}
      />
    )
  }
  return (
    <div className="rounded-lg border border-white/10 bg-[#151613]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Board</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-50">镜头分镜板</h1>
        </div>
        <StudioButton onClick={() => onNavigate('videos')}>确认分镜并进入制作</StudioButton>
      </header>
      <div className="grid gap-3 p-4 xl:grid-cols-2">
        {model.shots.map((shot) => (
          <article key={shot.id} className="grid gap-3 rounded-md border border-white/10 bg-[#10110f] p-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <div className="relative aspect-video overflow-hidden rounded-md bg-[#1c1d19]">
              {shot.imageUrl ? <Image src={shot.imageUrl} alt={`Shot ${shot.number}`} fill sizes="180px" className="object-cover" unoptimized /> : <div className="flex h-full items-center justify-center text-stone-600"><AppIcon name="image" className="h-7 w-7" /></div>}
            </div>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-stone-50">Shot {String(shot.number).padStart(2, '0')}</h2>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(shot.status)}`}>{statusLabel(shot.status)}</span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-300">{shot.description || '待补充画面描述'}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-400">
                {shot.location ? <span className="rounded bg-white/[0.05] px-2 py-1">{shot.location}</span> : null}
                {shot.characters.slice(0, 3).map((name) => <span key={name} className="rounded bg-white/[0.05] px-2 py-1">{name}</span>)}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function ProduceCanvas({ model, onNavigate }: StudioStageCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const [pendingId, setPendingId] = useState('')
  const videoModel = runtime.videoModel || runtime.userVideoModels[0]?.value
  const generateOne = async (storyboardId: string, panelIndex: number, id: string) => {
    if (!videoModel) {
      window.alert('请先在设置中配置视频模型。')
      return
    }
    setPendingId(id)
    try {
      await runtime.onGenerateVideo(storyboardId, panelIndex, videoModel)
    } finally {
      setPendingId('')
    }
  }
  const generateAll = async () => {
    if (!videoModel) {
      window.alert('请先在设置中配置视频模型。')
      return
    }
    setPendingId('all')
    try {
      await runtime.onGenerateAllVideos({ videoModel })
    } finally {
      setPendingId('')
    }
  }

  if (model.productionItems.length === 0) {
    return <EmptyCanvas title="没有可制作的镜头" description="先确认分镜，再进入镜头图片、视频和配音制作。" action={<StudioButton onClick={() => onNavigate('storyboard')}>返回 Board</StudioButton>} />
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#151613]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Produce</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-50">镜头生产看板</h1>
        </div>
        <StudioButton onClick={() => { void generateAll() }} disabled={pendingId === 'all'}><AppIcon name={pendingId === 'all' ? 'loader' : 'video'} className={`h-4 w-4 ${pendingId === 'all' ? 'animate-spin' : ''}`} />生成缺失镜头</StudioButton>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-stone-500">
            <tr><th className="px-5 py-3">镜头</th><th className="px-5 py-3">图片</th><th className="px-5 py-3">视频</th><th className="px-5 py-3">配音</th><th className="px-5 py-3 text-right">操作</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {model.productionItems.map((item) => (
              <tr key={item.id} className="text-stone-300">
                <td className="px-5 py-4 font-semibold text-stone-100">Shot {String(item.shot.number).padStart(2, '0')}</td>
                <td className="px-5 py-4"><span className={`rounded-full border px-2 py-1 text-xs ${statusClass(item.imageStatus)}`}>{statusLabel(item.imageStatus)}</span></td>
                <td className="px-5 py-4"><span className={`rounded-full border px-2 py-1 text-xs ${statusClass(item.videoStatus)}`}>{statusLabel(item.videoStatus)}</span></td>
                <td className="px-5 py-4"><span className={`rounded-full border px-2 py-1 text-xs ${statusClass(item.voiceStatus)}`}>{statusLabel(item.voiceStatus)}</span></td>
                <td className="px-5 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => { void generateOne(item.shot.storyboardId, item.shot.panelIndex, item.id) }}
                    className="rounded-md border border-white/12 px-3 py-2 text-xs font-semibold text-stone-100 hover:bg-white/[0.08] disabled:opacity-50"
                    disabled={pendingId === item.id}
                  >
                    {pendingId === item.id ? '生成中' : item.shot.videoUrl ? '重新生成视频' : '生成视频'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EditCanvas({ model, onNavigate }: StudioStageCanvasProps) {
  const firstVideo = model.shots.find((shot) => shot.videoUrl)
  return (
    <div className="grid min-h-[620px] grid-rows-[1fr_auto] rounded-lg border border-white/10 bg-[#151613]">
      <div className="grid min-h-0 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-h-[420px] items-center justify-center rounded-md bg-black">
          {firstVideo?.videoUrl ? (
            <video src={firstVideo.videoUrl} controls className="h-full max-h-[560px] w-full object-contain" />
          ) : (
            <EmptyCanvas title="还没有可预览视频" description="完成至少一个镜头视频后，成片预览会出现在这里。" action={<StudioButton onClick={() => onNavigate('videos')}>进入 Produce</StudioButton>} />
          )}
        </div>
        <aside className="rounded-md border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-semibold text-stone-50">成片检查</h2>
          <ul className="mt-4 space-y-3 text-sm text-stone-400">
            <li>镜头视频：{model.summary.completedVideos}/{model.shots.length}</li>
            <li>失败镜头：{model.summary.failedShots}</li>
            <li>预计时长：{model.summary.totalDurationSec || '-'} 秒</li>
          </ul>
        </aside>
      </div>
      <div className="border-t border-white/10 px-5 py-4">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {model.shots.map((shot) => <div key={shot.id} className={`h-12 min-w-24 rounded border px-2 py-1 text-xs ${shot.videoUrl ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-white/10 bg-white/[0.04] text-stone-500'}`}>Shot {shot.number}</div>)}
        </div>
      </div>
    </div>
  )
}

function ExportCanvas({ model }: { model: StudioWorkspaceModel }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#151613] px-6 py-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Export</p>
      <h1 className="mt-2 text-2xl font-semibold text-stone-50">导出版本</h1>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {['平台规格', '质量检查', '字幕与封面'].map((title, index) => (
          <section key={title} className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-stone-50">{title}</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${index === 0 && model.workflow.hasVideo ? statusClass('locked') : statusClass('needs_review')}`}>
                {index === 0 && model.workflow.hasVideo ? '可导出' : '待完善'}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-400">导出接口仍沿用现有合并导出能力，首版先承载配置和状态。</p>
          </section>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <StudioButton disabled={!model.workflow.hasVideo}><AppIcon name="download" className="h-4 w-4" />导出视频</StudioButton>
      </div>
    </div>
  )
}

export default function StudioStageCanvas({ model, onNavigate }: StudioStageCanvasProps) {
  if (model.activeMode === 'start') return <StartCanvas model={model} />
  if (model.activeMode === 'draft') return <DraftCanvas model={model} onNavigate={onNavigate} />
  if (model.activeMode === 'visual-kit') return <VisualKitCanvas model={model} />
  if (model.activeMode === 'board') return <BoardCanvas model={model} onNavigate={onNavigate} />
  if (model.activeMode === 'produce') return <ProduceCanvas model={model} onNavigate={onNavigate} />
  if (model.activeMode === 'edit') return <EditCanvas model={model} onNavigate={onNavigate} />
  return <ExportCanvas model={model} />
}

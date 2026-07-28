'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
} from '@/lib/novel-promotion/subtitle-contract'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
} from './StudioPrimitives'
import type { StudioProductStatus, StudioWorkspaceModel } from './studio-types'

interface SubtitleCue {
  id: string
  panelId: string
  panelIndex: number
  startMs: number
  endMs: number
  text: string
}

interface SubtitleWarning {
  code: string
  message: string
}

interface SubtitleTrack {
  id: string
  status: string
  style: SubtitleStyle
  cues: SubtitleCue[]
  warnings: SubtitleWarning[]
  srtDownloadUrl: string | null
  assDownloadUrl: string | null
  burnedVideoDownloadUrl: string | null
}

interface SubtitlePreview {
  status: 'ready' | 'silent'
  cues: SubtitleCue[]
  warnings: SubtitleWarning[]
  style: SubtitleStyle
}

interface SubtitleTrackResponse {
  available: boolean
  track: SubtitleTrack | null
  stale: boolean
  preview: SubtitlePreview
  message: string | null
}

interface StudioSubtitleCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

function formatTime(value: number): string {
  const seconds = Math.max(0, value) / 1000
  return `${seconds.toFixed(1)}s`
}

function resolveSubtitleStatus(params: {
  hasVideo: boolean
  hasTrack: boolean
  stale: boolean
  loading: boolean
}): StudioProductStatus {
  if (params.loading) return 'generating'
  if (!params.hasVideo) return 'empty'
  if (params.stale) return 'stale'
  if (params.hasTrack) return 'locked'
  return 'drafting'
}

function inputClassName() {
  return 'h-9 w-full rounded-md border border-white/10 bg-black/20 px-2 text-sm text-stone-100 outline-none focus:border-[#e8d18a]/60'
}

export default function StudioSubtitleCanvas({ model, onNavigate }: StudioSubtitleCanvasProps) {
  const { projectId, episodeId } = useWorkspaceProvider()
  const [response, setResponse] = useState<SubtitleTrackResponse | null>(null)
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadTrack = useCallback(async () => {
    if (!episodeId) return
    setLoading(true)
    setError('')
    try {
      const result = await apiFetch(`/api/novel-promotion/${projectId}/subtitle-tracks?episodeId=${encodeURIComponent(episodeId)}`)
      const payload = await result.json() as SubtitleTrackResponse
      if (!result.ok) throw new Error(payload.message || '读取字幕状态失败')
      setResponse(payload)
      setStyle(payload.track?.style || payload.preview?.style || DEFAULT_SUBTITLE_STYLE)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取字幕状态失败')
    } finally {
      setLoading(false)
    }
  }, [episodeId, projectId])

  useEffect(() => {
    void loadTrack()
  }, [loadTrack])

  const buildTrack = async () => {
    if (!episodeId) return
    setLoading(true)
    setError('')
    try {
      const result = await apiFetch(`/api/novel-promotion/${projectId}/subtitle-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, style }),
      })
      const payload = await result.json() as SubtitleTrackResponse
      if (!result.ok) throw new Error(payload.message || '生成字幕失败')
      setResponse(payload)
      setStyle(payload.track?.style || payload.preview?.style || style)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成字幕失败')
    } finally {
      setLoading(false)
    }
  }

  const preview = response?.track && !response.stale ? response.track : response?.preview
  const cues = preview?.cues || []
  const warnings = preview?.warnings || []
  const firstCue = cues[0] || null
  const hasVideo = model.summary.completedVideos > 0
  const status = resolveSubtitleStatus({
    hasVideo,
    hasTrack: !!response?.track,
    stale: response?.stale === true,
    loading,
  })
  const previewVideoUrl = model.shots.find((shot) => !!shot.videoUrl)?.videoUrl || null
  const subtitlePositionClass = style.position === 'top'
    ? 'top-[10%]'
    : style.position === 'middle'
      ? 'top-1/2 -translate-y-1/2'
      : 'bottom-[12%]'
  const subtitleBackground = style.preset === 'boxed'
    ? { backgroundColor: `${style.outlineColor}${Math.round(style.backgroundOpacity * 255).toString(16).padStart(2, '0')}` }
    : undefined
  const canDownload = !!response?.track && !response.stale

  const metrics = {
    cueCount: cues.length,
    panelCount: new Set(cues.map((cue) => cue.panelId)).size,
    warningCount: warnings.length,
  }

  if (!episodeId) {
    return <StudioEmptyState icon="audioWave" title="请选择剧集" description="字幕会按当前剧集的最终镜头视频生成。" />
  }

  return (
    <div className="space-y-4">
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="字幕与成片"
          title="镜头对齐字幕"
          description="字幕仅使用镜头口播版正文，不显示角色名，也不参与视频生成。"
          actions={(
            <div className="flex flex-wrap gap-2">
              <StudioButton variant="secondary" icon="download" onClick={() => response?.track?.srtDownloadUrl && window.open(response.track.srtDownloadUrl, '_blank')} disabled={!canDownload || !response?.track?.srtDownloadUrl}>
                下载 SRT
              </StudioButton>
              <StudioButton variant="secondary" icon="download" onClick={() => response?.track?.assDownloadUrl && window.open(response.track.assDownloadUrl, '_blank')} disabled={!canDownload || !response?.track?.assDownloadUrl}>
                下载 ASS
              </StudioButton>
              <StudioButton icon="refresh" loading={loading} onClick={() => { void buildTrack() }} disabled={!hasVideo || loading}>
                {response?.track ? '重建字幕' : '生成字幕'}
              </StudioButton>
              <StudioButton icon="film" onClick={() => onNavigate('export')} disabled={!hasVideo}>
                前往交付
              </StudioButton>
            </div>
          )}
        />
        <div className="grid gap-4 border-t border-white/10 px-5 py-4 sm:grid-cols-3">
          <StudioMetric label="字幕条数" value={metrics.cueCount} />
          <StudioMetric label="覆盖镜头" value={metrics.panelCount} />
          <StudioMetric label="容量警告" value={metrics.warningCount} />
        </div>
      </StudioPanel>

      {error || response?.message ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error || response?.message}
        </div>
      ) : null}

      {response?.stale ? (
        <div className="rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          镜头视频或口播版已变化，现有字幕已过期。重建后再导出带字幕成片。
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <StudioPanel padding="none" className="overflow-hidden">
          <div className="border-b border-white/10 px-5 py-4">
            <StudioSectionHeader title="字幕预览" description="每个镜头从开始显示对应口播；同镜头多条口播仅在该镜头内切换。" />
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-md bg-black">
              {previewVideoUrl ? <video src={previewVideoUrl} muted autoPlay loop playsInline className="h-full w-full object-cover" /> : null}
              <div className={`absolute left-4 right-4 ${subtitlePositionClass} text-center`} style={{ transform: style.position === 'middle' ? `translateY(calc(-50% + ${style.verticalOffset}px))` : `translateY(${style.verticalOffset}px)` }}>
                <span
                  className="inline-block max-w-full whitespace-pre-line rounded px-2 py-1 text-center font-semibold leading-relaxed"
                  style={{
                    color: style.fontColor,
                    fontSize: `${style.fontSize || 24}px`,
                    textShadow: `0 0 ${Math.max(1, style.outlineWidth)}px ${style.outlineColor}, 0 0 ${Math.max(1, style.outlineWidth)}px ${style.outlineColor}`,
                    ...subtitleBackground,
                  }}
                >
                  {firstCue?.text || '暂无镜头口播字幕'}
                </span>
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StudioStatusBadge status={status} label={response?.stale ? '需重建' : response?.track ? '字幕已生成' : loading ? '生成中' : '未生成'} />
                {preview?.status === 'silent' ? <StudioStatusBadge status="locked" label="当前无口播" /> : null}
              </div>
              <div className="mt-4 max-h-[380px] space-y-2 overflow-auto pr-1">
                {cues.length > 0 ? cues.map((cue, index) => (
                  <div key={cue.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
                      <span>镜头 {cue.panelIndex + 1} · 字幕 {index + 1}</span>
                      <span>{formatTime(cue.startMs)} - {formatTime(cue.endMs)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm leading-6 text-stone-200">{cue.text}</p>
                  </div>
                )) : (
                  <StudioEmptyState icon="audioWave" title="暂无可显示的字幕" description="无台词镜头不会产生字幕。" />
                )}
              </div>
            </div>
          </div>
        </StudioPanel>

        <aside className="space-y-4">
          <StudioPanel>
            <StudioSectionHeader title="样式" description="样式按当前剧集保存，烧录成片与预览保持一致。" />
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-stone-400">预设
                <select className={`mt-1 ${inputClassName()}`} value={style.preset} onChange={(event) => setStyle((current) => ({ ...current, preset: event.target.value as SubtitleStyle['preset'] }))}>
                  <option value="cinematic">影视描边</option>
                  <option value="clean">简洁白字</option>
                  <option value="boxed">半透明底板</option>
                </select>
              </label>
              <label className="block text-xs text-stone-400">位置
                <select className={`mt-1 ${inputClassName()}`} value={style.position} onChange={(event) => setStyle((current) => ({ ...current, position: event.target.value as SubtitleStyle['position'] }))}>
                  <option value="bottom">底部居中</option>
                  <option value="middle">画面中央</option>
                  <option value="top">顶部居中</option>
                </select>
              </label>
              <label className="block text-xs text-stone-400">字号
                <input className={`mt-1 ${inputClassName()}`} type="number" min="24" max="120" value={style.fontSize || ''} placeholder="自动" onChange={(event) => setStyle((current) => ({ ...current, fontSize: event.target.value ? Number(event.target.value) : null }))} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-stone-400">文字颜色
                  <input className="mt-1 h-9 w-full rounded-md border border-white/10 bg-black/20 p-1" type="color" value={style.fontColor} onChange={(event) => setStyle((current) => ({ ...current, fontColor: event.target.value.toUpperCase() }))} />
                </label>
                <label className="block text-xs text-stone-400">描边颜色
                  <input className="mt-1 h-9 w-full rounded-md border border-white/10 bg-black/20 p-1" type="color" value={style.outlineColor} onChange={(event) => setStyle((current) => ({ ...current, outlineColor: event.target.value.toUpperCase() }))} />
                </label>
              </div>
              <label className="block text-xs text-stone-400">描边宽度
                <input className={`mt-1 ${inputClassName()}`} type="number" min="0" max="12" value={style.outlineWidth} onChange={(event) => setStyle((current) => ({ ...current, outlineWidth: Number(event.target.value) }))} />
              </label>
              <label className="block text-xs text-stone-400">垂直偏移
                <input className={`mt-1 ${inputClassName()}`} type="number" min="-240" max="240" value={style.verticalOffset} onChange={(event) => setStyle((current) => ({ ...current, verticalOffset: Number(event.target.value) }))} />
              </label>
              {style.preset === 'boxed' ? <label className="block text-xs text-stone-400">底板透明度
                <input className="mt-2 w-full" type="range" min="0" max="1" step="0.05" value={style.backgroundOpacity} onChange={(event) => setStyle((current) => ({ ...current, backgroundOpacity: Number(event.target.value) }))} />
              </label> : null}
            </div>
          </StudioPanel>

          {warnings.length > 0 ? (
            <StudioPanel>
              <StudioSectionHeader title="容量提示" description="字幕不会修改或截断口播版内容。" />
              <div className="mt-3 space-y-2">
                {warnings.map((warning) => <p key={`${warning.code}:${warning.message}`} className="rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-100">{warning.message}</p>)}
              </div>
            </StudioPanel>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

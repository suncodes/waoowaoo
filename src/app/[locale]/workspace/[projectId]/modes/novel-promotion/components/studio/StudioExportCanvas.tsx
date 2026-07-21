'use client'

import { useState, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { useMergeProjectEpisodeVideo } from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { AppIcon } from '@/components/ui/icons'
import { statusLabel, type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioExportCanvasProps {
  model: StudioWorkspaceModel
}

interface MergeResult {
  outputUrl: string
  downloadUrl: string
  fileName: string
  videoCount: number
  sizeBytes?: number
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

function formatBytes(value?: number) {
  if (!value || value <= 0) return '-'
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function parseDownloadFileName(disposition: string | null) {
  if (!disposition) return null
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) return decodeURIComponent(encodedMatch[1])
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  return plainMatch?.[1] ? decodeURIComponent(plainMatch[1]) : null
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function StudioExportCanvas({ model }: StudioExportCanvasProps) {
  const { projectId, episodeId } = useWorkspaceProvider()
  const mergeMutation = useMergeProjectEpisodeVideo(projectId)
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const [error, setError] = useState('')
  const completedVideos = model.summary.completedVideos
  const canExport = completedVideos > 0 && !!episodeId

  const mergeVideo = async () => {
    if (!episodeId) return
    setError('')
    try {
      const result = await mergeMutation.mutateAsync({
        episodeId,
        panelPreferences: {},
      })
      setMergeResult(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '合并导出失败')
    }
  }

  const downloadVideoZip = async () => {
    if (!episodeId) return
    setError('')
    setDownloadingZip(true)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/download-videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, panelPreferences: {} }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.message || '下载视频包失败')
      }
      const blob = await response.blob()
      const fileName = parseDownloadFileName(response.headers.get('Content-Disposition')) || 'videos.zip'
      downloadBlob(blob, fileName)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载视频包失败')
    } finally {
      setDownloadingZip(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151613] px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">Export</p>
            <h1 className="mt-2 text-2xl font-semibold text-stone-50">导出版本</h1>
            <p className="mt-2 text-sm text-stone-400">合并成片或下载所有镜头视频，导出结果沿用现有任务和存储能力。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { void downloadVideoZip() }} disabled={!canExport || downloadingZip}>
              <AppIcon name={downloadingZip ? 'loader' : 'download'} className={`h-4 w-4 ${downloadingZip ? 'animate-spin' : ''}`} />
              下载镜头包
            </Button>
            <Button onClick={() => { void mergeVideo() }} disabled={!canExport || mergeMutation.isPending}>
              <AppIcon name={mergeMutation.isPending ? 'loader' : 'film'} className={`h-4 w-4 ${mergeMutation.isPending ? 'animate-spin' : ''}`} />
              合并成片
            </Button>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-stone-50">导出素材</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(canExport ? 'locked' : 'needs_review')}`}>
                {canExport ? '可导出' : '待完善'}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-400">已完成视频：{completedVideos}/{model.shots.length}</p>
          </section>

          <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-stone-50">合并任务</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(mergeMutation.isPending ? 'generating' : mergeResult ? 'locked' : 'empty')}`}>
                {mergeMutation.isPending ? '合并中' : mergeResult ? '已生成' : '未开始'}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-400">
              {mergeResult ? `${mergeResult.videoCount} 个片段 · ${formatBytes(mergeResult.sizeBytes)}` : '生成后会得到一个连续 MP4。'}
            </p>
          </section>

          <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-stone-50">质量检查</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(model.summary.failedShots > 0 ? 'failed' : canExport ? 'locked' : 'empty')}`}>
                {model.summary.failedShots > 0 ? statusLabel('failed') : canExport ? statusLabel('locked') : statusLabel('empty')}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-400">失败镜头：{model.summary.failedShots}</p>
          </section>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#151613] p-4">
        {mergeResult?.outputUrl ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex min-h-[360px] items-center justify-center rounded-md bg-black">
              <video src={mergeResult.outputUrl} controls className="max-h-[560px] w-full object-contain" />
            </div>
            <aside className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold text-stone-50">{mergeResult.fileName}</h2>
              <p className="text-sm text-stone-400">片段：{mergeResult.videoCount}</p>
              <p className="text-sm text-stone-400">大小：{formatBytes(mergeResult.sizeBytes)}</p>
              <Button onClick={() => window.open(mergeResult.downloadUrl || mergeResult.outputUrl, '_blank')}>
                <AppIcon name="download" className="h-4 w-4" />
                下载成片
              </Button>
            </aside>
          </div>
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-md border border-dashed border-white/15 bg-[#10110f] px-6 py-12 text-center">
            <AppIcon name="film" className="h-8 w-8 text-stone-600" />
            <h2 className="mt-4 text-base font-semibold text-stone-50">还没有导出成片</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-stone-400">点击“合并成片”后，导出任务会把当前剧集已完成镜头按顺序拼接成 MP4。</p>
          </div>
        )}
      </section>
    </div>
  )
}

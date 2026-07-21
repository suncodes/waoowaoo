'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { useMergeProjectEpisodeVideo } from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioProcessSteps,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
} from './StudioPrimitives'
import { type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

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

function DeliveryCheckRow({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status: StudioProductStatus
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-stone-200">{label}</div>
        <div className="mt-1 truncate text-xs text-stone-500">{value}</div>
      </div>
      <StudioStatusBadge status={status} />
    </div>
  )
}

export default function StudioExportCanvas({ model }: StudioExportCanvasProps) {
  const { projectId, episodeId } = useWorkspaceProvider()
  const mergeMutation = useMergeProjectEpisodeVideo(projectId)
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const [error, setError] = useState('')
  const completedVideos = model.summary.completedVideos
  const canExport = completedVideos > 0 && !!episodeId
  const totalShots = model.shots.length
  const allVideosReady = totalShots > 0 && completedVideos === totalShots
  const mergeStatus: StudioProductStatus = mergeMutation.isPending ? 'generating' : mergeResult ? 'locked' : 'empty'
  const materialStatus: StudioProductStatus = model.summary.failedShots > 0 ? 'failed' : canExport ? 'locked' : 'needs_review'
  const packageStatus: StudioProductStatus = downloadingZip ? 'generating' : canExport ? 'needs_review' : 'empty'
  const deliveryStatus: StudioProductStatus = mergeResult ? 'locked' : allVideosReady ? 'needs_review' : 'empty'
  const incompleteShots = model.shots.filter((shot) => !shot.videoUrl || shot.errorMessage)
  const processSteps: Array<{ label: string; helper: string; status: StudioProductStatus }> = [
    {
      label: '素材检查',
      helper: `${completedVideos}/${totalShots}`,
      status: materialStatus,
    },
    {
      label: '镜头包',
      helper: downloadingZip ? '下载准备中' : canExport ? '可下载' : '等待视频',
      status: packageStatus,
    },
    {
      label: '合并成片',
      helper: mergeMutation.isPending ? '合并中' : mergeResult ? `${mergeResult.videoCount} 段` : '未生成',
      status: mergeStatus,
    },
    {
      label: '交付版本',
      helper: mergeResult ? '已生成' : allVideosReady ? '待合并' : '需补齐',
      status: deliveryStatus,
    },
  ]

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
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="交付"
          title="交付中心"
          description="合并成片或下载所有镜头视频，导出结果沿用现有任务和存储能力。"
          actions={(
            <>
              <StudioButton variant="secondary" icon="download" loading={downloadingZip} onClick={() => { void downloadVideoZip() }} disabled={!canExport}>
              下载镜头包
              </StudioButton>
              <StudioButton icon="film" loading={mergeMutation.isPending} onClick={() => { void mergeVideo() }} disabled={!canExport}>
              合并成片
              </StudioButton>
            </>
          )}
        />
        <div className="border-b border-white/10 px-6 py-4">
          <StudioProcessSteps steps={processSteps} />
        </div>

        {error ? (
          <div className="mx-6 mb-5 rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <div className="grid gap-4 px-6 py-4 lg:grid-cols-4">
          <StudioMetric label="镜头视频" value={`${completedVideos}/${totalShots}`} />
          <StudioMetric label="失败镜头" value={model.summary.failedShots} />
          <StudioMetric label="合并片段" value={mergeResult?.videoCount || '-'} />
          <StudioMetric label="文件大小" value={formatBytes(mergeResult?.sizeBytes)} />
        </div>
      </StudioPanel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <StudioPanel padding="none" className="overflow-hidden">
          <div className="border-b border-white/10 px-5 py-4">
            <StudioSectionHeader
              title="交付预览"
              description={mergeResult ? '当前合并成片可预览和下载。' : '合并完成后会显示连续成片预览。'}
            />
          </div>
          {mergeResult?.outputUrl ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-md bg-black">
              <video src={mergeResult.outputUrl} controls className="max-h-[560px] w-full object-contain" />
            </div>
          ) : (
            <StudioEmptyState
              icon="film"
              title="还没有导出成片"
              description="点击“合并成片”后，导出任务会把当前剧集已完成镜头按顺序拼接成 MP4。"
              action={<StudioButton icon="film" loading={mergeMutation.isPending} onClick={() => { void mergeVideo() }} disabled={!canExport}>合并成片</StudioButton>}
            />
          )}
        </StudioPanel>

        <aside className="space-y-4">
          <StudioPanel>
            <StudioSectionHeader title="导出结果" description="成片生成后可直接打开下载地址。" />
            {mergeResult ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs font-semibold text-stone-500">文件名</div>
                  <p className="mt-2 break-all text-sm leading-6 text-stone-200">{mergeResult.fileName}</p>
                </div>
                <DeliveryCheckRow label="片段数量" value={`${mergeResult.videoCount} 个`} status="locked" />
                <DeliveryCheckRow label="文件大小" value={formatBytes(mergeResult.sizeBytes)} status="locked" />
                <StudioButton icon="download" onClick={() => window.open(mergeResult.downloadUrl || mergeResult.outputUrl, '_blank')}>
                  下载成片
                </StudioButton>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <DeliveryCheckRow label="合并任务" value="尚未生成连续成片" status={mergeStatus} />
                <DeliveryCheckRow label="导出素材" value={canExport ? '已有可导出视频' : '没有可导出视频'} status={materialStatus} />
              </div>
            )}
          </StudioPanel>

          <StudioPanel>
            <StudioSectionHeader title="交付缺口" description="优先补齐失败或缺少视频的镜头。" />
            <div className="mt-4 space-y-2">
              {incompleteShots.length > 0 ? (
                incompleteShots.slice(0, 6).map((shot) => (
                  <DeliveryCheckRow
                    key={shot.id}
                    label={`第 ${shot.number} 镜`}
                    value={shot.errorMessage || (shot.videoUrl ? '可导出' : '缺少视频')}
                    status={shot.errorMessage ? 'failed' : shot.videoUrl ? 'locked' : 'needs_review'}
                  />
                ))
              ) : (
                <DeliveryCheckRow label="镜头视频" value="全部镜头已生成视频" status={completedVideos > 0 ? 'locked' : 'empty'} />
              )}
              {incompleteShots.length > 6 ? (
                <p className="text-xs text-stone-500">还有 {incompleteShots.length - 6} 个镜头待处理。</p>
              ) : null}
            </div>
          </StudioPanel>
        </aside>
      </div>
    </div>
  )
}

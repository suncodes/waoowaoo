'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { useMergeProjectEpisodeVideo } from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioProcessSteps,
  resolveStudioVideoFrameStyle,
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
  audioTrackApplied?: boolean
  subtitleRequested?: boolean
  subtitleTrackApplied?: boolean
  subtitleCueCount?: number
  subtitleSrtDownloadUrl?: string | null
  subtitleAssDownloadUrl?: string | null
  taskId?: string
  mergedAt?: string | null
}

interface LatestMergeResponse {
  latest: MergeResult | null
}

function formatBytes(value?: number) {
  if (!value || value <= 0) return '-'
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
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
  const runtime = useWorkspaceStageRuntime()
  const mergeMutation = useMergeProjectEpisodeVideo(projectId)
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null)
  const [loadingLatestMerge, setLoadingLatestMerge] = useState(false)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const [diagnosticTaskId, setDiagnosticTaskId] = useState<string | null>(null)
  const [diagnosticStatus, setDiagnosticStatus] = useState<'idle' | 'queued' | 'processing' | 'completed' | 'failed'>('idle')
  const [diagnosticScope, setDiagnosticScope] = useState<'project' | 'episode'>('project')
  const [includeCandidates, setIncludeCandidates] = useState(true)
  const [includeVideos, setIncludeVideos] = useState(true)
  const [includeAllVideos, setIncludeAllVideos] = useState(false)
  const [includeReasoning, setIncludeReasoning] = useState(false)
  const [burnSubtitles, setBurnSubtitles] = useState(false)
  const [error, setError] = useState('')
  const completedVideos = model.summary.completedVideos
  const canExport = completedVideos > 0 && !!episodeId
  const totalShots = model.shots.length
  const allVideosReady = totalShots > 0 && completedVideos === totalShots
  const videoFrameStyle = resolveStudioVideoFrameStyle(runtime.videoRatio)
  const mergeStatus: StudioProductStatus = mergeMutation.isPending ? 'generating' : mergeResult ? 'locked' : 'empty'
  const materialStatus: StudioProductStatus = model.summary.failedShots > 0 ? 'failed' : canExport ? 'locked' : 'needs_review'
  const packageStatus: StudioProductStatus = downloadingZip ? 'generating' : canExport ? 'needs_review' : 'empty'
  const deliveryStatus: StudioProductStatus = mergeResult ? 'locked' : allVideosReady ? 'needs_review' : 'empty'
  const incompleteShots = model.shots.filter((shot) => !shot.videoUrl || shot.errorMessage)

  const loadLatestMerge = useCallback(async () => {
    if (!episodeId) {
      setMergeResult(null)
      return
    }

    setError('')
    setLoadingLatestMerge(true)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/merge-videos?episodeId=${encodeURIComponent(episodeId)}`)
      const payload = await response.json().catch(() => null) as LatestMergeResponse | null
      if (!response.ok) {
        throw new Error((payload as { message?: string } | null)?.message || '读取最近成片失败')
      }
      setMergeResult(payload?.latest || null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取最近成片失败')
    } finally {
      setLoadingLatestMerge(false)
    }
  }, [episodeId, projectId])

  useEffect(() => {
    void loadLatestMerge()
  }, [loadLatestMerge])

  useEffect(() => {
    if (diagnosticTaskId) return
    const existing = model.generationJobs.find((job) => job.id.startsWith('diagnostic:') && job.taskId)
    if (!existing?.taskId) return
    setDiagnosticTaskId(existing.taskId)
    setDiagnosticStatus(existing.status === 'locked' ? 'completed' : existing.status === 'failed' ? 'failed' : existing.status === 'generating' ? 'processing' : 'queued')
  }, [diagnosticTaskId, model.generationJobs])

  useEffect(() => {
    if (!diagnosticTaskId || diagnosticStatus === 'completed' || diagnosticStatus === 'failed') return
    let disposed = false
    const poll = async () => {
      const response = await apiFetch(`/api/tasks/${diagnosticTaskId}`)
      if (!response.ok || disposed) return
      const payload = await response.json().catch(() => null)
      const status = payload?.task?.status
      if (status === 'completed' || status === 'failed') {
        setDiagnosticStatus(status)
        return
      }
      setDiagnosticStatus(status === 'processing' ? 'processing' : 'queued')
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 2500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [diagnosticStatus, diagnosticTaskId])
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
      helper: mergeMutation.isPending ? '合并中' : mergeResult ? `${mergeResult.videoCount} 段${mergeResult.subtitleTrackApplied ? ' · 已烧录字幕' : ''}` : '未生成',
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
        audioStrategy: 'timeline',
        subtitleStrategy: burnSubtitles ? 'burned' : 'none',
      })
      setMergeResult(result)
      void loadLatestMerge()
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

  const createDiagnosticExport = async () => {
    setError('')
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/diagnostic-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: diagnosticScope === 'episode' ? episodeId : null,
          includeCandidates,
          includeVideos,
          includeAllVideos: includeVideos && includeAllVideos,
          includeReasoning,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.taskId) throw new Error(payload?.message || '诊断包任务提交失败')
      setDiagnosticTaskId(payload.taskId)
      setDiagnosticStatus('queued')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '诊断包任务提交失败')
    }
  }

  const downloadDiagnosticExport = async () => {
    if (!diagnosticTaskId) return
    setError('')
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/diagnostic-export/${diagnosticTaskId}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ready || typeof payload.downloadUrl !== 'string') {
        throw new Error('诊断包尚未准备完成')
      }
      window.location.assign(payload.downloadUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '诊断包下载失败')
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
              <StudioButton variant="ghost" icon="package" loading={diagnosticStatus === 'processing'} onClick={() => { void createDiagnosticExport() }} disabled={diagnosticStatus === 'queued' || diagnosticStatus === 'processing'}>
              导出项目诊断包
              </StudioButton>
              {diagnosticStatus === 'completed' ? (
                <StudioButton variant="secondary" icon="download" onClick={() => { void downloadDiagnosticExport() }}>
                下载诊断包
                </StudioButton>
              ) : null}
              <StudioButton variant="secondary" icon="download" loading={downloadingZip} onClick={() => { void downloadVideoZip() }} disabled={!canExport}>
              下载镜头包
              </StudioButton>
              <StudioButton variant="secondary" icon="refresh" loading={loadingLatestMerge} onClick={() => { void loadLatestMerge() }} disabled={!episodeId}>
              刷新成片
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

        <div className="border-b border-white/10 px-6 py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
            <input
              type="checkbox"
              checked={burnSubtitles}
              onChange={(event) => setBurnSubtitles(event.target.checked)}
              disabled={!episodeId || mergeMutation.isPending}
              className="mt-0.5 h-4 w-4 accent-[#e8d18a]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-stone-100">烧录字幕</span>
              <span className="mt-1 block text-xs leading-5 text-stone-500">本次合并会按镜头口播版正文烧录字幕，不显示角色名。未勾选则导出无字幕成片；两种成片相互独立，不修改镜头原视频。</span>
            </span>
          </label>
        </div>

        <div className="border-b border-white/10 px-6 py-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section>
              <div className="text-sm font-semibold text-stone-100">导出范围</div>
              <p className="mt-1 text-xs leading-5 text-stone-500">默认导出整个项目，便于还原跨剧集的完整流程。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className={`inline-flex cursor-pointer items-center gap-2 border px-3 py-2 text-xs ${diagnosticScope === 'project' ? 'border-[#e8d18a]/50 bg-[#e8d18a]/10 text-[#f3e9cf]' : 'border-white/10 bg-white/[0.03] text-stone-400'}`}>
                  <input type="radio" name="diagnostic-scope" checked={diagnosticScope === 'project'} onChange={() => setDiagnosticScope('project')} />全项目
                </label>
                <label className={`inline-flex cursor-pointer items-center gap-2 border px-3 py-2 text-xs ${diagnosticScope === 'episode' ? 'border-[#e8d18a]/50 bg-[#e8d18a]/10 text-[#f3e9cf]' : 'border-white/10 bg-white/[0.03] text-stone-400'}`}>
                  <input type="radio" name="diagnostic-scope" checked={diagnosticScope === 'episode'} onChange={() => setDiagnosticScope('episode')} disabled={!episodeId} />当前剧集
                </label>
              </div>
            </section>
            <section>
              <div className="text-sm font-semibold text-stone-100">内容选项</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="inline-flex items-center gap-2 text-xs text-stone-400"><input type="checkbox" checked={includeCandidates} onChange={(event) => setIncludeCandidates(event.target.checked)} />候选图片和历史版本</label>
                <label className="inline-flex items-center gap-2 text-xs text-stone-400"><input type="checkbox" checked={includeVideos} onChange={(event) => setIncludeVideos(event.target.checked)} />视频和音频媒体</label>
                <label className="inline-flex items-center gap-2 text-xs text-stone-400"><input type="checkbox" checked={includeAllVideos} onChange={(event) => setIncludeAllVideos(event.target.checked)} disabled={!includeVideos} />包含所有视频候选</label>
                <label className="inline-flex items-center gap-2 text-xs text-stone-400"><input type="checkbox" checked={includeReasoning} onChange={(event) => setIncludeReasoning(event.target.checked)} />包含模型推理字段</label>
              </div>
            </section>
          </div>
        </div>

        <div className="border-b border-white/10 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-stone-100">流程诊断包</div>
              <div className="mt-1 text-xs text-stone-500">包含整个项目的输入、任务事件、模型输出、资产引用和可下载媒体。</div>
            </div>
            <StudioStatusBadge
              status={diagnosticStatus === 'completed' ? 'locked' : diagnosticStatus === 'failed' ? 'failed' : diagnosticStatus === 'processing' || diagnosticStatus === 'queued' ? 'generating' : 'empty'}
              label={diagnosticStatus === 'completed' ? '已完成' : diagnosticStatus === 'failed' ? '失败' : diagnosticStatus === 'processing' ? '生成中' : diagnosticStatus === 'queued' ? '排队中' : '未导出'}
            />
          </div>
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
              description={mergeResult ? '显示当前剧集最近一次保存的合并成片，可直接预览和下载。' : '合并完成后会显示连续成片预览。'}
            />
          </div>
          {mergeResult?.outputUrl ? (
            <div className="flex min-h-[360px] items-center justify-center bg-black p-4">
              <div className="relative overflow-hidden rounded-md bg-black" style={videoFrameStyle}>
                <video src={mergeResult.outputUrl} controls className="h-full w-full object-contain" />
              </div>
            </div>
          ) : (
            <StudioEmptyState
              icon="film"
              title="还没有导出成片"
              description="点击“合并成片”后，导出任务会把当前剧集镜头按顺序拼接，并按旁白时间轴叠加音频。"
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
                <DeliveryCheckRow label="最近保存" value={formatDateTime(mergeResult.mergedAt)} status="locked" />
                <DeliveryCheckRow label="旁白音轨" value={mergeResult.audioTrackApplied ? '已叠加' : '未叠加'} status={mergeResult.audioTrackApplied ? 'locked' : 'needs_review'} />
                <DeliveryCheckRow
                  label="烧录字幕"
                  value={!mergeResult.subtitleRequested
                    ? '未选择烧录'
                    : mergeResult.subtitleTrackApplied
                      ? `已烧录 ${mergeResult.subtitleCueCount || 0} 条`
                      : '未烧录：当前镜头没有可用口播'}
                  status={mergeResult.subtitleTrackApplied ? 'locked' : mergeResult.subtitleRequested ? 'needs_review' : 'empty'}
                />
                <DeliveryCheckRow label="文件大小" value={formatBytes(mergeResult.sizeBytes)} status="locked" />
                <StudioButton icon="download" onClick={() => window.open(mergeResult.downloadUrl || mergeResult.outputUrl, '_blank')}>
                  下载成片
                </StudioButton>
                {mergeResult.subtitleSrtDownloadUrl || mergeResult.subtitleAssDownloadUrl ? (
                  <div className="flex flex-wrap gap-2">
                    {mergeResult.subtitleSrtDownloadUrl ? <StudioButton size="sm" variant="secondary" icon="download" onClick={() => window.open(mergeResult.subtitleSrtDownloadUrl!, '_blank')}>下载 SRT</StudioButton> : null}
                    {mergeResult.subtitleAssDownloadUrl ? <StudioButton size="sm" variant="secondary" icon="download" onClick={() => window.open(mergeResult.subtitleAssDownloadUrl!, '_blank')}>下载 ASS</StudioButton> : null}
                  </div>
                ) : null}
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

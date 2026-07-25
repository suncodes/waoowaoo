'use client'

import { useMemo } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  useMatchedVoiceLines,
  useMixProjectEpisodeAudio,
  useMixProjectPanelAudio,
  useVideoTaskPresentation,
  type MatchedVoiceLine,
} from '@/lib/query/hooks'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioPanel,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
} from './StudioPrimitives'
import { buildProduceItems, panelVideoUrl, type ProduceItem } from './studio-produce-model'
import type { StudioProductStatus, StudioWorkspaceModel } from './studio-types'

interface StudioAudioCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

interface AudioPanelItem extends ProduceItem {
  voiceLines: MatchedVoiceLine[]
}

function panelKey(storyboardId: string | null | undefined, panelIndex: number | null | undefined) {
  if (!storyboardId || panelIndex === null || panelIndex === undefined) return ''
  return `${storyboardId}:${panelIndex}`
}

function estimateSubtitleDurationMs(content: string) {
  const compactLength = content.replace(/\s+/g, '').length
  return Math.max(1200, Math.min(8000, compactLength * 180))
}

function resolveLineDurationMs(line: MatchedVoiceLine) {
  if (typeof line.audioDuration === 'number' && Number.isFinite(line.audioDuration) && line.audioDuration > 0) {
    return Math.max(800, Math.round(line.audioDuration))
  }
  if (typeof line.estimatedDurationMs === 'number' && Number.isFinite(line.estimatedDurationMs) && line.estimatedDurationMs > 0) {
    return Math.max(800, Math.round(line.estimatedDurationMs))
  }
  return estimateSubtitleDurationMs(line.content || '')
}

function formatSrtTime(ms: number) {
  const safeMs = Math.max(0, Math.floor(ms))
  const hours = Math.floor(safeMs / 3_600_000)
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1000)
  const milliseconds = safeMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

function formatDuration(ms: number | null | undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '-'
  return `${(ms / 1000).toFixed(1)}s`
}

function subtitleText(line: MatchedVoiceLine) {
  const speaker = line.speaker?.trim()
  if (!speaker || speaker === '旁白' || speaker.toLowerCase() === 'narrator') return line.content
  return `${speaker}：${line.content}`
}

function lineTiming(line: MatchedVoiceLine, fallbackStartMs: number) {
  if (
    typeof line.timelineStartMs === 'number'
    && Number.isFinite(line.timelineStartMs)
    && typeof line.timelineEndMs === 'number'
    && Number.isFinite(line.timelineEndMs)
    && line.timelineEndMs > line.timelineStartMs
  ) {
    return {
      startMs: Math.max(0, Math.round(line.timelineStartMs)),
      endMs: Math.max(0, Math.round(line.timelineEndMs)),
      timelineBased: true,
    }
  }
  const durationMs = resolveLineDurationMs(line)
  return {
    startMs: fallbackStartMs,
    endMs: fallbackStartMs + durationMs,
    timelineBased: false,
  }
}

function buildSrt(voiceLines: MatchedVoiceLine[]) {
  const blocks: string[] = []
  let cursorMs = 0
  let index = 1

  for (const line of [...voiceLines].sort((left, right) => left.lineIndex - right.lineIndex)) {
    const timing = lineTiming(line, cursorMs)
    blocks.push([
      String(index),
      `${formatSrtTime(timing.startMs)} --> ${formatSrtTime(timing.endMs)}`,
      subtitleText(line),
    ].join('\n'))
    cursorMs = timing.timelineBased ? Math.max(cursorMs, timing.endMs) : timing.endMs + 120
    index += 1
  }

  return `${blocks.join('\n\n')}\n`
}

function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function resolveAudioMixStatus(params: {
  hasOutput: boolean
  isRunning: boolean
  isFailed: boolean
  hasVideo: boolean
  hasVoiceAudio: boolean
}): StudioProductStatus {
  if (params.isRunning) return 'generating'
  if (params.isFailed) return 'failed'
  if (params.hasOutput) return 'locked'
  if (params.hasVideo && params.hasVoiceAudio) return 'needs_review'
  return 'empty'
}

function AudioPanelRow({
  item,
  status,
  errorMessage,
  running,
  onMix,
}: {
  item: AudioPanelItem
  status: StudioProductStatus
  errorMessage?: string | null
  running: boolean
  onMix: () => void
}) {
  const baseVideoUrl = panelVideoUrl(item.panel)
  const hasVoiceAudio = item.voiceLines.some((line) => !!line.audioUrl)
  const mixedVideoUrl = item.panel.audioMixedVideoUrl || null
  const disabled = !baseVideoUrl || !hasVoiceAudio || running

  return (
    <article className="rounded-lg border border-white/10 bg-[#10110f]">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-white/[0.06] px-2 text-xs font-semibold text-stone-300">
              {String(item.number).padStart(2, '0')}
            </span>
            <StudioStatusBadge status={baseVideoUrl ? 'locked' : 'empty'} label={baseVideoUrl ? '有视频' : '缺视频'} />
            <StudioStatusBadge status={hasVoiceAudio ? 'locked' : 'empty'} label={hasVoiceAudio ? '有配音' : '缺配音'} />
            <StudioStatusBadge status={status} label={mixedVideoUrl ? '已混音' : running ? '混音中' : status === 'failed' ? '混音失败' : '待混音'} />
          </div>

          <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-6 text-stone-100">
            {item.panel.description || '未命名镜头'}
          </h3>

          <div className="mt-3 space-y-2">
            {item.voiceLines.length > 0 ? item.voiceLines.map((line) => (
              <div key={line.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                  <span>台词 {line.lineIndex}</span>
                  <span>{line.speaker || '未命名说话人'}</span>
                  <span>{formatDuration(line.audioDuration)}</span>
                  {line.audioUrl ? <span className="text-emerald-300">音频已生成</span> : <span className="text-amber-200">音频未生成</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-300">{line.content}</p>
              </div>
            )) : (
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-stone-500">
                当前镜头没有匹配台词。
              </div>
            )}
          </div>

          {errorMessage ? (
            <div className="mt-3 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-stone-500">混音结果</div>
            {mixedVideoUrl ? (
              <video src={mixedVideoUrl} controls className="mt-2 aspect-video w-full rounded bg-black object-contain" />
            ) : (
              <div className="mt-2 flex aspect-video items-center justify-center rounded bg-black/70 text-stone-600">
                <AppIcon name="audioWave" className="h-6 w-6" />
              </div>
            )}
          </div>
          <StudioButton size="sm" icon="merge" loading={running} onClick={onMix} disabled={disabled}>
            {mixedVideoUrl ? '重新混音' : '混音到镜头'}
          </StudioButton>
        </div>
      </div>
    </article>
  )
}

export default function StudioAudioCanvas({ model, onNavigate }: StudioAudioCanvasProps) {
  const { projectId, episodeId } = useWorkspaceProvider()
  const { storyboards, episodeName } = useWorkspaceEpisodeStageData()
  const matchedVoiceLinesQuery = useMatchedVoiceLines(projectId, episodeId || null)
  const mixPanelMutation = useMixProjectPanelAudio(projectId, episodeId)
  const mixEpisodeMutation = useMixProjectEpisodeAudio(projectId, episodeId)
  const voiceLines = useMemo(
    () => matchedVoiceLinesQuery.data?.voiceLines || [],
    [matchedVoiceLinesQuery.data?.voiceLines],
  )

  const voiceLinesByPanel = useMemo(() => {
    const map = new Map<string, MatchedVoiceLine[]>()
    for (const line of voiceLines) {
      const key = panelKey(line.matchedStoryboardId, line.matchedPanelIndex)
      if (!key) continue
      const list = map.get(key) || []
      list.push(line)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((left, right) => left.lineIndex - right.lineIndex)
    }
    return map
  }, [voiceLines])

  const items = useMemo<AudioPanelItem[]>(() => (
    buildProduceItems(storyboards).map((item) => ({
      ...item,
      voiceLines: voiceLinesByPanel.get(panelKey(item.storyboard.id, item.panel.panelIndex)) || [],
    }))
  ), [storyboards, voiceLinesByPanel])

  const audioTargets = useMemo(() => items.map((item) => ({
    key: item.panel.id,
    targetType: 'NovelPromotionPanel',
    targetId: item.panel.id,
    types: ['audio_mix'],
    resource: 'video' as const,
    hasOutput: !!item.panel.audioMixedVideoUrl,
  })), [items])
  const audioTaskPresentation = useVideoTaskPresentation(projectId, audioTargets, {
    enabled: audioTargets.length > 0,
  })

  const stats = useMemo(() => {
    const withVideo = items.filter((item) => !!panelVideoUrl(item.panel)).length
    const withVoiceAudio = items.filter((item) => item.voiceLines.some((line) => !!line.audioUrl)).length
    const mixed = items.filter((item) => !!item.panel.audioMixedVideoUrl).length
    const subtitleLines = voiceLines.length
    return { withVideo, withVoiceAudio, mixed, subtitleLines }
  }, [items, voiceLines.length])

  const submitBatchMix = async () => {
    if (!episodeId) return
    try {
      const result = await mixEpisodeMutation.mutateAsync({ episodeId })
      const total = typeof result?.total === 'number' ? result.total : 0
      const skipped = typeof result?.skipped === 'number' ? result.skipped : 0
      window.alert(`已提交 ${total} 个镜头混音任务，跳过 ${skipped} 个镜头。`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '批量音频混合失败')
    }
  }

  const downloadSrt = () => {
    const srt = buildSrt(voiceLines)
    if (!srt.trim()) {
      window.alert('当前剧集没有可生成字幕的台词。')
      return
    }
    downloadTextFile(`${episodeName || model.draftTitle || 'subtitles'}.srt`, srt)
  }

  if (items.length === 0) {
    return (
      <StudioEmptyState
        icon="audioWave"
        title="没有可整合的镜头"
        description="先完成分镜图片与镜头视频，再进行配音混合和字幕导出。"
        action={<StudioButton onClick={() => onNavigate('videos')}>返回视频制作</StudioButton>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151613]">
        <StudioStageHeader
          eyebrow="音频与字幕"
          title="镜头音频整合"
          description="将已生成配音混合到对应镜头视频，并生成可下载的字幕文件。"
          actions={(
            <div className="flex flex-wrap gap-2">
              <StudioButton variant="secondary" icon="download" onClick={downloadSrt} disabled={stats.subtitleLines === 0}>
                下载 SRT
              </StudioButton>
              <StudioButton icon="merge" loading={mixEpisodeMutation.isPending} onClick={() => { void submitBatchMix() }} disabled={!episodeId || mixEpisodeMutation.isPending}>
                批量混音可用镜头
              </StudioButton>
            </div>
          )}
        />

        <div className="grid gap-3 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
          <StudioMetric label="镜头" value={items.length} />
          <StudioMetric label="有基础视频" value={stats.withVideo} />
          <StudioMetric label="有配音镜头" value={stats.withVoiceAudio} />
          <StudioMetric label="已混音" value={stats.mixed} />
        </div>

        <div className="space-y-3 p-4">
          {items.map((item) => {
            const taskState = audioTaskPresentation.getTaskState(item.panel.id)
            const running = taskState?.phase === 'queued' || taskState?.phase === 'processing'
            const failed = taskState?.phase === 'failed'
            const status = resolveAudioMixStatus({
              hasOutput: !!item.panel.audioMixedVideoUrl,
              isRunning: running,
              isFailed: failed,
              hasVideo: !!panelVideoUrl(item.panel),
              hasVoiceAudio: item.voiceLines.some((line) => !!line.audioUrl),
            })
            return (
              <AudioPanelRow
                key={item.id}
                item={item}
                status={status}
                running={running || mixPanelMutation.isPending}
                errorMessage={taskState?.lastError?.message || null}
                onMix={() => {
                  void mixPanelMutation.mutateAsync({ panelId: item.panel.id, force: true }).catch((error) => {
                    window.alert(error instanceof Error ? error.message : '音频混合失败')
                  })
                }}
              />
            )
          })}
        </div>
      </section>

      <StudioPanel padding="none">
        <div className="border-b border-white/10 px-5 py-4">
          <StudioSectionHeader title="字幕预览" description="按镜头和台词顺序生成 SRT，优先使用音频实际时长。" />
        </div>
        <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap px-5 py-4 text-xs leading-6 text-stone-400">
          {buildSrt(voiceLines).trim() || '暂无字幕内容'}
        </pre>
      </StudioPanel>
    </div>
  )
}

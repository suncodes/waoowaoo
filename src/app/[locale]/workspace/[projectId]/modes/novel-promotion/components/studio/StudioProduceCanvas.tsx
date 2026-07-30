'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import VisualQualityBadge from '@/components/visual-quality/VisualQualityBadge'
import { AppIcon } from '@/components/ui/icons'
import {
  useAiModifyProjectShotPrompt,
  useRegenerateProjectPanelImage,
  useUpdateProjectPanelImagePrompt,
  useUpdateProjectPanelLink,
} from '@/lib/query/hooks'
import { useVideoFirstLastFrameFlow } from '@/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow'
import { useVideoPromptState, type DirtyPromptEntry } from '@/lib/novel-promotion/stages/video-stage-runtime/useVideoPromptState'
import { resolveVoiceLinePanelBindings } from '@/lib/novel-promotion/voice-line-binding'
import { isRunningPhase } from '@/lib/task/presentation'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import { useStoryboardTaskAwareStoryboards } from '../storyboard/hooks/useStoryboardTaskAwareStoryboards'
import {
  StudioButton,
  StudioEmptyState,
  StudioMetric,
  StudioSectionHeader,
  StudioStageHeader,
  StudioStatusBadge,
} from './StudioPrimitives'
import StudioProduceQueueRow from './StudioProduceQueueRow'
import {
  buildProduceItems,
  buildBatchVideoPreflight,
  isPanelVisualReadyForVideo,
  panelLinkedToNext,
  panelLipSyncTaskRunning,
  panelVideoError,
  panelVideoModel,
  panelVideoUrl,
  resolveImageStatus,
  resolveVideoStatus,
  toVideoPanels,
  type ProduceItem,
  type BatchVideoMode,
  type BatchVideoSkipReason,
} from './studio-produce-model'
import type { StudioWorkspaceModel } from './studio-types'

interface StudioProduceCanvasProps {
  model: StudioWorkspaceModel
  onNavigate: (route: string) => void
}

type FirstLastFrameFlow = ReturnType<typeof useVideoFirstLastFrameFlow>
type VideoPromptState = ReturnType<typeof useVideoPromptState>

const BATCH_REASON_LABELS: Record<BatchVideoSkipReason, string> = {
  video_exists: '已有视频',
  video_running: '视频正在生成',
  image_missing: '缺少首帧图片',
  quality_not_ready: '首帧尚未完成质量确认',
  not_linked: '未连接下一镜头',
  last_panel: '最后一个镜头没有尾帧',
  last_image_missing: '尾帧图片缺失',
  last_quality_not_ready: '尾帧尚未完成质量确认',
}

interface BatchPreviewState {
  mode: BatchVideoMode
  eligibleCount: number
  skippedCount: number
  reasonCounts: Partial<Record<BatchVideoSkipReason, number>>
  issues: string[]
}

interface VideoRepairDraft {
  mode: 'normal' | 'firstlastframe'
  videoPrompt: string
  imagePrompt: string
}

function extractRequestId(message: string | null | undefined): string | null {
  const match = (message || '').match(/request\s*id\s*[:：]\s*([a-zA-Z0-9_-]+)/i)
  return match?.[1] || null
}

function isPolicyVideoError(code: string | null | undefined, message: string | null | undefined): boolean {
  const normalizedCode = (code || '').toUpperCase()
  const normalizedMessage = (message || '').toLowerCase()
  return normalizedCode === 'SENSITIVE_CONTENT'
    || normalizedMessage.includes('copyright')
    || normalizedMessage.includes('policy')
    || normalizedMessage.includes('safety')
    || normalizedMessage.includes('moderation')
    || normalizedMessage.includes('敏感')
    || normalizedMessage.includes('版权')
    || normalizedMessage.includes('安全')
}

function BatchVideoConfirmDialog({
  preview,
  loading,
  onCancel,
  onConfirm,
}: {
  preview: BatchPreviewState
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const title = preview.mode === 'firstlastframe' ? '批量生成首尾帧视频' : '批量生成单图视频'
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-lg border border-white/15 bg-[#151613] shadow-2xl">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-stone-50">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">系统已完成生成前检查，请确认本次提交范围。</p>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <StudioMetric label="可生成" value={preview.eligibleCount} />
            <StudioMetric label="将跳过" value={preview.skippedCount} />
          </div>
          {Object.entries(preview.reasonCounts).length > 0 ? (
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="text-xs font-semibold text-stone-400">跳过原因</div>
              <div className="mt-2 space-y-1.5">
                {Object.entries(preview.reasonCounts).map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between gap-3 text-sm text-stone-400">
                    <span>{BATCH_REASON_LABELS[reason as BatchVideoSkipReason]}</span>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {preview.issues.length > 0 ? (
            <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-3 text-sm text-rose-100">
              {preview.issues.map((issue) => <div key={issue}>{issue}</div>)}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-sm leading-6 text-amber-100">
                点击确认后会为 {preview.eligibleCount} 个镜头创建独立生成任务，已存在的视频不会覆盖。
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <StudioButton variant="secondary" onClick={onCancel} disabled={loading}>取消</StudioButton>
          <StudioButton icon="video" loading={loading} onClick={onConfirm} disabled={preview.eligibleCount === 0 || preview.issues.length > 0}>
            确认生成
          </StudioButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function booleanMapsEqual(
  left: Map<string, boolean>,
  right: Map<string, boolean>,
): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }
  return true
}

function translateFirstLastFrameKey(key: string): string {
  return key === 'firstLastFrame.thenTransitionTo' ? '然后自然过渡到' : key
}

function EmptyProduce({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <StudioEmptyState
      icon="video"
      title="没有可制作的镜头"
      description="先确认分镜图片，再进入单图视频和首尾帧视频制作。"
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
  promptState,
  voiceLineCountForItem,
}: {
  item: ProduceItem
  nextItem: ProduceItem | null
  linked: boolean
  linkSaving: boolean
  onToggleLink: () => Promise<void>
  firstLastFrameFlow: FirstLastFrameFlow
  promptState: VideoPromptState
  voiceLineCountForItem: (item: ProduceItem) => number
}) {
  const runtime = useWorkspaceStageRuntime()
  const { projectId, episodeId } = useWorkspaceProvider()
  const repairPromptMutation = useAiModifyProjectShotPrompt(projectId)
  const updateImagePromptMutation = useUpdateProjectPanelImagePrompt(projectId, episodeId || null)
  const regenerateImageMutation = useRegenerateProjectPanelImage(projectId)
  const initialModel = panelVideoModel(item.panel) || runtime.videoModel || runtime.userVideoModels[0]?.value || ''
  const panelKey = `${item.storyboard.id}-${item.panel.panelIndex}`
  const initialMode = item.panel.videoGenerationMode === 'firstlastframe' || linked ? 'firstlastframe' : 'normal'
  const [mode, setMode] = useState<'normal' | 'firstlastframe'>(initialMode)
  const [selectedModel, setSelectedModel] = useState(initialModel)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [repairDraft, setRepairDraft] = useState<VideoRepairDraft | null>(null)
  const videoUrl = panelVideoUrl(item.panel)
  const videoStatus = resolveVideoStatus(item.panel)
  const error = panelVideoError(item.panel)
  const videoErrorCode = item.panel.videoErrorCode || item.panel.lipSyncErrorCode || null
  const requestId = extractRequestId(error)
  const canAiRepair = isPolicyVideoError(videoErrorCode, error)
  const prompt = promptState.getLocalPrompt(panelKey, item.panel.videoPrompt || '', 'videoPrompt')
  const nextPanelKey = nextItem ? `${nextItem.storyboard.id}-${nextItem.panel.panelIndex}` : ''
  const currentDefaultPrompt = promptState.getLocalPrompt(panelKey, item.panel.videoPrompt || '', 'videoPrompt')
  const nextDefaultPrompt = nextItem
    ? promptState.getLocalPrompt(nextPanelKey, nextItem.panel.videoPrompt || '', 'videoPrompt')
    : ''
  const defaultFirstLastPrompt = firstLastFrameFlow.getDefaultFlPrompt(currentDefaultPrompt, nextDefaultPrompt)
  const firstLastExternalPrompt = firstLastFrameFlow.flCustomPrompts.has(panelKey)
    ? firstLastFrameFlow.flCustomPrompts.get(panelKey) ?? ''
    : item.panel.firstLastFramePrompt ?? defaultFirstLastPrompt
  const firstLastPrompt = promptState.isPromptDirty(panelKey, 'firstLastFramePrompt')
    ? promptState.getLocalPrompt(panelKey, firstLastExternalPrompt, 'firstLastFramePrompt')
    : firstLastExternalPrompt
  const flCapabilityFields = firstLastFrameFlow.getFlCapabilityFields(panelKey)
  const promptSaving = savingPrompt
    || promptState.savingPrompts.has(`videoPrompt:${panelKey}`)
    || promptState.savingPrompts.has(`firstLastFramePrompt:${panelKey}`)
  const currentVoiceLineCount = voiceLineCountForItem(item)
  const nextVoiceLineCount = nextItem ? voiceLineCountForItem(nextItem) : 0
  const currentVisualReady = isPanelVisualReadyForVideo(item.panel)
  const nextVisualReady = nextItem ? isPanelVisualReadyForVideo(nextItem.panel) : null
  const readinessMessage = !currentVisualReady
    ? (mode === 'firstlastframe' ? '首帧需要完成画面质量确认' : '当前画面需要完成质量确认')
    : mode === 'firstlastframe' && nextVisualReady === false
      ? '尾帧需要完成画面质量确认'
      : ''
  const missingFirstLastFrameSetup = !nextItem
    || !item.panel.imageUrl
    || !nextItem.panel.imageUrl
    || !linked
    || !firstLastFrameFlow.flModel
    || firstLastFrameFlow.flMissingCapabilityFields.length > 0

  useEffect(() => {
    setMode(initialMode)
    setSelectedModel(initialModel)
    setRepairDraft(null)
  }, [
    initialMode,
    initialModel,
    item.id,
  ])

  const saveNormalPrompt = async (): Promise<boolean> => {
    if (!promptState.isPromptDirty(panelKey, 'videoPrompt') && prompt === (item.panel.videoPrompt || '')) return true
    setSavingPrompt(true)
    try {
      await promptState.savePrompt(item.storyboard.id, item.panel.panelIndex, panelKey, prompt, 'videoPrompt', { throwOnError: true })
      return true
    } catch (saveError) {
      window.alert(saveError instanceof Error ? saveError.message : '保存视频提示词失败')
      return false
    } finally {
      setSavingPrompt(false)
    }
  }

  const saveFirstLastPrompt = async (): Promise<boolean> => {
    if (!promptState.isPromptDirty(panelKey, 'firstLastFramePrompt') && firstLastPrompt === (item.panel.firstLastFramePrompt ?? '')) return true
    setSavingPrompt(true)
    try {
      await promptState.savePrompt(item.storyboard.id, item.panel.panelIndex, panelKey, firstLastPrompt, 'firstLastFramePrompt', { throwOnError: true })
      return true
    } catch (saveError) {
      window.alert(saveError instanceof Error ? saveError.message : '保存首尾帧提示词失败')
      return false
    } finally {
      setSavingPrompt(false)
    }
  }

  const createAiRepairDraft = async () => {
    if (!error) return
    const activePrompt = mode === 'firstlastframe' ? firstLastPrompt : prompt
    try {
      const result = await repairPromptMutation.mutateAsync({
        panelId: item.panel.id,
        currentPrompt: item.panel.imagePrompt || item.panel.description || activePrompt,
        currentVideoPrompt: activePrompt,
        modifyInstruction: [
          '视频生成被供应商的版权或安全策略拦截，请在不改变剧情含义、镜头动作和主体关系的前提下改写提示词。',
          '删除或泛化可能触发版权、IP、明星、品牌、作品名、角色名、强风格模仿的表达。',
          '保留镜头运动、情绪、首尾帧衔接和画面连续性，只输出可用于重新生成的安全提示词。',
          `失败原因：${error}`,
          requestId ? `供应商 Request id：${requestId}` : '',
          mode === 'firstlastframe' && nextItem
            ? `首尾帧上下文：当前镜头过渡到镜头 ${nextItem.number}。`
            : '',
        ].filter(Boolean).join('\n'),
        referencedAssets: [],
      })
      setRepairDraft({
        mode,
        imagePrompt: result.modifiedImagePrompt || item.panel.imagePrompt || '',
        videoPrompt: result.modifiedVideoPrompt || activePrompt,
      })
    } catch (repairError) {
      window.alert(repairError instanceof Error ? repairError.message : 'AI 修复失败')
    }
  }

  const applyRepairDraft = async (retry: boolean) => {
    if (!repairDraft) return
    setSavingPrompt(true)
    setGenerating(retry)
    try {
      if (repairDraft.mode === 'firstlastframe') {
        firstLastFrameFlow.setFlCustomPrompt(panelKey, repairDraft.videoPrompt)
        promptState.updateLocalPrompt(panelKey, repairDraft.videoPrompt, 'firstLastFramePrompt')
        await promptState.savePrompt(item.storyboard.id, item.panel.panelIndex, panelKey, repairDraft.videoPrompt, 'firstLastFramePrompt', { throwOnError: true })
        setRepairDraft(null)
        if (retry) {
          if (missingFirstLastFrameSetup || !nextItem) return
          await runtime.onGenerateVideo(
            item.storyboard.id,
            item.panel.panelIndex,
            firstLastFrameFlow.flModel,
            {
              lastFrameStoryboardId: nextItem.storyboard.id,
              lastFramePanelIndex: nextItem.panel.panelIndex,
              flModel: firstLastFrameFlow.flModel,
              customPrompt: repairDraft.videoPrompt,
            },
            firstLastFrameFlow.getFlGenerationOptionsForPanel(panelKey),
            item.panel.id,
          )
        }
        return
      }

      promptState.updateLocalPrompt(panelKey, repairDraft.videoPrompt, 'videoPrompt')
      await promptState.savePrompt(item.storyboard.id, item.panel.panelIndex, panelKey, repairDraft.videoPrompt, 'videoPrompt', { throwOnError: true })
      setRepairDraft(null)
      if (retry) {
        if (!selectedModel.trim()) {
          window.alert('请先在设置中配置视频模型。')
          return
        }
        await runtime.onGenerateVideo(
          item.storyboard.id,
          item.panel.panelIndex,
          selectedModel,
          undefined,
          undefined,
          item.panel.id,
        )
      }
    } catch (applyError) {
      window.alert(applyError instanceof Error ? applyError.message : '应用 AI 修复失败')
    } finally {
      setSavingPrompt(false)
      setGenerating(false)
    }
  }

  const applyImageRepairDraft = async () => {
    if (!repairDraft || !repairDraft.imagePrompt.trim()) return
    setSavingPrompt(true)
    try {
      await updateImagePromptMutation.mutateAsync({
        panelId: item.panel.id,
        storyboardId: item.storyboard.id,
        panelIndex: item.panel.panelIndex,
        value: repairDraft.imagePrompt,
      })
      await regenerateImageMutation.mutateAsync({
        panelId: item.panel.id,
        count: 2,
        forceNoReference: true,
      })
      setRepairDraft(null)
    } catch (applyError) {
      window.alert(applyError instanceof Error ? applyError.message : '应用图片提示词并重新生图失败')
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
      if (readinessMessage) {
        window.alert(`${readinessMessage}，请先处理前置问题。`)
        return
      }
      if (mode === 'firstlastframe') {
        if (missingFirstLastFrameSetup || !nextItem) return
        if (!await saveFirstLastPrompt()) return
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
          firstLastFrameFlow.getFlGenerationOptionsForPanel(panelKey),
          item.panel.id,
        )
        return
      }

      if (!await saveNormalPrompt()) return
      if (!selectedModel.trim()) {
        window.alert('请先在设置中配置视频模型。')
        return
      }
      await runtime.onGenerateVideo(
        item.storyboard.id,
        item.panel.panelIndex,
        selectedModel,
        undefined,
        undefined,
        item.panel.id,
      )
    } catch {
      // Workspace video actions already surface the request error.
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
            {!videoUrl ? (
              <VisualQualityBadge
                state={item.panel.visualQualityState}
                className="absolute bottom-2 left-2 z-20"
              />
            ) : null}
          </div>
          {error ? (
            <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-3 text-xs text-rose-100">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">视频生成失败</div>
                  <p className="mt-1 break-words leading-5">{error}</p>
                  {requestId ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-rose-100/80">
                      <span>Request id: {requestId}</span>
                      <button type="button" className="rounded border border-rose-200/30 px-2 py-0.5 text-[11px] hover:bg-white/10" onClick={() => { void navigator.clipboard?.writeText(requestId) }}>
                        复制
                      </button>
                    </div>
                  ) : null}
                </div>
                {canAiRepair ? (
                  <StudioButton size="sm" variant="secondary" loading={repairPromptMutation.isPending} onClick={() => { void createAiRepairDraft() }}>
                    AI 修复
                  </StudioButton>
                ) : null}
              </div>
            </div>
          ) : null}
          {repairDraft ? (
            <div className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-3 text-xs text-cyan-50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">AI 修复草案</div>
                  <p className="mt-1 text-cyan-50/70">已泛化可能触发版权或安全策略的表达，确认后会保存到当前{repairDraft.mode === 'firstlastframe' ? '首尾帧' : '视频'}提示词。</p>
                </div>
              </div>
              <div className="mt-3 text-[11px] font-semibold text-cyan-50/70">视频提示词草案</div>
              <textarea
                value={repairDraft.videoPrompt}
                onChange={(event) => setRepairDraft({ ...repairDraft, videoPrompt: event.target.value })}
                rows={5}
                className="mt-3 w-full resize-y rounded-md border border-cyan-200/20 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-cyan-200/60"
              />
              {repairDraft.imagePrompt.trim() ? (
                <>
                  <div className="mt-3 text-[11px] font-semibold text-cyan-50/70">图片提示词草案</div>
                  <textarea
                    value={repairDraft.imagePrompt}
                    onChange={(event) => setRepairDraft({ ...repairDraft, imagePrompt: event.target.value })}
                    rows={4}
                    className="mt-2 w-full resize-y rounded-md border border-cyan-200/20 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-cyan-200/60"
                  />
                </>
              ) : null}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <StudioButton size="sm" variant="secondary" onClick={() => setRepairDraft(null)} disabled={promptSaving || generating}>取消</StudioButton>
                <StudioButton size="sm" variant="secondary" onClick={() => { void applyRepairDraft(false) }} loading={promptSaving && !generating}>应用</StudioButton>
                <StudioButton size="sm" variant="secondary" icon="imageLandscape" onClick={() => { void applyImageRepairDraft() }} loading={updateImagePromptMutation.isPending || regenerateImageMutation.isPending} disabled={!repairDraft.imagePrompt.trim() || promptSaving || generating}>
                  应用并重新生图
                </StudioButton>
                <StudioButton size="sm" icon="video" onClick={() => { void applyRepairDraft(true) }} loading={generating}>
                  应用并重新生成
                </StudioButton>
              </div>
            </div>
          ) : null}
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
              <textarea value={prompt} onChange={(event) => promptState.updateLocalPrompt(panelKey, event.target.value, 'videoPrompt')} onBlur={() => { void saveNormalPrompt() }} rows={6} className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" placeholder="描述视频运动、镜头节奏、主体动作和画面变化。" />
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
                    <VisualQualityBadge state={item.panel.visualQualityState} className="absolute right-1 top-1 z-20" />
                  </div>
                  <AppIcon name="arrowRight" className="h-4 w-4 text-stone-500" />
                  <div className="relative aspect-video overflow-hidden rounded bg-black">
                    {nextItem.panel.imageUrl ? <MediaImageWithLoading src={nextItem.panel.imageUrl} alt="尾帧" containerClassName="h-full w-full" className="h-full w-full object-cover" sizes="180px" /> : null}
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">尾帧 · 镜头 {nextItem.number}</span>
                    <VisualQualityBadge state={nextItem.panel.visualQualityState} className="absolute right-1 top-1 z-20" />
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

            {flCapabilityFields.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {flCapabilityFields.map((field) => (
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
              <textarea value={firstLastPrompt} onChange={(event) => {
                firstLastFrameFlow.setFlCustomPrompt(panelKey, event.target.value)
                promptState.updateLocalPrompt(panelKey, event.target.value, 'firstLastFramePrompt')
              }} onBlur={() => { void saveFirstLastPrompt() }} rows={6} className="mt-1 w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm font-normal leading-6 text-stone-100 outline-none focus:border-[#e8d18a]" placeholder="描述首帧如何自然变化到尾帧。" />
            </label>
          </div>
        )}

        <div className="rounded-md border border-white/10 bg-[#0f100e] px-3 py-3 text-xs leading-5 text-stone-400">
          <div className="font-semibold text-stone-300">台词与声音</div>
          <div className="mt-1">当前镜头：{currentVoiceLineCount > 0 ? `${currentVoiceLineCount} 条台词` : '无匹配台词，将按无旁白视频生成'}</div>
          {mode === 'firstlastframe' && nextItem ? (
            <div>尾帧镜头：{nextVoiceLineCount > 0 ? `${nextVoiceLineCount} 条台词` : '无匹配台词，将按无旁白视频生成'}</div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-stone-500">{promptSaving ? '提示词保存中' : readinessMessage || (mode === 'firstlastframe' && !linked ? '连接下一镜头后可生成' : '生成参数已就绪')}</span>
          <div className="flex gap-2">
            <StudioButton size="sm" variant="secondary" onClick={() => { void (mode === 'normal' ? saveNormalPrompt() : saveFirstLastPrompt()) }} disabled={promptSaving}>保存提示词</StudioButton>
            <StudioButton size="sm" icon="video" loading={generating || !!item.panel.videoTaskRunning} onClick={() => { void generate() }} disabled={!!readinessMessage || (mode === 'normal' ? !item.panel.imageUrl : missingFirstLastFrameSetup)}>
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
  const { storyboards: rawStoryboards, voiceLines } = useWorkspaceEpisodeStageData()
  const { taskAwareStoryboards } = useStoryboardTaskAwareStoryboards({
    projectId,
    initialStoryboards: rawStoryboards,
    isRunningPhase,
  })
  const updatePanelLinkMutation = useUpdateProjectPanelLink(projectId)
  const [selectedId, setSelectedId] = useState('')
  const [batchPreview, setBatchPreview] = useState<BatchPreviewState | null>(null)
  const [generatingMode, setGeneratingMode] = useState<BatchVideoMode | null>(null)
  const [linkSavingKey, setLinkSavingKey] = useState('')
  const items = useMemo(() => buildProduceItems(taskAwareStoryboards), [taskAwareStoryboards])
  const videoPanels = useMemo(() => toVideoPanels(items), [items])
  const persistedLinks = useMemo(() => new Map(items.map((item) => [`${item.storyboard.id}-${item.panel.panelIndex}`, panelLinkedToNext(item.panel)])), [items])
  const [linkedPanels, setLinkedPanels] = useState<Map<string, boolean>>(persistedLinks)
  const selectedIndex = items.findIndex((item) => item.id === selectedId)
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : items[0] || null
  const effectiveSelectedIndex = selectedItem ? items.findIndex((item) => item.id === selectedItem.id) : -1
  const nextItem = effectiveSelectedIndex >= 0 && effectiveSelectedIndex < items.length - 1 ? items[effectiveSelectedIndex + 1] : null
  const videoModel = runtime.videoModel || runtime.userVideoModels[0]?.value || ''
  const voiceLineCountForItem = useMemo(() => {
    const idsByPanelId = new Map<string, Set<string>>()
    const idsByPanelKey = new Map<string, Set<string>>()
    const add = (map: Map<string, Set<string>>, key: string, id: string) => {
      const set = map.get(key) || new Set<string>()
      set.add(id)
      map.set(key, set)
    }
    for (const line of voiceLines) {
      for (const binding of resolveVoiceLinePanelBindings(line)) {
        if (binding.panelId) add(idsByPanelId, binding.panelId, line.id)
        if (binding.storyboardId && binding.panelIndex !== undefined) {
          add(idsByPanelKey, `${binding.storyboardId}:${binding.panelIndex}`, line.id)
        }
      }
    }
    return (item: ProduceItem) => {
      const ids = new Set<string>()
      for (const id of idsByPanelId.get(item.panel.id) || []) ids.add(id)
      for (const id of idsByPanelKey.get(`${item.storyboard.id}:${item.panel.panelIndex}`) || []) ids.add(id)
      return ids.size
    }
  }, [voiceLines])
  const firstLastFrameFlow = useVideoFirstLastFrameFlow({
    allPanels: videoPanels,
    linkedPanels,
    videoModelOptions: runtime.userVideoModels,
    onGenerateVideo: runtime.onGenerateVideo,
    t: translateFirstLastFrameKey,
  })
  const promptState = useVideoPromptState({
    allPanels: videoPanels,
    onUpdateVideoPrompt: runtime.onUpdateVideoPrompt,
  })

  useEffect(() => {
    setLinkedPanels((current) => booleanMapsEqual(current, persistedLinks) ? current : persistedLinks)
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

  const buildBatchPreviewState = (mode: BatchVideoMode): BatchPreviewState => {
    const preflight = buildBatchVideoPreflight(items, linkedPanels, mode)
    const issues: string[] = []
    if (mode === 'normal' && !videoModel.trim()) issues.push('请先在设置中配置单图视频模型。')
    if (mode === 'firstlastframe') {
      if (!firstLastFrameFlow.flModel) issues.push('没有可用的首尾帧视频模型。')
      if (firstLastFrameFlow.flMissingCapabilityFields.length > 0) {
        issues.push(`首尾帧参数尚未完整：${firstLastFrameFlow.flMissingCapabilityFields.join('、')}`)
      }
    }
    return {
      ...preflight,
      issues,
    }
  }

  const openBatchPreview = (mode: BatchVideoMode) => {
    setBatchPreview(buildBatchPreviewState(mode))
  }

  const isBatchPromptEntry = (mode: BatchVideoMode, entry: DirtyPromptEntry) => {
    if (mode === 'normal') return entry.field === 'videoPrompt'
    return entry.field === 'videoPrompt' || entry.field === 'firstLastFramePrompt'
  }

  const saveDirtyPromptsForBatch = async (mode: BatchVideoMode): Promise<boolean> => {
    if (promptState.getDirtyPromptEntries((entry) => isBatchPromptEntry(mode, entry)).length === 0) return true
    try {
      await promptState.saveDirtyPrompts((entry) => isBatchPromptEntry(mode, entry))
      return true
    } catch (saveError) {
      window.alert(saveError instanceof Error ? saveError.message : '保存提示词失败，已停止批量生成。')
      return false
    }
  }

  const confirmBatchGeneration = async () => {
    if (!batchPreview) return
    const mode = batchPreview.mode
    const targetModel = mode === 'firstlastframe' ? firstLastFrameFlow.flModel : videoModel
    if (!targetModel.trim()) return
    setGeneratingMode(mode)
    try {
      if (!await saveDirtyPromptsForBatch(mode)) return
      await runtime.onGenerateAllVideos({
        videoModel: targetModel,
        mode,
        ...(mode === 'firstlastframe'
          ? { generationOptions: firstLastFrameFlow.getFlGenerationOptionsForBatch() }
          : {}),
      })
      setBatchPreview(null)
    } catch {
      // Workspace video actions already surface the request error.
    } finally {
      setGeneratingMode(null)
    }
  }

  if (items.length === 0 || model.productionItems.length === 0) return <EmptyProduce onNavigate={onNavigate} />

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151613]">
        <StudioStageHeader
          eyebrow="视频制作"
          title="镜头视频控制台"
          description="逐镜头选择单图或首尾帧模式，配置提示词、模型和连接关系，并跟进视频生成状态。"
          actions={(
            <div className="flex flex-wrap gap-2">
              <StudioButton variant="secondary" icon="video" loading={generatingMode === 'normal'} onClick={() => openBatchPreview('normal')} disabled={runtime.isTransitioning || !!generatingMode}>
                批量生成单图视频
              </StudioButton>
              <StudioButton icon="link" loading={generatingMode === 'firstlastframe'} onClick={() => openBatchPreview('firstlastframe')} disabled={runtime.isTransitioning || !!generatingMode}>
                批量生成首尾帧视频
              </StudioButton>
            </div>
          )}
        />

        <div className="grid gap-4 border-b border-white/10 px-6 py-4 sm:grid-cols-4">
          <StudioMetric label="镜头" value={items.length} />
          <StudioMetric label="图片完成" value={items.filter((item) => resolveImageStatus(item.panel) === 'locked').length} />
          <StudioMetric label="视频完成" value={items.filter((item) => panelVideoUrl(item.panel)).length} />
          <StudioMetric label="首尾帧连接" value={[...linkedPanels.values()].filter(Boolean).length} />
        </div>

        <div className="grid min-h-[620px] gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-[#10110f]">
            <div className="border-b border-white/10 px-4 py-4"><StudioSectionHeader title="镜头队列" description="按执行顺序查看图片、视频和首尾帧连接状态。" /></div>
            <div className="space-y-3 p-3">
              {items.map((item, index) => {
                const key = `${item.storyboard.id}-${item.panel.panelIndex}`
                const linked = linkedPanels.get(key) || false
                const followingItem = items[index + 1]
                const currentImageReady = isPanelVisualReadyForVideo(item.panel)
                const followingImageReady = followingItem ? isPanelVisualReadyForVideo(followingItem.panel) : false
                return (
                  <div key={item.id}>
                    <StudioProduceQueueRow item={item} linked={linked} selected={selectedItem?.id === item.id} voiceLineCount={voiceLineCountForItem(item)} onSelect={() => setSelectedId(item.id)} />
                    {followingItem ? (
                      <div className="flex items-center justify-center py-2">
                        <button
                          type="button"
                          onClick={() => { void toggleLink(item) }}
                          disabled={linkSavingKey === key || !currentImageReady || !followingImageReady}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${linked ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-[#0f100e] text-stone-500 hover:border-white/25 hover:text-stone-200'}`}
                          title={!currentImageReady || !followingImageReady ? '上下两个镜头都需要先确认图片' : linked ? '断开首尾帧连接' : '连接上下镜头为首尾帧'}
                        >
                          <AppIcon name={linkSavingKey === key ? 'loader' : linked ? 'unplug' : 'link'} className={`h-3.5 w-3.5 ${linkSavingKey === key ? 'animate-spin' : ''}`} />
                          {linked ? '断开与下一镜头的首尾帧连接' : '连接上下镜头为首尾帧'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
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
              promptState={promptState}
              voiceLineCountForItem={voiceLineCountForItem}
            />
          ) : null}
        </div>
      </section>

      {batchPreview ? (
        <BatchVideoConfirmDialog
          preview={batchPreview}
          loading={generatingMode === batchPreview.mode}
          onCancel={() => setBatchPreview(null)}
          onConfirm={() => { void confirmBatchGeneration() }}
        />
      ) : null}
    </div>
  )
}

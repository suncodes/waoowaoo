'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import EmotionSettingsPanel from './EmotionSettingsPanel'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState, type TaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'

interface VoiceLine {
    id: string
    lineIndex: number
    speaker: string
    content: string
    emotionPrompt: string | null
    emotionStrength: number | null
    audioUrl: string | null
    updatedAt: string | null
    lineTaskRunning: boolean
    matchedPanelId?: string | null
    matchedStoryboardId?: string | null
    matchedPanelIndex?: number | null
}

interface VoiceLineCardProps {
    line: VoiceLine
    nativeAudioMode?: boolean
    isVoiceTaskRunning: boolean
    statusState?: TaskPresentationState | null
    isPlaying: boolean
    hasVoice: boolean
    onTogglePlay: (lineId: string, audioUrl: string) => void
    onDownload: (audioUrl: string) => void
    onGenerate: (lineId: string) => void
    onEdit: (line: VoiceLine) => void
    onLocatePanel?: (line: VoiceLine) => void
    onDelete: (lineId: string) => void
    onDeleteAudio: (lineId: string) => void
    onSaveEmotionSettings: (lineId: string, emotionPrompt: string | null, emotionStrength: number) => void
}

export default function VoiceLineCard({
    line,
    nativeAudioMode = false,
    isVoiceTaskRunning,
    statusState,
    isPlaying,
    hasVoice,
    onTogglePlay,
    onDownload,
    onGenerate,
    onEdit,
    onLocatePanel,
    onDelete,
    onDeleteAudio,
    onSaveEmotionSettings
}: VoiceLineCardProps) {
    const t = useTranslations('voice')
    const [isEmotionExpanded, setIsEmotionExpanded] = useState(false)
    const hasPanelBinding = !!onLocatePanel && !!line.matchedStoryboardId && line.matchedPanelIndex !== null && line.matchedPanelIndex !== undefined
    const locateTitle = t("lineCard.locateVideo")
    const inlineStatusState = isVoiceTaskRunning
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'audio',
            hasOutput: !!line.audioUrl,
        })
        : statusState ?? null

    return (
        <div
            className={`relative overflow-hidden rounded-md border border-white/10 bg-[#151613] transition-colors hover:border-white/20 ${line.audioUrl ? 'ring-1 ring-emerald-400/40' : hasVoice ? '' : 'ring-1 ring-amber-400/40'
                }`}
        >
            {/* 顶部：播放/生成区域 */}
            <div className={`h-14 flex items-center justify-center gap-3 ${line.audioUrl
                ? 'bg-emerald-400/10'
                : 'bg-white/[0.04]'
                }`}>
                {nativeAudioMode ? (
                    <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-stone-200">
                        <AppIcon name="mic" className="h-4 w-4 text-[#e8d18a]" />
                        <span>台词计划</span>
                    </div>
                ) : line.audioUrl ? (
                    <div className="flex items-center justify-center gap-3">
                        {/* 播放按钮 */}
                        <button
                            onClick={() => onTogglePlay(line.id, line.audioUrl!)}
                            className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500 text-white transition-colors hover:bg-emerald-400"
                            title={isPlaying ? t("lineCard.pause") : t("lineCard.play")}
                        >
                            {isPlaying ? (
                                <AppIcon name="pauseSolid" className="w-4 h-4" />
                            ) : (
                                <AppIcon name="play" className="w-4 h-4" />
                            )}
                        </button>
                        {/* 重新生成按钮 */}
                        <button
                            onClick={() => onGenerate(line.id)}
                            disabled={!hasVoice || isVoiceTaskRunning}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100 disabled:opacity-50"
                            title={t("common.regenerate")}
                        >
                            {isVoiceTaskRunning ? (
                                <TaskStatusInline state={inlineStatusState} className="[&_span]:sr-only [&_svg]:text-current" />
                            ) : (
                                <AppIcon name="refresh" className="w-3.5 h-3.5" />
                            )}
                        </button>
                        {/* 下载按钮 */}
                        <button
                            onClick={() => onDownload(line.audioUrl!)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100"
                            title={t("common.download")}
                        >
                            <AppIcon name="download" className="w-4 h-4" />
                        </button>
                    </div>
                ) : isVoiceTaskRunning ? (
                    /* 生成中状态：显示状态指示器 */
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 rounded-md bg-[#e8d18a] px-5 py-2 text-sm font-semibold text-[#161512]">
                            <TaskStatusInline state={inlineStatusState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        </div>
                    </div>
                ) : (
                    /* 生成按钮 */
                    <button
                        onClick={() => onGenerate(line.id)}
                        disabled={!hasVoice}
                        className="flex items-center gap-2 rounded-md bg-[#f3e9cf] px-5 py-2 text-sm font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <AppIcon name="mic" className="w-4 h-4" />
                        {t("common.generate")}
                    </button>
                )}
            </div>

            {/* 序号标签 */}
            <div className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                #{line.lineIndex}
            </div>

            {/* 状态标签+删除配音按钮 */}
            {
                line.audioUrl && !nativeAudioMode && (
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                        <div className="flex items-center justify-center rounded bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">
                            <AppIcon name="checkXs" className="h-3 w-3" />
                        </div>
                        <button
                            onClick={() => onDeleteAudio(line.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500 text-white transition-colors hover:bg-amber-400"
                            title={t("lineCard.deleteAudio")}
                        >
                            <AppIcon name="close" className="w-3 h-3" />
                        </button>
                    </div>
                )
            }

            {/* 中间：台词内容 */}
            <div className="px-4 py-3">
                <div className="group">
                    <p className="line-clamp-3 text-sm leading-relaxed text-stone-300" title={line.content}>
                        {line.content}
                    </p>
                    {/* 操作按钮组 */}
                    <div className="mt-2 flex justify-end gap-0.5">
                        {hasPanelBinding && (
                            <button
                                onClick={() => onLocatePanel?.(line)}
                                className="rounded-md border border-white/10 px-2 py-1 text-[11px] leading-none text-stone-500 transition-colors hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-cyan-100"
                                title={locateTitle}
                            >
                                <span>{t("lineCard.locateVideo")}</span>
                            </button>
                        )}
                        <button
                            onClick={() => onEdit(line)}
                            className="rounded p-1 text-stone-500 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100"
                            title={t("lineCard.editLine")}
                        >
                            <AppIcon name="editSquare" className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => onDelete(line.id)}
                            className="rounded p-1 text-stone-500 transition-colors hover:bg-rose-400/10 hover:text-rose-200"
                            title={t("lineCard.deleteLine")}
                        >
                            <AppIcon name="trash" className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* 情绪设置面板 */}
            {
                hasVoice && (
                    <>
                        <button
                            onClick={() => setIsEmotionExpanded(!isEmotionExpanded)}
                            className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 px-4 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/10"
                        >
                            <AppIcon name="chevronDown" className={`w-3.5 h-3.5 transition-transform ${isEmotionExpanded ? 'rotate-180' : ''}`} />
                            {line.emotionPrompt || (line.emotionStrength !== null && line.emotionStrength !== 0.4)
                                ? t("lineCard.emotionConfigured")
                                : t("lineCard.emotionSettings")}
                        </button>

                        {isEmotionExpanded && (
                            <EmotionSettingsPanel
                                lineId={line.id}
                                emotionPrompt={line.emotionPrompt}
                                emotionStrength={line.emotionStrength ?? 0.4}
                                onSave={onSaveEmotionSettings}
                                onGenerate={onGenerate}
                                isVoiceGenerationRunning={isVoiceTaskRunning}
                                nativeAudioMode={nativeAudioMode}
                            />
                        )}
                    </>
                )
            }

            {/* 底部：发言人 */}
            <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-white/[0.03] px-4 py-2.5">
                <span className="inline-flex max-w-[160px] items-center truncate rounded bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-100" title={line.speaker}>
                    {line.speaker}
                </span>
                {hasVoice ? (
                    <span className="text-xs font-medium text-emerald-200">{t("lineCard.voiceConfigured")}</span>
                ) : (
                    <span className="text-xs font-medium text-amber-200">{t("lineCard.needVoice")}</span>
                )}
            </div>
        </div >
    )
}

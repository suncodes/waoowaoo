'use client'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'

interface VoiceToolbarProps {
    onBack?: () => void
    onAddLine: () => void
    onAnalyze: () => void
    onGenerateAll: () => void
    onDownloadAll: () => void
    analyzing: boolean
    isBatchSubmitting: boolean
    runningCount: number
    isDownloading: boolean
    allSpeakersHaveVoice: boolean
    totalLines: number
    linesWithVoice: number
    linesWithAudio: number
}

export default function VoiceToolbar({
    onBack,
    onAddLine,
    onAnalyze,
    onGenerateAll,
    onDownloadAll,
    analyzing,
    isBatchSubmitting,
    runningCount,
    isDownloading,
    allSpeakersHaveVoice,
    totalLines,
    linesWithVoice,
    linesWithAudio
}: VoiceToolbarProps) {
    const t = useTranslations('voice')
    const voiceTaskRunningState = isBatchSubmitting
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'audio',
            hasOutput: linesWithAudio > 0,
        })
        : null
    const voiceDownloadRunningState = isDownloading
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: 'audio',
            hasOutput: linesWithAudio > 0,
        })
        : null

    return (
        <div className="rounded-lg border border-white/10 bg-[#151613] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={onBack}
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-stone-200 hover:bg-white/[0.08]"
                    >
                        {t("toolbar.back")}
                    </button>
                    <button
                        onClick={onAnalyze}
                        disabled={analyzing}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-[#f3e9cf] px-4 text-sm font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        {analyzing ? t("assets.stage.analyzing") : t("toolbar.analyzeLines")}
                    </button>
                    <button
                        onClick={onAddLine}
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-stone-200 hover:bg-white/[0.08]"
                    >
                        {t("toolbar.addLine")}
                    </button>
                    <button
                        onClick={onGenerateAll}
                        disabled={isBatchSubmitting || !allSpeakersHaveVoice || totalLines === 0}
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-45"
                        title={!allSpeakersHaveVoice ? t("toolbar.uploadReferenceHint") : ''}
                    >
                        {isBatchSubmitting ? (
                            <>
                                <TaskStatusInline state={voiceTaskRunningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                                <span className="text-xs text-white/90">({runningCount})</span>
                            </>
                        ) : t("toolbar.generateAll")}
                    </button>
                    <button
                        onClick={onDownloadAll}
                        disabled={linesWithAudio === 0 || isDownloading}
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-45"
                        title={linesWithAudio === 0 ? t("toolbar.noDownload") : t("toolbar.downloadCount", { count: linesWithAudio })}
                    >
                        {isDownloading ? (
                            <TaskStatusInline state={voiceDownloadRunningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        ) : t("toolbar.downloadAll")}
                    </button>
                </div>
                <div className="text-sm text-stone-500">
                    {t("toolbar.stats", { total: totalLines, withVoice: linesWithVoice, withAudio: linesWithAudio })}
                </div>
            </div>
        </div>
    )
}

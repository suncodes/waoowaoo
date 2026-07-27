'use client'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'

interface EmbeddedVoiceToolbarProps {
    totalLines: number
    linesWithAudio: number
    analyzing: boolean
    rebuildingSpeechPlan?: boolean
    isDownloading: boolean
    isBatchSubmitting: boolean
    runningCount: number
    allSpeakersHaveVoice: boolean
    nativeAudioMode?: boolean
    onAddLine: () => void
    onAnalyze: () => void
    onRebuildSpeechPlans?: () => void
    onDownloadAll: () => void
    onGenerateAll: () => void
}

export default function EmbeddedVoiceToolbar({
    totalLines,
    linesWithAudio,
    analyzing,
    rebuildingSpeechPlan = false,
    isDownloading,
    isBatchSubmitting,
    runningCount,
    allSpeakersHaveVoice,
    nativeAudioMode = false,
    onAddLine,
    onAnalyze,
    onRebuildSpeechPlans,
    onDownloadAll,
    onGenerateAll
}: EmbeddedVoiceToolbarProps) {
    const t = useTranslations('voice')
    const voiceTaskRunningState = isBatchSubmitting
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'audio',
            hasOutput: linesWithAudio > 0,
        })
        : null
    const voiceAnalyzingState = analyzing
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'text',
            hasOutput: false,
        })
        : null
    const speechPlanRebuildingState = rebuildingSpeechPlan
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: 'text',
            hasOutput: totalLines > 0,
        })
        : null
    const voiceDownloadingState = isDownloading
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'audio',
            hasOutput: linesWithAudio > 0,
        })
        : null

    const getGenerateButtonTitle = () => {
        if (isBatchSubmitting) return t("embedded.generatingHint")
        if (!allSpeakersHaveVoice) return t("embedded.noVoiceHint")
        if (totalLines === 0) return t("embedded.noLinesHint")
        if (linesWithAudio >= totalLines) return t("embedded.allDoneHint")
        return t("embedded.generateHint", { count: totalLines - linesWithAudio })
    }

    return (
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#151613] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs text-stone-500">
                    {nativeAudioMode
                        ? `台词 ${totalLines} 条，视频生成时使用支持模型的原生音频`
                        : t("embedded.linesStats", { total: totalLines, audio: linesWithAudio })}
                </div>

                {/* 重新分析按钮 */}
                <button
                    onClick={onAnalyze}
                    disabled={analyzing}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-50"
                    title={totalLines > 0 ? t("embedded.reanalyzeHint") : t("embedded.analyzeHint")}
                >
                    {analyzing ? (
                        <TaskStatusInline state={voiceAnalyzingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                    ) : totalLines > 0 ? t("embedded.reanalyze") : t("embedded.analyzeLines")}
                </button>

                <button
                    onClick={onAddLine}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]"
                >
                    {t("embedded.addLine")}
                </button>

                {nativeAudioMode && onRebuildSpeechPlans ? (
                    <button
                        onClick={onRebuildSpeechPlans}
                        disabled={rebuildingSpeechPlan}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {rebuildingSpeechPlan ? (
                            <TaskStatusInline state={speechPlanRebuildingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        ) : '重建台词计划'}
                    </button>
                ) : null}

                {!nativeAudioMode ? (
                    <>
                        {/* 下载按钮 */}
                        <button
                            onClick={onDownloadAll}
                            disabled={linesWithAudio === 0 || isDownloading}
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            title={linesWithAudio === 0 ? t("toolbar.noDownload") : t("toolbar.downloadCount", { count: linesWithAudio })}
                        >
                            {isDownloading ? (
                                <TaskStatusInline state={voiceDownloadingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                            ) : (
                                <>{t("embedded.downloadVoice")}</>
                            )}
                        </button>

                        {/* 生成全部按钮 */}
                        <button
                            onClick={onGenerateAll}
                            disabled={isBatchSubmitting || !allSpeakersHaveVoice || totalLines === 0}
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            title={getGenerateButtonTitle()}
                        >
                            {isBatchSubmitting ? (
                                <>
                                    <TaskStatusInline state={voiceTaskRunningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                                    <span className="text-xs text-white/90">{t("embedded.generatingProgress", { current: runningCount, total: totalLines - linesWithAudio })}</span>
                                </>
                            ) : (
                                <>
                                    {t("embedded.generateAllVoice")}
                                    {linesWithAudio > 0 && (
                                        <span className="text-xs opacity-75">{t("embedded.pendingCount", { count: totalLines - linesWithAudio })}</span>
                                    )}
                                </>
                            )}
                        </button>
                    </>
                ) : null}
            </div>
        </div>
    )
}

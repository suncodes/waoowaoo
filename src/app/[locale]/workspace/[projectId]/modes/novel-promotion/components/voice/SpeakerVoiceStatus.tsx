'use client'
import { useTranslations } from 'next-intl'

interface SpeakerVoiceStatusProps {
    speakers: string[]
    speakerStats: Record<string, number>
    hasSpeakerVoiceBinding: (speaker: string) => boolean
    onOpenAssetLibrary: (speaker: string) => void
    /** 内联绑定回调：当发言人不在资产库中时调用 */
    onOpenInlineBinding?: (speaker: string) => void
    /** 判断发言人是否有匹配的项目角色 */
    hasSpeakerCharacter?: (speaker: string) => boolean
    embedded?: boolean
}

export default function SpeakerVoiceStatus({
    speakers,
    speakerStats,
    hasSpeakerVoiceBinding,
    onOpenAssetLibrary,
    onOpenInlineBinding,
    hasSpeakerCharacter,
    embedded = false
}: SpeakerVoiceStatusProps) {
    const t = useTranslations('voice')

    if (speakers.length === 0) return null

    /**
     * 点击"音色设置"按钮的处理逻辑：
     * - 有匹配的项目角色 → 跳转资产中心（现有行为）
     * - 无匹配的项目角色 → 打开内联绑定弹窗
     */
    const handleVoiceSettings = (speaker: string) => {
        const hasCharacter = hasSpeakerCharacter ? hasSpeakerCharacter(speaker) : true
        if (hasCharacter || !onOpenInlineBinding) {
            onOpenAssetLibrary(speaker)
        } else {
            onOpenInlineBinding(speaker)
        }
    }

    // 嵌入模式：紧凑布局
    if (embedded) {
        return (
            <div className="mx-4 mb-3 rounded-md border border-white/10 bg-[#151613] px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-stone-100">{t("embedded.speakerVoiceStatus")}</h4>
                    <span className="text-xs text-stone-500">{t("embedded.speakersCount", { count: speakers.length })}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {speakers.map(speaker => {
                        const hasVoice = hasSpeakerVoiceBinding(speaker)
                        const count = speakerStats[speaker]
                        const hasCharacter = hasSpeakerCharacter ? hasSpeakerCharacter(speaker) : true
                        return (
                            <div
                                key={speaker}
                                className="flex w-full max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 sm:w-[280px]"
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-stone-100">{speaker}</div>
                                    <div className="text-xs text-stone-500">{t("speakerVoice.linesCount", { count })}</div>
                                </div>
                                <span className={`text-xs px-2 py-1 rounded-full ${hasVoice
                                    ? 'bg-emerald-400/10 text-emerald-200'
                                    : 'bg-amber-400/10 text-amber-200'
                                    }`}>
                                    {hasVoice ? t("speakerVoice.configuredStatus") : t("speakerVoice.pendingStatus")}
                                </span>
                                {/* 无匹配角色时显示内联标记 */}
                                {!hasCharacter && !hasVoice && (
                                    <span className="rounded-full bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-100">
                                        {t("speakerVoice.inlineLabel")}
                                    </span>
                                )}
                                <button
                                    onClick={() => handleVoiceSettings(speaker)}
                                    className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]"
                                >
                                    {t("speakerVoice.voiceSettings")}
                                </button>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    // 标准模式：完整布局
    return (
        <div className="rounded-md border border-white/10 bg-[#151613] p-5">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-stone-100">
                <span className="h-5 w-1.5 rounded-full bg-[#e8d18a]" />
                {t("speakerVoice.title")}
                    <span className="ml-2 text-sm font-normal text-stone-500">
                    （{t("speakerVoice.hint")}）
                </span>
            </h3>
            <div className="flex flex-wrap gap-2">
                {speakers.map(speaker => {
                    const hasVoice = hasSpeakerVoiceBinding(speaker)
                    const hasCharacter = hasSpeakerCharacter ? hasSpeakerCharacter(speaker) : true

                    return (
                    <div key={speaker} className="flex w-full max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 sm:w-[280px]">
                            <div className="min-w-0">
                                <div className="truncate font-semibold text-stone-100" title={speaker}>{speaker}</div>
                                <div className="text-xs text-stone-500">{t("speakerVoice.linesCount", { count: speakerStats[speaker] })}</div>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-xs ${hasVoice ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>
                                {hasVoice ? t("speakerVoice.configuredStatus") : t("speakerVoice.pendingStatus")}
                            </span>
                            {/* 无匹配角色时显示内联标记 */}
                            {!hasCharacter && !hasVoice && (
                                <span className="rounded-full bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-100">
                                    {t("speakerVoice.inlineLabel")}
                                </span>
                            )}
                            <button
                                onClick={() => handleVoiceSettings(speaker)}
                                className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]"
                            >
                                {t("speakerVoice.voiceSettings")}
                            </button>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

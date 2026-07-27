'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'

interface EmotionSettingsPanelProps {
    lineId: string
    emotionPrompt: string | null
    emotionStrength: number
    onSave: (lineId: string, emotionPrompt: string | null, emotionStrength: number) => void
    onGenerate: (lineId: string) => void
    isVoiceGenerationRunning: boolean
    nativeAudioMode?: boolean
}

export default function EmotionSettingsPanel({
    lineId,
    emotionPrompt,
    emotionStrength,
    onSave,
    onGenerate,
    isVoiceGenerationRunning,
    nativeAudioMode = false
}: EmotionSettingsPanelProps) {
    const t = useTranslations('voice')
    const voiceGenerationState = isVoiceGenerationRunning
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'audio',
            hasOutput: false,
        })
        : null
    const [prompt, setPrompt] = useState(emotionPrompt || '')
    const [strength, setStrength] = useState(emotionStrength)

    const handlePromptChange = (value: string) => {
        setPrompt(value)
    }

    const handleStrengthChange = (value: number) => {
        setStrength(value)
    }

    const handleGenerate = () => {
        onSave(lineId, prompt.trim() || null, strength)
        onGenerate(lineId)
    }

    const handleSaveOnly = () => {
        onSave(lineId, prompt.trim() || null, strength)
    }

    return (
        <div className="space-y-3 border-t border-white/10 bg-cyan-400/[0.06] px-4 py-3">
            {/* 情绪提示词 */}
            <div>
                <label className="mb-1.5 block text-xs font-semibold text-cyan-100">
                    {t("emotionPrompt")} <span className="font-normal text-stone-500">{t("emotionPromptTip")}</span>
                </label>
                <input
                    type="text"
                    value={prompt}
                    onChange={(e) => handlePromptChange(e.target.value)}
                    placeholder={t("emotionPlaceholder")}
                    className="h-9 w-full rounded-md border border-white/10 bg-[#10110f] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
                />
            </div>

            {/* 情绪强度滑块 */}
            <div>
                <label className="mb-1.5 block text-xs font-semibold text-cyan-100">
                    {t("emotionStrength")}: <span className="font-bold">{strength.toFixed(1)}</span>
                </label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={strength}
                    onChange={(e) => handleStrengthChange(parseFloat(e.target.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#e8d18a]"
                />
                <div className="mt-1 flex justify-between text-[10px] text-stone-500">
                    <span>{t("flat")}</span>
                    <span>{t("intense")}</span>
                </div>
            </div>

            {/* 保存/生成语音按钮 */}
            <button
                onClick={nativeAudioMode ? handleSaveOnly : handleGenerate}
                disabled={!nativeAudioMode && isVoiceGenerationRunning}
                className="w-full rounded-md bg-emerald-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {!nativeAudioMode && isVoiceGenerationRunning ? (
                    <TaskStatusInline state={voiceGenerationState} className="justify-center text-white [&>span]:text-white [&_svg]:text-white" />
                ) : nativeAudioMode ? '保存声音提示' : t("generateVoice")}
            </button>
        </div>
    )
}

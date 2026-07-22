'use client'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'

interface EmptyVoiceStateProps {
    onAnalyze: () => void
    analyzing: boolean
}

export default function EmptyVoiceState({
    onAnalyze,
    analyzing
}: EmptyVoiceStateProps) {
    const t = useTranslations('voice')
    const analyzingState = analyzing
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'analyze',
            resource: 'text',
            hasOutput: false,
        })
        : null

    return (
        <div className="rounded-md border border-dashed border-white/15 bg-[#151613] p-10 text-center">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-md bg-cyan-400/10 text-cyan-100">
                <AppIcon name="micOutline" className="h-7 w-7" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-stone-100">{t("empty.title")}</h3>
            <p className="mb-6 text-stone-500">{t("empty.description")}</p>
            <button
                onClick={onAnalyze}
                disabled={analyzing}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#f3e9cf] px-5 text-sm font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-50"
            >
                {analyzing ? (
                    <TaskStatusInline state={analyzingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                ) : (
                    <>
                        <AppIcon name="clipboardCheck" className="w-5 h-5" />
                        {t("empty.analyzeButton")}
                    </>
                )}
            </button>
            <p className="mt-6 text-sm text-stone-500">
                {t("empty.hint")}
            </p>
        </div>
    )
}

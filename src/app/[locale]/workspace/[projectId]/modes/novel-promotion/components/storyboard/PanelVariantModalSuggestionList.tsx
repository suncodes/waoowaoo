'use client'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import type { TaskPresentationState } from '@/lib/task/presentation'
import type { ShotVariantSuggestion } from './PanelVariantModal.types'

interface PanelVariantModalSuggestionListProps {
  isAnalyzing: boolean
  suggestions: ShotVariantSuggestion[]
  error: string | null
  selectedVariantId: number | null
  isSubmittingVariantTask: boolean
  analyzeTaskRunningState: TaskPresentationState | null
  variantTaskRunningState: TaskPresentationState | null
  onReanalyze: () => void
  onSelectVariant: (suggestion: ShotVariantSuggestion) => void
}

export default function PanelVariantModalSuggestionList({
  isAnalyzing,
  suggestions,
  error,
  selectedVariantId,
  isSubmittingVariantTask,
  analyzeTaskRunningState,
  variantTaskRunningState,
  onReanalyze,
  onSelectVariant,
}: PanelVariantModalSuggestionListProps) {
  const t = useTranslations('storyboard')
  const renderScore = (score: number) => t('variant.creativeScore', { score })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-200">
          {t('variant.aiRecommend')}
          {isAnalyzing && (
            <TaskStatusInline
              state={analyzeTaskRunningState}
              className="text-cyan-200 [&>span]:text-cyan-200 [&_svg]:text-cyan-200"
            />
          )}
        </h3>
        {!isAnalyzing && suggestions.length > 0 && (
          <button
            onClick={onReanalyze}
            className="text-xs text-cyan-200 hover:text-white"
          >
            {t('variant.reanalyze')}
          </button>
        )}
      </div>

      {error && (
          <div className="mb-3 rounded-md border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className={`cursor-pointer rounded-md border p-3 transition-colors ${selectedVariantId === suggestion.id ? 'border-[#e8d18a]/60 bg-[#1b1a14]' : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'}`}
            onClick={() => !isSubmittingVariantTask && onSelectVariant(suggestion)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-200">{renderScore(suggestion.creative_score)}</span>
                  <h4 className="text-sm font-semibold text-stone-100">{suggestion.title}</h4>
                </div>
                <p className="mt-1 text-xs text-stone-400">{suggestion.description}</p>
                <div className="mt-1 flex gap-2">
                  <span className="text-xs text-stone-500">{t('variant.shotType')} {suggestion.shot_type}</span>
                  <span className="text-xs text-stone-500">{t('variant.cameraMove')} {suggestion.camera_move}</span>
                </div>
              </div>
              <button
                disabled={isSubmittingVariantTask}
                className="rounded-md bg-[#f3e9cf] px-3 py-1 text-xs font-semibold text-[#161512] disabled:opacity-50"
              >
                {isSubmittingVariantTask && selectedVariantId === suggestion.id ? (
                  <TaskStatusInline
                    state={variantTaskRunningState}
                    className="text-stone-500 [&>span]:text-stone-500 [&_svg]:text-stone-500"
                  />
                ) : t('candidate.select')}
              </button>
            </div>
          </div>
        ))}

        {!isAnalyzing && suggestions.length === 0 && !error && (
          <div className="py-8 text-center text-sm text-stone-500">
            {t('variant.clickToAnalyze')}
          </div>
        )}
      </div>
    </div>
  )
}

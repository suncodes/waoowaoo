'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import ProductModalShell from '@/components/product/ProductModalShell'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { useAnalyzeProjectShotVariants } from '@/lib/query/hooks'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import type { PanelInfo, ShotVariantSuggestion } from './PanelVariantModal.types'
import PanelVariantModalSuggestionList from './PanelVariantModalSuggestionList'
import PanelVariantModalCustomOptions from './PanelVariantModalCustomOptions'

interface PanelVariantModalProps {
  isOpen: boolean
  onClose: () => void
  panel: PanelInfo
  projectId: string
  onVariant: (variant: Omit<ShotVariantSuggestion, 'id' | 'creative_score'>, options: { includeCharacterAssets: boolean; includeLocationAsset: boolean }) => Promise<void>
  isSubmittingVariantTask: boolean
}

export default function PanelVariantModal({ isOpen, onClose, panel, projectId, onVariant, isSubmittingVariantTask }: PanelVariantModalProps) {
  const t = useTranslations('storyboard')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState<ShotVariantSuggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [customInput, setCustomInput] = useState('')
  const [includeCharacterAssets, setIncludeCharacterAssets] = useState(true)
  const [includeLocationAsset, setIncludeLocationAsset] = useState(true)
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null)
  const autoAnalyzeKeyRef = useRef<string | null>(null)
  const analyzingRef = useRef(false)
  const analyzeShotVariantsMutation = useAnalyzeProjectShotVariants(projectId)

  const analyzeShotVariants = useCallback(async () => {
    if (analyzingRef.current) return
    analyzingRef.current = true
    setIsAnalyzing(true)
    setError(null)
    setSuggestions([])
    try {
      const data = await analyzeShotVariantsMutation.mutateAsync({ panelId: panel.id })
      setSuggestions(data.suggestions || [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('variant.analyzeFailed'))
    } finally {
      setIsAnalyzing(false)
      analyzingRef.current = false
    }
  }, [analyzeShotVariantsMutation, panel.id, t])

  useEffect(() => {
    if (!isOpen || !panel.imageUrl) return
    const key = `${panel.id}:${panel.imageUrl}`
    if (autoAnalyzeKeyRef.current === key) return
    autoAnalyzeKeyRef.current = key
    void analyzeShotVariants()
  }, [analyzeShotVariants, isOpen, panel.id, panel.imageUrl])

  useEffect(() => {
    if (isOpen) return
    autoAnalyzeKeyRef.current = null
    analyzingRef.current = false
  }, [isOpen])

  const close = () => {
    if (isSubmittingVariantTask || isAnalyzing) return
    setSuggestions([])
    setError(null)
    setCustomInput('')
    setSelectedVariantId(null)
    onClose()
  }
  const selectVariant = async (suggestion: ShotVariantSuggestion) => {
    setSelectedVariantId(suggestion.id)
    await onVariant({ title: suggestion.title, description: suggestion.description, shot_type: suggestion.shot_type, camera_move: suggestion.camera_move, video_prompt: suggestion.video_prompt }, { includeCharacterAssets, includeLocationAsset })
  }
  const customVariant = async () => {
    if (!customInput.trim()) return
    await onVariant({ title: t('variant.customVariant'), description: customInput, shot_type: t('variant.defaultShotType'), camera_move: t('variant.defaultCameraMove'), video_prompt: customInput }, { includeCharacterAssets, includeLocationAsset })
  }
  const variantTaskState = isSubmittingVariantTask ? resolveTaskPresentationState({ phase: 'processing', intent: 'generate', resource: 'image', hasOutput: !!panel.imageUrl }) : null
  const analyzeTaskState = isAnalyzing ? resolveTaskPresentationState({ phase: 'processing', intent: 'analyze', resource: 'image', hasOutput: false }) : null

  return (
    <ProductModalShell open={isOpen} onClose={close} closeOnBackdrop={!isSubmittingVariantTask && !isAnalyzing} size="lg" eyebrow="镜头变体" title={t('variant.shotTitle', { number: panel.panelNumber ?? '' })} description="先比较 AI 推荐方案，再生成一个新的镜头版本。" footer={(
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={close} disabled={isSubmittingVariantTask || isAnalyzing} className="h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08] disabled:opacity-50">{t('candidate.cancel')}</button>
        <button type="button" onClick={() => { void customVariant() }} disabled={isSubmittingVariantTask || !customInput.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-4 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-45">
          {isSubmittingVariantTask ? <TaskStatusInline state={variantTaskState} /> : t('variant.useCustomGenerate')}
        </button>
      </div>
    )}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[128px_minmax(0,1fr)]">
          <div>
            {panel.imageUrl ? <MediaImageWithLoading src={panel.imageUrl} alt={t('variant.shotNum', { number: panel.panelNumber ?? '' })} containerClassName="aspect-[9/16] w-full rounded-md" className="h-full w-full rounded-md object-cover" sizes="128px" /> : <div className="flex aspect-[9/16] items-center justify-center rounded-md bg-[#10110f] text-xs text-stone-600">{t('variant.noImage')}</div>}
            <div className="mt-2 text-center text-xs text-stone-500">#{panel.panelNumber}</div>
          </div>
          <div><h3 className="text-sm font-semibold text-stone-200">{t('variant.originalDescription')}</h3><p className="mt-2 text-sm leading-6 text-stone-400">{panel.description || t('variant.noDescription')}</p></div>
        </div>
        <PanelVariantModalSuggestionList isAnalyzing={isAnalyzing} suggestions={suggestions} error={error} selectedVariantId={selectedVariantId} isSubmittingVariantTask={isSubmittingVariantTask} analyzeTaskRunningState={analyzeTaskState} variantTaskRunningState={variantTaskState} onReanalyze={analyzeShotVariants} onSelectVariant={(suggestion) => { void selectVariant(suggestion) }} />
        <PanelVariantModalCustomOptions customInput={customInput} includeCharacterAssets={includeCharacterAssets} includeLocationAsset={includeLocationAsset} isSubmittingVariantTask={isSubmittingVariantTask} onCustomInputChange={setCustomInput} onIncludeCharacterAssetsChange={setIncludeCharacterAssets} onIncludeLocationAssetChange={setIncludeLocationAsset} />
      </div>
    </ProductModalShell>
  )
}

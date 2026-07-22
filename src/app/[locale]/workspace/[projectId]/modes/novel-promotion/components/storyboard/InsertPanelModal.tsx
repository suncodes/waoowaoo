'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import ProductModalShell from '@/components/product/ProductModalShell'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'

interface PanelInfo {
  id: string
  panelNumber: number | null
  description: string | null
  imageUrl: string | null
}

interface InsertPanelModalProps {
  isOpen: boolean
  onClose: () => void
  prevPanel: PanelInfo
  nextPanel: PanelInfo | null
  onInsert: (userInput: string) => Promise<void>
  isInserting: boolean
}

function PanelPreview({ panel, fallback }: { panel: PanelInfo | null; fallback: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-center">
      {panel?.imageUrl ? (
        <MediaImageWithLoading src={panel.imageUrl} alt={panel.description || fallback} containerClassName="w-full aspect-[9/16] rounded-md" className="h-full w-full rounded-md object-cover" />
      ) : (
        <div className="flex aspect-[9/16] items-center justify-center rounded-md bg-[#10110f] px-3 text-xs text-stone-600">{fallback}</div>
      )}
      <div className="mt-2 text-xs text-stone-500">{panel ? `#${panel.panelNumber ?? '-'}` : fallback}</div>
    </div>
  )
}

export default function InsertPanelModal({ isOpen, onClose, prevPanel, nextPanel, onInsert, isInserting }: InsertPanelModalProps) {
  const t = useTranslations('storyboard')
  const [userInput, setUserInput] = useState('')
  const analyzingState = isInserting ? resolveTaskPresentationState({ phase: 'processing', intent: 'analyze', resource: 'text', hasOutput: true }) : null
  const insertingState = isInserting ? resolveTaskPresentationState({ phase: 'processing', intent: 'build', resource: 'text', hasOutput: true }) : null
  const close = () => {
    if (isInserting) return
    setUserInput('')
    onClose()
  }
  const submit = async (value: string) => {
    await onInsert(value)
    setUserInput('')
  }

  return (
    <ProductModalShell
      open={isOpen}
      onClose={close}
      closeOnBackdrop={!isInserting}
      size="md"
      eyebrow="镜头结构"
      title={t('insertModal.insertBetween', { before: prevPanel.panelNumber ?? 0, after: nextPanel?.panelNumber ?? '' })}
      description="结合前后镜头自动补全过渡，或输入明确的动作、画面和转场要求。"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-center gap-3">
          <PanelPreview panel={prevPanel} fallback={t('insertModal.noImage')} />
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[#e8d18a]/30 bg-[#e8d18a]/10 text-xl font-semibold text-[#e8d18a]">+</div>
          <PanelPreview panel={nextPanel} fallback={nextPanel ? t('insertModal.noImage') : t('insertModal.insertAtEnd')} />
        </div>
        <label className="block text-sm font-medium text-stone-300">
          镜头要求
          <textarea value={userInput} onChange={(event) => setUserInput(event.target.value)} placeholder={t('insertModal.placeholder')} rows={4} disabled={isInserting} className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#10110f] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a] disabled:opacity-60" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => { void submit('') }} disabled={isInserting} className="inline-flex h-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-stone-200 hover:bg-white/[0.08] disabled:opacity-50">
            {isInserting && !userInput ? <TaskStatusInline state={analyzingState} /> : t('insertModal.aiAnalyze')}
          </button>
          <button type="button" onClick={() => { void submit(userInput) }} disabled={isInserting || !userInput.trim()} className="inline-flex h-10 items-center justify-center rounded-md bg-[#f3e9cf] px-4 text-sm font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-45">
            {isInserting && userInput ? <TaskStatusInline state={insertingState} /> : t('insertModal.insert')}
          </button>
        </div>
      </div>
    </ProductModalShell>
  )
}

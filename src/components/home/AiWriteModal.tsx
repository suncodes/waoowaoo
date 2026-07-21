'use client'

/**
 * AI 帮我写 — 首页轻量模态框
 *
 * 用户输入创意/关键词/大纲，直接生成结果并回填首页主输入框
 */

import { useState, useCallback, useEffect } from 'react'
import { AppIcon } from '@/components/ui/icons'
import ProductModalShell from '@/components/product/ProductModalShell'

interface AiWriteModalProps {
  open: boolean
  loading: boolean
  onClose: () => void
  onStart: (prompt: string) => void
  t: (key: string) => string
  initialPrompt?: string
  title?: string
  description?: string
  placeholder?: string
  hint?: string
}

export default function AiWriteModal({
  open,
  loading,
  onClose,
  onStart,
  t,
  initialPrompt = '',
  title,
  description,
  placeholder,
  hint,
}: AiWriteModalProps) {
  const [promptText, setPromptText] = useState('')

  useEffect(() => {
    if (open) setPromptText(initialPrompt)
  }, [initialPrompt, open])

  const handleClose = useCallback(() => {
    if (loading) return
    setPromptText('')
    onClose()
  }, [loading, onClose])

  const handleStart = useCallback(() => {
    if (!promptText.trim() || loading) return
    onStart(promptText.trim())
  }, [promptText, loading, onStart])

  if (!open) return null

  return (
    <ProductModalShell
      open={open}
      onClose={handleClose}
      size="md"
      eyebrow="AI 写作"
      title={title || t('modalTitle')}
      description={description || t('modalSubtitle')}
      closeOnBackdrop={!loading}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={handleClose} disabled={loading} className="h-9 rounded-md border border-white/10 bg-white/[0.04] px-4 text-xs font-semibold text-stone-200 hover:bg-white/[0.08] disabled:opacity-45">
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={!promptText.trim() || loading}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-4 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <AppIcon name={loading ? 'loader' : 'sparkles'} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '生成中' : t('startAiWrite')}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <label className="block text-sm font-medium text-stone-300">
          {t('inputLabel')}
          <textarea
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            placeholder={placeholder || t('placeholder')}
            className="mt-2 h-44 w-full resize-y rounded-md border border-white/10 bg-[#10110f] px-4 py-3 text-sm leading-6 text-stone-100 outline-none placeholder:text-stone-600 focus:border-[#e8d18a]"
            disabled={loading}
            autoFocus
          />
        </label>
        <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-xs leading-5 text-stone-500">
          {hint || t('hint')}
        </div>
      </div>
    </ProductModalShell>
  )
}

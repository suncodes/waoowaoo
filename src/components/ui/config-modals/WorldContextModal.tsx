'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import ProductModalShell from '@/components/product/ProductModalShell'

interface WorldContextModalProps {
  isOpen: boolean
  onClose: () => void
  text: string
  onChange: (value: string) => void
}

export function WorldContextModal({ isOpen, onClose, text, onChange }: WorldContextModalProps) {
  const t = useTranslations('worldContextModal')
  const tc = useTranslations('common')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleTextChange = (value: string) => {
    onChange(value)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 500)
  }

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  if (!isOpen) return null

  return (
    <ProductModalShell
      open={isOpen}
      onClose={onClose}
      size="lg"
      eyebrow="Project Context"
      title={t('title')}
      description={t('description')}
      footer={<div className="flex items-center justify-between gap-3 text-xs text-stone-500"><span>{t('hint')}</span><span className={`inline-flex items-center gap-2 border px-3 py-1.5 ${saveStatus === 'saved' ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200' : 'border-white/10 bg-white/[0.04]'}`}>{saveStatus === 'saved' ? <AppIcon name="check" className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />}{saveStatus === 'saved' ? tc('saved') : tc('autoSave')}</span></div>}
    >
      <div className="flex min-h-[55vh] flex-col border border-white/10 bg-[#10110f] p-4">
          <textarea
            value={text}
            onChange={(event) => handleTextChange(event.target.value)}
            placeholder={t('placeholder')}
            className="app-scrollbar min-h-[55vh] flex-1 resize-none bg-[#0b0c0a] p-4 text-base leading-7 text-stone-100 outline-none placeholder:text-stone-600 focus:ring-1 focus:ring-[#e8d18a]/60"
          />
      </div>
    </ProductModalShell>
  )
}

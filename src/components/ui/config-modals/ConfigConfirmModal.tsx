'use client'

import { useTranslations } from 'next-intl'
import ProductModalShell from '@/components/product/ProductModalShell'

interface ConfigConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  confirmDisabled?: boolean
}

export function ConfigConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  danger = false,
  confirmDisabled = false,
}: ConfigConfirmModalProps) {
  const t = useTranslations('configModal')
  if (!isOpen) return null

  return (
    <ProductModalShell
      open={isOpen}
      onClose={onClose}
      size="md"
      title={title}
      description={description}
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="inline-flex h-10 items-center border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-stone-100 hover:bg-white/[0.08]">{cancelText || t('cancel')}</button>
          <button onClick={onConfirm} disabled={confirmDisabled} className={`inline-flex h-10 items-center px-4 text-sm font-semibold disabled:pointer-events-none disabled:opacity-50 ${danger ? 'bg-rose-300 text-[#251316] hover:bg-rose-200' : 'bg-[#e8d18a] text-[#171810] hover:bg-[#f3e9cf]'}`}>{confirmText || t('confirm')}</button>
        </div>
      )}
    >
      <div className="border border-white/10 bg-[#10110f] p-4 text-sm leading-6 text-stone-400">{description || title}</div>
    </ProductModalShell>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface ConfirmDialogProps {
  show: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  type?: 'danger' | 'warning' | 'info'
}

export default function ConfirmDialog({
  show,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  type = 'danger'
}: ConfirmDialogProps) {
  const t = useTranslations('common')

  const finalConfirmText = confirmText || t('confirm')
  const finalCancelText = cancelText || t('cancel')
  if (!show) return null

  const typeStyles = {
    danger: {
      icon: (
        <AppIcon name="alert" className="w-6 h-6 text-[var(--glass-tone-danger-fg)]" />
      ),
      confirmBg: 'glass-btn-tone-danger',
      iconBg: 'bg-[var(--glass-tone-danger-bg)]'
    },
    warning: {
      icon: (
        <AppIcon name="alert" className="w-6 h-6 text-[var(--glass-tone-warning-fg)]" />
      ),
      confirmBg: 'glass-btn-tone-warning',
      iconBg: 'bg-[var(--glass-tone-warning-bg)]'
    },
    info: {
      icon: (
        <AppIcon name="info" className="w-6 h-6 text-[var(--glass-tone-info-fg)]" />
      ),
      confirmBg: 'glass-btn-tone-info',
      iconBg: 'bg-[var(--glass-tone-info-bg)]'
    }
  }

  const currentStyle = typeStyles[type]

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
        <div
          className="w-full max-w-md animate-scale-in rounded-lg border border-white/10 bg-[#151613] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)]"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-md ${currentStyle.iconBg}`}>
            {currentStyle.icon}
          </div>

          <h3 className="mb-2 text-xl font-semibold text-stone-50">
            {title}
          </h3>

          <p className="mb-6 text-sm leading-6 text-stone-400">
            {message}
          </p>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-stone-100 hover:bg-white/[0.08]"
            >
              {finalCancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`glass-btn-base flex-1 rounded-md px-4 py-2.5 font-medium ${currentStyle.confirmBg}`}
            >
              {finalConfirmText}
            </button>
          </div>
        </div>
    </div>
  )
}

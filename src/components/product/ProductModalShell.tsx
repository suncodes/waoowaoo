'use client'

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/ui/icons'

interface ProductModalShellProps {
  open: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl'
  closeOnBackdrop?: boolean
}

const widthClass = {
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
}

export default function ProductModalShell({
  open,
  onClose,
  title,
  eyebrow,
  description,
  children,
  footer,
  size = 'lg',
  closeOnBackdrop = true,
}: ProductModalShellProps) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <section className={`flex max-h-[calc(100dvh-2rem)] w-full ${widthClass[size]} flex-col overflow-hidden rounded-lg border border-white/10 bg-[#151613] shadow-[0_30px_100px_rgba(0,0,0,0.55)] sm:max-h-[calc(100dvh-3rem)]`}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8a85f]">{eyebrow}</p> : null}
            <h2 className={`${eyebrow ? 'mt-1' : ''} truncate text-lg font-semibold text-stone-50`}>{title}</h2>
            {description ? <p className="mt-1 text-sm leading-6 text-stone-400">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-stone-200 hover:bg-white/[0.08]"
            aria-label="关闭"
            title="关闭"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 app-scrollbar sm:p-6">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-white/10 px-5 py-4 sm:px-6">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  )
}

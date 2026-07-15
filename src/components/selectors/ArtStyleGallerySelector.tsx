'use client'

import { useState } from 'react'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'

export interface ArtStyleGalleryOption {
  value: string
  label: string
  preview?: string
  previewImage?: string
  promptZh?: string
  promptEn?: string
  recommended?: boolean
}

interface ArtStyleGallerySelectorProps {
  value: string
  onChange: (value: string) => void
  options: readonly ArtStyleGalleryOption[]
  onAfterChange?: () => void
  className?: string
  columnsClassName?: string
  imageClassName?: string
  showPrompt?: boolean
}

function getPromptSummary(option: ArtStyleGalleryOption): string | null {
  const prompt = option.promptZh || option.promptEn || ''
  const normalized = prompt.trim()
  if (!normalized) return null
  return normalized.length > 34 ? `${normalized.slice(0, 34)}...` : normalized
}

function FallbackPreview({ option, selected }: { option: ArtStyleGalleryOption; selected: boolean }) {
  return (
    <div className={`flex h-full min-h-[84px] w-full items-center justify-center rounded-lg border text-lg font-semibold ${
      selected
        ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/10 text-[var(--glass-accent-from)]'
        : 'border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface-strong)] text-[var(--glass-text-tertiary)]'
    }`}>
      {option.preview || option.label.slice(0, 1)}
    </div>
  )
}

export function ArtStyleGallerySelector({
  value,
  onChange,
  options,
  onAfterChange,
  className = '',
  columnsClassName = 'grid-cols-2 sm:grid-cols-3',
  imageClassName = 'h-24 sm:h-28',
  showPrompt = true,
}: ArtStyleGallerySelectorProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  return (
    <>
      <div className={`grid ${columnsClassName} gap-2 ${className}`}>
        {options.map((option) => {
          const isSelected = value === option.value
          const promptSummary = showPrompt ? getPromptSummary(option) : null
          const title = promptSummary ? `${option.label}：${promptSummary}` : option.label

          return (
            <div
              key={option.value}
              role="button"
              tabIndex={0}
              onClick={() => {
                onChange(option.value)
                onAfterChange?.()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onChange(option.value)
                onAfterChange?.()
              }}
              title={title}
              className={`group relative overflow-hidden rounded-xl border text-left transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--glass-accent-from)] focus:ring-offset-2 focus:ring-offset-transparent cursor-pointer ${
                isSelected
                  ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/10 shadow-sm'
                  : 'border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface-strong)] hover:border-[var(--glass-stroke-strong)]'
              }`}
            >
              <div className={`relative w-full overflow-hidden rounded-t-xl ${imageClassName}`}>
                {option.previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={option.previewImage}
                    alt={option.label}
                    className="h-full w-full object-cover transition-opacity duration-200 group-hover:opacity-95"
                  />
                ) : (
                  <FallbackPreview option={option} selected={isSelected} />
                )}

                {option.previewImage ? (
                  <button
                    type="button"
                    aria-label={`预览 ${option.label}`}
                    title={`预览 ${option.label}`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setPreviewImage(option.previewImage || null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      setPreviewImage(option.previewImage || null)
                    }}
                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-90 shadow-sm transition-colors duration-200 hover:bg-black/75 focus:outline-none focus:ring-2 focus:ring-white cursor-zoom-in"
                  >
                    <AppIcon name="eye" className="h-4 w-4" />
                  </button>
                ) : null}

                {isSelected ? (
                  <span className="absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--glass-accent-from)] text-white shadow-sm">
                    <AppIcon name="check" className="h-4 w-4" />
                  </span>
                ) : null}
              </div>

              <div className="space-y-1 px-2.5 py-2">
                <div className={`truncate text-sm ${
                  isSelected
                    ? 'font-semibold text-[var(--glass-accent-from)]'
                    : 'font-medium text-[var(--glass-text-primary)]'
                }`}>
                  {option.label}
                </div>
                {promptSummary ? (
                  <div className="line-clamp-2 text-[11px] leading-snug text-[var(--glass-text-tertiary)]">
                    {promptSummary}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {previewImage ? (
        <ImagePreviewModal
          imageUrl={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
    </>
  )
}

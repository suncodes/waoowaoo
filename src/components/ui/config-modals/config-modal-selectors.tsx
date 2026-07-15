'use client'

/**
 * 项目配置弹窗专用选择器
 * 卡片边框风格：选中时蓝色描边 + 淡色背景 + 加粗文字
 */
import { useEffect, useRef, useState } from 'react'
import { ArtStyleGallerySelector, type ArtStyleGalleryOption } from '@/components/selectors/ArtStyleGallerySelector'
import { AppIcon } from '@/components/ui/icons'

interface RatioSelectorProps {
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
}

interface StyleSelectorProps {
  value: string
  onChange: (value: string) => void
  options: readonly ArtStyleGalleryOption[]
}

/** 线框比例预览块 */
function RatioShape({ ratio, selected, size = 26 }: { ratio: string; selected: boolean; size?: number }) {
  const [w, h] = ratio.split(':').map(Number)
  const max = Math.max(w, h)
  return (
    <div
      className={`rounded-md border-2 transition-colors ${
        selected ? 'border-[var(--glass-accent-from)]' : 'border-[var(--glass-stroke-strong)]'
      }`}
      style={{
        width: Math.min(size, size * (w / max)),
        height: Math.min(size, size * (h / max)),
      }}
    />
  )
}

export function RatioSelector({ value, onChange, options }: RatioSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find((option) => option.value === value)

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="glass-input-base h-11 px-3 flex items-center justify-between gap-2 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <RatioShape ratio={value} size={18} selected />
          <span className="text-sm text-[var(--glass-text-primary)] font-medium">
            {selectedOption?.label || value}
          </span>
        </div>
        <AppIcon name="chevronDown" className={`w-4 h-4 text-[var(--glass-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="glass-surface-modal absolute z-50 mt-1 left-0 right-0 p-3 max-h-60 overflow-y-auto app-scrollbar"
          style={{ minWidth: '300px' }}
        >
          <div className="grid grid-cols-5 gap-2">
            {options.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/5 shadow-sm'
                      : 'border-[var(--glass-stroke-soft)] hover:border-[var(--glass-stroke-strong)]'
                  }`}
                >
                  <RatioShape ratio={option.value} size={28} selected={isSelected} />
                  <span className={`text-xs ${isSelected ? 'font-semibold text-[var(--glass-accent-from)]' : 'text-[var(--glass-text-secondary)]'}`}>
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function StyleSelector({ value, onChange, options }: StyleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find((option) => option.value === value) || options[0]

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="glass-input-base h-11 px-3 flex items-center justify-between gap-2 cursor-pointer transition-colors"
      >
        <div className="flex min-w-0 items-center gap-2">
          {selectedOption.previewImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedOption.previewImage}
              alt=""
              className="h-7 w-7 shrink-0 rounded-md border border-[var(--glass-stroke-soft)] object-cover"
            />
          ) : (
            <AppIcon name="sparklesAlt" className="h-4 w-4 shrink-0 text-[var(--glass-accent-from)]" />
          )}
          <span className="truncate text-sm text-[var(--glass-text-primary)] font-medium">{selectedOption.label}</span>
        </div>
        <AppIcon name="chevronDown" className={`w-4 h-4 text-[var(--glass-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="glass-surface-modal absolute z-50 mt-1 left-0 p-3 max-h-[520px] overflow-y-auto app-scrollbar"
          style={{ width: 'min(520px, calc(100vw - 32px))' }}
        >
          <ArtStyleGallerySelector
            value={value}
            onChange={onChange}
            options={options}
            onAfterChange={() => setIsOpen(false)}
            columnsClassName="grid-cols-2"
            imageClassName="h-24"
          />
        </div>
      )}
    </div>
  )
}

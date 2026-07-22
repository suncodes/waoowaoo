'use client'

import { useState } from 'react'
import type { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface AIDataModalPreviewPaneProps {
  t: ReturnType<typeof useTranslations<'storyboard'>>
  previewJson: Record<string, unknown>
}

export async function copyPreviewJsonText(text: string): Promise<void> {
  const clipboardApi = globalThis.navigator?.clipboard
  if (clipboardApi && typeof clipboardApi.writeText === 'function') {
    try {
      await clipboardApi.writeText(text)
      return
    } catch {
      // Fall through to manual copy fallback.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard unavailable')
  }

  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
  document.body.removeChild(el)

  if (!copied) {
    throw new Error('Clipboard fallback failed')
  }
}

export default function AIDataModalPreviewPane({
  t,
  previewJson,
}: AIDataModalPreviewPaneProps) {
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle')

  const handleCopy = async () => {
    const text = JSON.stringify(previewJson, null, 2)
    try {
      await copyPreviewJsonText(text)
      setCopyState('success')
    } catch {
      setCopyState('error')
    }

    window.setTimeout(() => setCopyState('idle'), 1600)
  }

  const copyLabel = t('common.copy')
  const copyIconName = copyState === 'success' ? 'clipboardCheck' : copyState === 'error' ? 'alert' : 'copy'

  return (
    <div className="flex w-[45%] flex-col overflow-hidden bg-[#0f100e]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#151613] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <AppIcon name="fileText" className="h-3.5 w-3.5 text-[#e8d18a]" />
          <span className="text-xs font-medium text-stone-500">
            {t('aiData.jsonCheck')}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-xs font-semibold text-stone-300 hover:bg-white/[0.08]"
        >
          <AppIcon name={copyIconName} className="h-3 w-3" />
          {copyLabel}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-stone-300">
          {JSON.stringify(previewJson, null, 2)}
        </pre>
      </div>
    </div>
  )
}

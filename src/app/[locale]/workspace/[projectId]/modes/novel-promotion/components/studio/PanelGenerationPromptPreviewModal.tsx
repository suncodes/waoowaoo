'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/ui/icons'
import type { PanelGenerationPromptPreview } from '@/lib/query/mutations/storyboard-panel-mutations'
import { StudioButton } from './StudioPrimitives'

const MODE_LABELS: Record<PanelGenerationPromptPreview['mode'], string> = {
  image: '分镜图片',
  video: '单图视频',
  firstlastframe: '首尾帧视频',
}

function stringifyJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function PanelGenerationPromptPreviewModal({
  preview,
  loading,
  errorMessage,
  onClose,
}: {
  preview: PanelGenerationPromptPreview | null
  loading: boolean
  errorMessage: string | null
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const promptSpecText = useMemo(() => stringifyJson(preview?.promptSpec), [preview?.promptSpec])
  const generationOptionsText = useMemo(() => stringifyJson(preview?.generationOptions), [preview?.generationOptions])

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="本次将使用的最终提示词">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg border border-white/15 bg-[#151613] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#c8a85f]">只读预览</p>
            <h2 className="mt-1 text-base font-semibold text-stone-50">本次将使用的最终提示词</h2>
            {preview ? (
              <p className="mt-1 text-xs text-stone-500">
                {MODE_LABELS[preview.mode]} · 镜头 {preview.panelIndex + 1}
                {preview.modelKey ? ` · ${preview.modelKey}` : ''}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-stone-500 transition-colors hover:bg-white/[0.06] hover:text-stone-100" aria-label="关闭">
            <AppIcon name="closeSm" className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm font-semibold text-cyan-100">
              <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />
              正在编译最终提示词
            </div>
          ) : errorMessage ? (
            <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-3 text-sm leading-6 text-rose-100">
              {errorMessage}
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {preview.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-xs leading-5 text-amber-100">
                  {preview.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}

              <section className="rounded-md border border-white/10 bg-[#0f100e]">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
                  <h3 className="text-xs font-semibold text-stone-300">Compiled Prompt</h3>
                  <StudioButton size="sm" variant="ghost" icon="copy" onClick={() => { void navigator.clipboard?.writeText(preview.compiledPrompt) }}>
                    复制
                  </StudioButton>
                </div>
                <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words px-3 py-3 text-xs leading-5 text-stone-100">{preview.compiledPrompt}</pre>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-md border border-white/10 bg-white/[0.03]">
                  <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-stone-300">Generation Options</div>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 py-3 text-xs leading-5 text-stone-300">{generationOptionsText || '{}'}</pre>
                </section>
                <section className="rounded-md border border-white/10 bg-white/[0.03]">
                  <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-stone-300">Reference Images</div>
                  <div className="space-y-1 px-3 py-3 text-xs leading-5 text-stone-300">
                    {preview.referenceImages.length > 0 ? preview.referenceImages.map((item, index) => (
                      <div key={`${item}:${index}`} className="break-all">{index + 1}. {item}</div>
                    )) : <span className="text-stone-500">无</span>}
                  </div>
                </section>
              </div>

              <details className="rounded-md border border-white/10 bg-white/[0.03]">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-stone-300">Prompt Spec</summary>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 px-3 py-3 text-xs leading-5 text-stone-300">{promptSpecText}</pre>
              </details>
            </div>
          ) : null}
        </div>

        <footer className="flex justify-end border-t border-white/10 px-5 py-4">
          <StudioButton variant="secondary" onClick={onClose}>关闭</StudioButton>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

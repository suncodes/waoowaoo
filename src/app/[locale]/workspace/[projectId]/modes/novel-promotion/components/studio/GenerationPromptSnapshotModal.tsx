'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/ui/icons'
import { StudioButton } from './StudioPrimitives'

export interface GenerationPromptSnapshotDisplay {
  artifactId: string
  artifactType: string
  modelKey: string
  promptTemplateId: string
  promptHash: string
  inputHash: string
  preparationHash: string | null
  referenceImages: string[]
  promptSpec: unknown
  compiledPrompt: string
  createdAt: string
}

function stringifyJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value || '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp)
}

export default function GenerationPromptSnapshotModal({
  title,
  contextLabel,
  snapshot,
  loading,
  errorMessage,
  onClose,
}: {
  title: string
  contextLabel: string
  snapshot: GenerationPromptSnapshotDisplay | null
  loading: boolean
  errorMessage: string | null
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const promptSpecText = useMemo(() => stringifyJson(snapshot?.promptSpec), [snapshot?.promptSpec])

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg border border-white/15 bg-[#151613] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#c8a85f]">生成快照</p>
            <h2 className="mt-1 text-base font-semibold text-stone-50">{title}</h2>
            <p className="mt-1 text-xs text-stone-500">{contextLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-stone-500 transition-colors hover:bg-white/[0.06] hover:text-stone-100 focus:outline-none focus:ring-2 focus:ring-[#e8d18a]" aria-label="关闭">
            <AppIcon name="closeSm" className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm font-semibold text-cyan-100">
              <AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />
              正在读取实际生成快照
            </div>
          ) : errorMessage ? (
            <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-3 text-sm leading-6 text-rose-100">
              {errorMessage}
            </div>
          ) : snapshot ? (
            <div className="space-y-4">
              <section className="rounded-md border border-white/10 bg-[#0f100e]">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
                  <h3 className="text-xs font-semibold text-stone-300">实际提交的 Prompt</h3>
                  <StudioButton size="sm" variant="ghost" icon="copy" onClick={() => { void navigator.clipboard?.writeText(snapshot.compiledPrompt) }}>
                    复制
                  </StudioButton>
                </div>
                <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words px-3 py-3 text-xs leading-5 text-stone-100">{snapshot.compiledPrompt}</pre>
              </section>

              <section className="grid gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-2">
                <div className="space-y-1 text-xs leading-5 text-stone-400">
                  <div><span className="text-stone-500">模型：</span>{snapshot.modelKey || '未知'}</div>
                  <div><span className="text-stone-500">模板：</span>{snapshot.promptTemplateId || '未知'}</div>
                  <div><span className="text-stone-500">生成时间：</span>{formatTimestamp(snapshot.createdAt)}</div>
                </div>
                <div className="space-y-1 text-xs leading-5 text-stone-400">
                  <div className="break-all"><span className="text-stone-500">Prompt Hash：</span>{snapshot.promptHash || '未知'}</div>
                  <div className="break-all"><span className="text-stone-500">Input Hash：</span>{snapshot.inputHash || '未知'}</div>
                  {snapshot.preparationHash ? <div className="break-all"><span className="text-stone-500">优化输入 Hash：</span>{snapshot.preparationHash}</div> : null}
                </div>
              </section>

              <section className="rounded-md border border-white/10 bg-white/[0.03]">
                <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-stone-300">参考图</div>
                <div className="space-y-1 px-3 py-3 text-xs leading-5 text-stone-400">
                  {snapshot.referenceImages.length > 0
                    ? snapshot.referenceImages.map((item, index) => <div key={`${item}:${index}`} className="break-all">{index + 1}. {item}</div>)
                    : <span className="text-stone-500">无</span>}
                </div>
              </section>

              <details className="rounded-md border border-white/10 bg-white/[0.03]">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-stone-300">查看诊断 Prompt Spec</summary>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 px-3 py-3 text-xs leading-5 text-stone-400">{promptSpecText || '{}'}</pre>
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

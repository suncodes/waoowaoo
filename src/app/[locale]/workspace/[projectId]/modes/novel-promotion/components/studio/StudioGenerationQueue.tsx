'use client'

import { useEffect } from 'react'
import { AppIcon } from '@/components/ui/icons'
import CreationTaskDetails, { type CreationTaskDescriptor } from '../workspace-v2/CreationTaskDetails'
import { studioStatusDotClass } from './StudioPrimitives'
import { statusLabel, type StudioGenerationJob, type StudioProductStatus } from './studio-types'

function StatusPill({ status }: { status: StudioProductStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-stone-300">
      <span className={`h-1.5 w-1.5 rounded-full ${studioStatusDotClass(status)}`} />
      {statusLabel(status)}
    </span>
  )
}

export function hasRenderableTaskDetails(descriptor: CreationTaskDescriptor) {
  const stream = descriptor.stream
  return stream.isVisible ||
    stream.status === 'running' ||
    stream.status === 'completed' ||
    stream.status === 'failed' ||
    stream.stages.length > 0 ||
    !!stream.errorMessage ||
    !!stream.outputText
}

export function StudioGenerationQueue({
  jobs,
  detailsAvailable,
  onOpenDetails,
}: {
  jobs: StudioGenerationJob[]
  detailsAvailable: boolean
  onOpenDetails: (taskId?: string) => void
}) {
  if (jobs.length === 0) {
    return (
      <footer className="sticky bottom-3 z-[60] flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0b0c0a]/95 px-4 py-3 text-sm text-stone-500 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-stone-700" />
          生成队列空闲
        </span>
        {detailsAvailable ? (
          <button
            type="button"
            onClick={() => onOpenDetails()}
            className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]"
          >
            <AppIcon name="receipt" className="h-3.5 w-3.5" />
            查看生成日志
          </button>
        ) : null}
      </footer>
    )
  }
  return (
    <footer className="sticky bottom-3 z-[60] rounded-lg border border-white/10 bg-[#0b0c0a]/95 px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-stone-100">
          <AppIcon name="receipt" className="h-4 w-4 text-[#e8d18a]" />
          后台生成
        </div>
        <button
          type="button"
          onClick={() => onOpenDetails()}
          className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]"
        >
          查看全部日志
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => onOpenDetails(job.id)}
            className="min-w-[240px] rounded-md border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-stone-100">{job.label}</span>
              <StatusPill status={job.status} />
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[#e8d18a]" style={{ width: `${Math.max(job.progress, job.status === 'generating' ? 8 : 0)}%` }} />
            </div>
            <p className="mt-2 truncate text-xs text-stone-500">{job.message || `${job.progress}%`}</p>
          </button>
        ))}
      </div>
    </footer>
  )
}

export function StudioTaskDetailsModal({
  descriptors,
  onClose,
}: {
  descriptors: CreationTaskDescriptor[]
  onClose: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="生成日志"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="flex h-[min(760px,calc(100dvh-2rem))] w-full max-w-[1080px] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#151613] shadow-[0_30px_90px_rgba(0,0,0,0.45)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8a85f]">生成日志</p>
            <h2 className="mt-1 truncate text-base font-semibold text-stone-50">任务步骤与输出</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-stone-200 hover:bg-white/[0.08]"
            aria-label="关闭生成日志"
            title="关闭生成日志"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 text-[var(--glass-text-primary)] app-scrollbar">
          <CreationTaskDetails descriptors={descriptors} />
        </div>
      </div>
    </div>
  )
}

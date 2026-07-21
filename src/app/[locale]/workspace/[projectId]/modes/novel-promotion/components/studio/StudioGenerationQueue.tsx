'use client'

import ProductModalShell from '@/components/product/ProductModalShell'
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
  const runningCount = jobs.filter((job) => job.status === 'generating').length
  if (jobs.length === 0) {
    return (
      <section className="border-t border-white/10 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-stone-500">任务中心</h3>
          <span className="text-[11px] text-stone-600">空闲</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-stone-500">当前没有运行或待处理的生成任务。</p>
      </section>
    )
  }
  return (
    <section className="border-t border-white/10 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-stone-100">
          <AppIcon name="receipt" className="h-4 w-4 text-[#e8d18a]" />
          任务中心
        </div>
        <span className="text-[11px] text-stone-500">{runningCount > 0 ? `${runningCount} 项运行中` : `${jobs.length} 项记录`}</span>
      </div>
      <div className="mt-3 space-y-2">
        {jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => job.detailsId && onOpenDetails(job.detailsId)}
            disabled={!job.detailsId || !detailsAvailable}
            className="w-full rounded-md border border-white/10 bg-white/[0.03] p-3 text-left transition-colors enabled:hover:border-white/20 enabled:hover:bg-white/[0.06] disabled:cursor-default"
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
      {detailsAvailable ? (
        <button
          type="button"
          onClick={() => onOpenDetails()}
          className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-stone-300 hover:text-stone-50"
        >
          查看运行日志
          <AppIcon name="arrowRight" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </section>
  )
}

export function StudioTaskDetailsModal({
  descriptors,
  onClose,
}: {
  descriptors: CreationTaskDescriptor[]
  onClose: () => void
}) {
  return (
    <ProductModalShell
      open={true}
      onClose={onClose}
      size="xl"
      eyebrow="运行日志"
      title="任务步骤与输出"
      description="查看生成过程、阶段进度和最终输出。"
    >
      <div className="text-[var(--glass-text-primary)]">
        <CreationTaskDetails descriptors={descriptors} />
      </div>
    </ProductModalShell>
  )
}

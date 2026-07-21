'use client'

import ProductModalShell from '@/components/product/ProductModalShell'
import { useMemo, useState } from 'react'
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

const TASK_ORDER = ['content-plan', 'story-script', 'asset-analysis', 'visual-plan', 'storyboard']

export function StudioTaskCenterModal({
  jobs,
  descriptors,
  initialTaskId,
  onClose,
}: {
  jobs: StudioGenerationJob[]
  descriptors: CreationTaskDescriptor[]
  initialTaskId?: string | null
  onClose: () => void
}) {
  const orderedJobs = useMemo(() => [...jobs].sort((left, right) => {
    const leftIndex = TASK_ORDER.indexOf(left.id)
    const rightIndex = TASK_ORDER.indexOf(right.id)
    return (leftIndex < 0 ? TASK_ORDER.length : leftIndex) - (rightIndex < 0 ? TASK_ORDER.length : rightIndex)
  }), [jobs])
  const [selectedId, setSelectedId] = useState(initialTaskId || orderedJobs[0]?.id || '')
  const selectedJob = orderedJobs.find((job) => job.id === selectedId) || orderedJobs[0]
  const selectedDescriptor = descriptors.find((descriptor) => descriptor.id === selectedJob?.detailsId)
  const runningCount = orderedJobs.filter((job) => job.status === 'generating').length

  return (
    <ProductModalShell
      open={true}
      onClose={onClose}
      size="xl"
      eyebrow="任务中心"
      title="生成任务与运行日志"
      description={runningCount > 0 ? `${runningCount} 项任务正在运行，其他任务按制作顺序排列。` : '查看已执行任务、阶段进度和生成输出。'}
    >
      <div className="grid min-h-[560px] gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-2 rounded-md border border-white/10 bg-[#10110f] p-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <h3 className="text-xs font-semibold text-stone-500">执行顺序</h3>
            <span className="text-[11px] text-stone-600">{orderedJobs.length} 项</span>
          </div>
          {orderedJobs.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs leading-5 text-stone-500">当前没有运行或已完成的生成任务。</div>
          ) : orderedJobs.map((job) => {
            const active = job.id === selectedJob?.id
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedId(job.id)}
                className={`w-full rounded-md border p-3 text-left transition-colors ${active
                  ? 'border-[#e8d18a]/50 bg-[#e8d18a]/10'
                  : 'border-transparent bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-stone-100">{job.label}</span>
                  <StatusPill status={job.status} />
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#e8d18a] transition-[width] duration-300" style={{ width: `${Math.max(job.progress, job.status === 'generating' ? 8 : 0)}%` }} />
                </div>
                <p className="mt-2 break-words text-xs leading-5 text-stone-500">{job.message || `${job.progress}%`}</p>
              </button>
            )
          })}
        </aside>

        <section className="min-w-0 rounded-md border border-white/10 bg-[#10110f] p-5 text-[var(--glass-text-primary)]">
          {selectedJob ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8a85f]">当前任务</p>
                  <h3 className="mt-1 text-base font-semibold text-stone-50">{selectedJob.label}</h3>
                </div>
                <StatusPill status={selectedJob.status} />
              </div>
              {selectedDescriptor ? (
                <CreationTaskDetails descriptors={[selectedDescriptor]} />
              ) : (
                <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                  <AppIcon name={selectedJob.status === 'generating' ? 'loader' : 'check'} className={`h-8 w-8 ${selectedJob.status === 'generating' ? 'animate-spin text-[#e8d18a]' : 'text-emerald-300'}`} />
                  <h4 className="mt-4 text-base font-semibold text-stone-100">{selectedJob.message || '任务状态已同步'}</h4>
                  <p className="mt-2 max-w-md text-sm leading-6 text-stone-500">该任务已接入业务状态中心，完成后会更新资产清单和后续制作阶段。</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-[480px] items-center justify-center text-sm text-stone-500">暂无任务记录。</div>
          )}
        </section>
      </div>
    </ProductModalShell>
  )
}

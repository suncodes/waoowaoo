'use client'

import type { ComponentProps } from 'react'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { AppIcon } from '@/components/ui/icons'

interface ApiConfigToolbarProps {
  title: string
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  savingState: ComponentProps<typeof TaskStatusInline>['state'] | null
  savingLabel: string
  savedLabel: string
  saveFailedLabel: string
}

export function ApiConfigToolbar({
  title,
  saveStatus,
  savingState,
  savingLabel,
  savedLabel,
  saveFailedLabel,
}: ApiConfigToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
      <h2 className="text-lg font-semibold text-stone-50">{title}</h2>
      <div className="flex items-center gap-2 text-sm">
        {saveStatus === 'saving' && (
          <span className="inline-flex items-center gap-1 rounded-md border border-[#e8d18a]/25 bg-[#e8d18a]/10 px-2 py-1 text-xs text-[#e8d18a]">
            <TaskStatusInline state={savingState} className="[&>span]:sr-only" />
            <span>{savingLabel}</span>
          </span>
        )}
        {saveStatus === 'saved' && (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">
            <AppIcon name="check" className="w-4 h-4" />
            {savedLabel}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="inline-flex items-center gap-1 rounded-md border border-rose-400/25 bg-rose-400/10 px-2 py-1 text-xs text-rose-200">
            <AppIcon name="close" className="w-4 h-4" />
            {saveFailedLabel}
          </span>
        )}
      </div>
    </div>
  )
}

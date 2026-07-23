'use client'

import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import { StudioStatusBadge } from './StudioPrimitives'
import type { StudioProductStatus } from './studio-types'
import type { BoardItem } from './studio-board-model'

export default function StudioBoardShotCard({
  item,
  selected,
  status,
  statusLabel,
  imageUrl,
  running,
  runningLabel,
  onSelect,
  onPreview,
}: {
  item: BoardItem
  selected: boolean
  status: StudioProductStatus
  statusLabel?: string
  imageUrl: string | null
  running: boolean
  runningLabel?: string
  onSelect: () => void
  onPreview: (url: string) => void
}) {
  return (
    <button type="button" onClick={onSelect} className={`grid min-h-[180px] gap-3 rounded-lg border p-3 text-left transition-colors sm:grid-cols-[160px_minmax(0,1fr)] ${selected ? 'border-[#e8d18a]/70 bg-[#1b1a14]' : 'border-white/10 bg-[#10110f] hover:border-white/20 hover:bg-white/[0.04]'}`}>
      <div className="relative aspect-video overflow-hidden rounded-md bg-[#0b0c0a]">
        {imageUrl ? (
          <MediaImageWithLoading src={imageUrl} alt={`镜头 ${item.globalNumber}`} containerClassName="h-full w-full" className="h-full w-full object-cover" sizes="220px" onDoubleClick={(event) => { event.stopPropagation(); onPreview(imageUrl) }} />
        ) : (
          <div className="flex h-full items-center justify-center text-stone-600"><AppIcon name="image" className="h-7 w-7" /></div>
        )}
        {running ? <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-cyan-100"><AppIcon name="loader" className="mr-2 h-4 w-4 animate-spin" />{runningLabel || '生成中'}</div> : null}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-stone-50">镜头 {String(item.globalNumber).padStart(2, '0')}</h2><StudioStatusBadge status={status} label={statusLabel} /></div>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-300">{item.panel.description || '待补充画面描述'}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-400">
          {item.panel.location ? <span className="rounded bg-white/[0.05] px-2 py-1">{item.panel.location}</span> : null}
          {item.panel.characters.slice(0, 3).map((character) => <span key={`${item.panel.id}:${character.name}:${character.appearance}`} className="rounded bg-white/[0.05] px-2 py-1">{character.name}</span>)}
        </div>
      </div>
    </button>
  )
}

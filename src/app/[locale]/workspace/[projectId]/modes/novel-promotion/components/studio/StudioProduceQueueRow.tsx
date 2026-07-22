'use client'

import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import { StudioStatusBadge, studioStatusClass } from './StudioPrimitives'
import { statusLabel } from './studio-types'
import {
  resolveImageStatus,
  resolveVideoStatus,
  resolveVoiceStatus,
  type ProduceItem,
} from './studio-produce-model'

export default function StudioProduceQueueRow({
  item,
  selected,
  linked,
  onSelect,
}: {
  item: ProduceItem
  selected: boolean
  linked: boolean
  onSelect: () => void
}) {
  const imageStatus = resolveImageStatus(item.panel)
  const videoStatus = resolveVideoStatus(item.panel)
  const voiceStatus = resolveVoiceStatus(item.panel)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full gap-3 rounded-lg border p-3 text-left transition-colors md:grid-cols-[92px_minmax(0,1fr)] ${selected
        ? 'border-[#e8d18a]/70 bg-[#1b1a14]'
        : 'border-white/10 bg-[#10110f] hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-black">
        {item.panel.imageUrl ? (
          <MediaImageWithLoading src={item.panel.imageUrl} alt={`镜头 ${item.number}`} containerClassName="h-full w-full" className="h-full w-full object-cover" sizes="120px" />
        ) : (
          <div className="flex h-full items-center justify-center text-stone-600"><AppIcon name="image" className="h-5 w-5" /></div>
        )}
        {linked ? (
          <span className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-cyan-400/90 text-[#081011]" title="已连接下一镜头">
            <AppIcon name="link" className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-stone-50">镜头 {String(item.number).padStart(2, '0')}</span>
          <StudioStatusBadge status={videoStatus} />
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-400">{item.panel.description || item.panel.videoPrompt || '待补充镜头描述'}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className={`rounded border px-2 py-0.5 ${studioStatusClass(imageStatus)}`}>图 {statusLabel(imageStatus)}</span>
          <span className={`rounded border px-2 py-0.5 ${studioStatusClass(videoStatus)}`}>视频 {statusLabel(videoStatus)}</span>
          <span className={`rounded border px-2 py-0.5 ${studioStatusClass(voiceStatus)}`}>配音 {statusLabel(voiceStatus)}</span>
        </div>
      </div>
    </button>
  )
}

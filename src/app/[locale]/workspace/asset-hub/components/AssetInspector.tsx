'use client'

import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { AppIcon } from '@/components/ui/icons'
import type { AssetSummary, VisualAssetSummary } from '@/lib/assets/contracts'

function kindLabel(t: (key: string) => string, kind: AssetSummary['kind']) {
  return t(`${kind}s`)
}

function visualImage(asset: VisualAssetSummary) {
  for (const variant of asset.variants) {
    const render = variant.renders.find((item) => item.isSelected) || variant.renders[0]
    if (render?.imageUrl) return render.imageUrl
  }
  return null
}

export default function AssetInspector({
  asset,
  onPreview,
  onEdit,
}: {
  asset: AssetSummary | null
  onPreview: (url: string) => void
  onEdit: (asset: AssetSummary) => void
}) {
  const t = useTranslations('assetHub')

  if (!asset) {
    return (
      <aside className="min-h-[320px] border border-[#2a2f25] bg-[#121510] p-5">
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center border border-[#2a2f25] bg-[#1a1d18] text-[#777d70]"><AppIcon name="info" className="h-5 w-5" /></div>
          <h2 className="text-sm font-semibold text-[#eff1e8]">选择一个资产</h2>
          <p className="mt-2 max-w-[220px] text-xs leading-5 text-[#777d70]">从中间列表选择角色、场景、道具或音色，查看版本和生成状态。</p>
        </div>
      </aside>
    )
  }

  const isVisual = asset.family === 'visual'
  const imageUrl = isVisual ? visualImage(asset) : null
  const variantCount = isVisual ? asset.variants.length : 0
  const renderCount = isVisual ? asset.variants.reduce((sum, variant) => sum + variant.renders.length, 0) : 0
  const voiceMeta = asset.kind === 'voice' ? asset.voiceMeta : asset.kind === 'character' ? asset.voice : null
  const summary = asset.kind === 'character' ? asset.introduction || asset.profileData : asset.kind === 'voice' ? asset.voiceMeta.description : asset.summary

  return (
    <aside className="min-h-[320px] border border-[#2a2f25] bg-[#121510]">
      <header className="border-b border-[#2a2f25] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#b99b58]">Asset Inspector</p>
            <h2 className="mt-1 truncate text-lg font-semibold text-[#eff1e8]">{asset.name}</h2>
            <p className="mt-1 text-xs text-[#777d70]">{kindLabel((key) => t(key), asset.kind)} · {asset.scope === 'global' ? '全局资产' : '项目资产'}</p>
          </div>
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${asset.taskState.isRunning ? 'bg-[#e8d18a]' : asset.taskState.lastError ? 'bg-[#e58c91]' : 'bg-[#70c99d]'}`} title={asset.taskState.isRunning ? '生成中' : asset.taskState.lastError ? '存在错误' : '可用'} />
        </div>
      </header>

      <div className="space-y-5 p-5">
        {isVisual ? (
          <button type="button" onClick={() => { if (imageUrl) onPreview(imageUrl) }} disabled={!imageUrl} className="group relative block aspect-[4/3] w-full overflow-hidden border border-[#2a2f25] bg-[#1a1d18] disabled:cursor-default">
            {imageUrl ? <Image src={imageUrl} alt={asset.name} fill sizes="(min-width: 1024px) 320px, 100vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.02]" /> : <div className="flex h-full items-center justify-center text-xs text-[#777d70]">暂无定稿图片</div>}
          </button>
        ) : (
          <div className="flex items-center gap-3 border border-[#2a2f25] bg-[#1a1d18] p-4">
            <div className="flex h-10 w-10 items-center justify-center bg-[#e8d18a]/12 text-[#e8d18a]"><AppIcon name="mic" className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-sm font-medium text-[#eff1e8]">{voiceMeta?.voiceId || '未绑定音色'}</p><p className="mt-1 truncate text-xs text-[#777d70]">{asset.kind === 'voice' ? asset.voiceMeta.language : '角色音色'}</p></div>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3">
          <div className="border border-[#2a2f25] bg-[#1a1d18] p-3"><dt className="text-[11px] text-[#777d70]">版本</dt><dd className="mt-1 text-base font-semibold text-[#eff1e8]">{variantCount}</dd></div>
          <div className="border border-[#2a2f25] bg-[#1a1d18] p-3"><dt className="text-[11px] text-[#777d70]">候选渲染</dt><dd className="mt-1 text-base font-semibold text-[#eff1e8]">{renderCount}</dd></div>
        </dl>

        <section>
          <h3 className="text-xs font-semibold text-[#9ca294]">资产描述</h3>
          <p className="mt-2 text-sm leading-6 text-[#777d70]">{summary || '尚未填写描述。'}</p>
        </section>

        <div className="grid gap-2">
          <button type="button" onClick={() => onEdit(asset)} className="inline-flex h-10 items-center justify-center gap-2 bg-[#e8d18a] px-3 text-sm font-semibold text-[#171810] hover:bg-[#f3e9cf]"><AppIcon name="edit" className="h-4 w-4" />编辑资产</button>
          {imageUrl ? <button type="button" onClick={() => onPreview(imageUrl)} className="inline-flex h-10 items-center justify-center gap-2 border border-[#2a2f25] bg-[#1a1d18] px-3 text-sm font-medium text-[#eff1e8] hover:bg-[#20241d]"><AppIcon name="image" className="h-4 w-4" />预览定稿</button> : null}
        </div>
      </div>
    </aside>
  )
}

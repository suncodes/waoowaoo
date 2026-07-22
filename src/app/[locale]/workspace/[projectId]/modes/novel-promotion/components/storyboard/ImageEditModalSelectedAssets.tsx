'use client'

import { useTranslations } from 'next-intl'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import type { SelectedAsset } from './hooks/useImageGeneration'
import { AppIcon } from '@/components/ui/icons'

interface ImageEditModalSelectedAssetsProps {
  selectedAssets: SelectedAsset[]
  onOpenAssetPicker: () => void
  onPreviewImage: (url: string | null) => void
  onRemoveAsset: (assetId: string, assetType: string) => void
}

export default function ImageEditModalSelectedAssets({
  selectedAssets,
  onOpenAssetPicker,
  onPreviewImage,
  onRemoveAsset,
}: ImageEditModalSelectedAssetsProps) {
  const t = useTranslations('storyboard')
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-semibold text-stone-300">
          {t('imageEdit.selectedAssetsLabel')} <span className="font-normal text-stone-500">({t('imageEdit.selectedAssetsCount', { count: selectedAssets.length })})</span>
        </label>
        <button
          onClick={onOpenAssetPicker}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#e8d18a] hover:text-[#fff5d9]"
        >
          <AppIcon name="plus" className="w-4 h-4" />
          {t('imageEdit.addAsset')}
        </button>
      </div>

      <div className="flex min-h-[72px] flex-wrap gap-2 rounded-md border border-white/10 bg-white/[0.03] p-2">
        {selectedAssets.length === 0 ? (
          <p className="w-full py-4 text-center text-sm text-stone-500">{t('imageEdit.noAssets')}</p>
        ) : (
          selectedAssets.map((asset) => {
            const displayImageUrl = toDisplayImageUrl(asset.imageUrl)
            return (
              <div key={`${asset.type}-${asset.id}`} className="relative w-14 h-14 group">
                {displayImageUrl ? (
                  <MediaImageWithLoading
                    src={displayImageUrl}
                    alt={asset.name}
                    containerClassName="w-full h-full rounded-lg"
                    className="w-full h-full object-cover rounded-lg border cursor-zoom-in"
                    onClick={() => onPreviewImage(asset.imageUrl || null)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-md bg-white/[0.04] text-xs text-stone-600">
                    {asset.type === 'character' ? (
                      <AppIcon name="user" className="h-4 w-4" />
                    ) : (
                      <AppIcon name="imageAlt" className="h-4 w-4" />
                    )}
                  </div>
                )}
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemoveAsset(asset.id, asset.type)
                  }}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-400"
                >
                  <AppIcon name="closeSm" className="h-3 w-3" />
                </button>
                <div className="absolute inset-x-0 bottom-0 truncate rounded-b-md bg-black/70 px-1 py-0.5 text-xs text-white">
                  {asset.name}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

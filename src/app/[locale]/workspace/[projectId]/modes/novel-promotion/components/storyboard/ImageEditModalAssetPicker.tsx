'use client'

import type { Character, Location } from '@/types/project'
import { useTranslations } from 'next-intl'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import type { SelectedAsset } from './hooks/useImageGeneration'
import { AppIcon } from '@/components/ui/icons'
import ProductModalShell from '@/components/product/ProductModalShell'

interface ImageEditModalAssetPickerProps {
  isOpen: boolean
  characters: Character[]
  locations: Location[]
  selectedAssets: SelectedAsset[]
  onClose: () => void
  onAddAsset: (asset: SelectedAsset) => void
  onRemoveAsset: (assetId: string, assetType: string) => void
  onPreviewImage: (url: string | null) => void
}

export default function ImageEditModalAssetPicker({
  isOpen,
  characters,
  locations,
  selectedAssets,
  onClose,
  onAddAsset,
  onRemoveAsset,
  onPreviewImage,
}: ImageEditModalAssetPickerProps) {
  const t = useTranslations('storyboard')
  if (!isOpen) return null

  return (
    <ProductModalShell open onClose={onClose} size="lg" eyebrow="参考资产" title={t('imageEdit.selectAsset')} description="选择需要参与图片编辑的角色和场景。" footer={(
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md bg-[#f3e9cf] px-4 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9]">{t('common.confirm')}</button>
      </div>
    )}>
        <div className="space-y-5">
          {characters.length > 0 && (
            <div className="mb-4">
              <h5 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-300">
                <AppIcon name="user" className="h-4 w-4 text-stone-500" />
                <span>{t('prompts.character')}</span>
              </h5>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {characters.map((character) => {
                  const appearances = character.appearances || []
                  const hasMultipleAppearances = appearances.length > 1
                  return appearances.map((appearance) => {
                    const isSelected = selectedAssets.some(
                      (asset) =>
                        asset.id === character.id &&
                        asset.type === 'character' &&
                        asset.appearanceId === appearance.appearanceIndex,
                    )
                    const displayName = hasMultipleAppearances
                      ? `${character.name} - ${appearance.changeReason || t('panel.defaultAppearance')}`
                      : character.name
                    const displayImageUrl = toDisplayImageUrl(appearance.imageUrl)

                    return (
                      <button
                        key={`${character.id}-${appearance.appearanceIndex}`}
                        onClick={() => {
                          if (isSelected) {
                            onRemoveAsset(character.id, 'character')
                          } else {
                            onAddAsset({
                              id: character.id,
                              name: displayName,
                              type: 'character',
                              imageUrl: appearance.imageUrl,
                              appearanceId: appearance.appearanceIndex,
                              appearanceName: appearance.changeReason,
                            })
                          }
                        }}
                        className={`relative aspect-square overflow-hidden rounded-md border-2 ${isSelected ? 'border-[#e8d18a]' : 'border-white/10'}`}
                      >
                        {displayImageUrl ? (
                          <MediaImageWithLoading
                            src={displayImageUrl}
                            alt={displayName}
                            containerClassName="w-full h-full"
                            className="w-full h-full object-cover cursor-zoom-in"
                            onClick={(event) => {
                              event.stopPropagation()
                              onPreviewImage(appearance.imageUrl || null)
                            }}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-white/[0.04] text-stone-600">
                            <AppIcon name="user" className="h-7 w-7" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 truncate bg-black/70 p-1 text-xs text-white" title={displayName}>
                          {displayName}
                        </div>
                        {isSelected && (
                          <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#e8d18a] text-[#161512]">
                            <AppIcon name="checkXs" className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    )
                  })
                })}
              </div>
            </div>
          )}

          {locations.length > 0 && (
            <div>
              <h5 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-300">
                <AppIcon name="imageAlt" className="h-4 w-4 text-stone-500" />
                <span>{t('prompts.location')}</span>
              </h5>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {locations.map((location) => {
                  const isSelected = selectedAssets.some((asset) => asset.id === location.id && asset.type === 'location')
                  const selectedImage = location.selectedImageId
                    ? location.images?.find((image) => image.id === location.selectedImageId)
                    : location.images?.find((image) => image.isSelected) || location.images?.find((image) => image.imageUrl) || location.images?.[0]
                  const imageUrl = selectedImage?.imageUrl
                  const displayImageUrl = toDisplayImageUrl(imageUrl || null)

                  return (
                    <button
                      key={location.id}
                      onClick={() => {
                        if (isSelected) {
                          onRemoveAsset(location.id, 'location')
                        } else {
                          onAddAsset({
                            id: location.id,
                            name: location.name,
                            type: 'location',
                            imageUrl: imageUrl ?? null,
                          })
                        }
                      }}
                      className={`relative aspect-[3/2] overflow-hidden rounded-md border-2 ${isSelected ? 'border-[#e8d18a]' : 'border-white/10'}`}
                    >
                      {displayImageUrl ? (
                        <MediaImageWithLoading
                          src={displayImageUrl}
                          alt={location.name}
                          containerClassName="w-full h-full"
                          className="w-full h-full object-cover cursor-zoom-in"
                          onClick={(event) => {
                            event.stopPropagation()
                            onPreviewImage(imageUrl || null)
                          }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white/[0.04] text-stone-600">
                          <AppIcon name="imageAlt" className="h-7 w-7" />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 truncate bg-black/70 p-1 text-xs text-white">
                        {location.name}
                      </div>
                      {isSelected && (
                        <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#e8d18a] text-[#161512]">
                          <AppIcon name="checkXs" className="h-3 w-3" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
    </ProductModalShell>
  )
}

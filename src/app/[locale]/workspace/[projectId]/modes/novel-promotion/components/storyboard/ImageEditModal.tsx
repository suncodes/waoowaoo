'use client'
import { useTranslations } from 'next-intl'
import { useState, useRef, useCallback } from 'react'
import { Character, Location } from '@/types/project'
import { useProjectAssets } from '@/lib/query/hooks/useProjectAssets'
import { SelectedAsset } from './hooks/useImageGeneration'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import ImageEditModalSelectedAssets from './ImageEditModalSelectedAssets'
import ImageEditModalAssetPicker from './ImageEditModalAssetPicker'
import { AppIcon } from '@/components/ui/icons'
import ProductModalShell from '@/components/product/ProductModalShell'

interface ImageEditModalProps {
  projectId: string
  defaultAssets: SelectedAsset[]
  onSubmit: (prompt: string, images: string[], assets: SelectedAsset[]) => void
  onClose: () => void
}

export default function ImageEditModal({
  projectId,
  defaultAssets,
  onSubmit,
  onClose,
}: ImageEditModalProps) {
  const t = useTranslations('storyboard')

  const { data: assets } = useProjectAssets(projectId)
  const characters: Character[] = assets?.characters ?? []
  const locations: Location[] = assets?.locations ?? []

  const [editPrompt, setEditPrompt] = useState('')
  const [editImages, setEditImages] = useState<string[]>([])
  const [selectedAssets, setSelectedAssets] = useState<SelectedAsset[]>(defaultAssets)
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (readerEvent) => {
        const base64 = readerEvent.target?.result as string
        setEditImages((previous) => [...previous, base64])
      }
      reader.readAsDataURL(file)
    })

    event.target.value = ''
  }, [])

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const items = event.clipboardData.items
    for (let index = 0; index < items.length; index++) {
      if (items[index].type.startsWith('image/')) {
        const file = items[index].getAsFile()
        if (file) {
          const reader = new FileReader()
          reader.onload = (readerEvent) => {
            const base64 = readerEvent.target?.result as string
            setEditImages((previous) => [...previous, base64])
          }
          reader.readAsDataURL(file)
        }
      }
    }
  }, [])

  const removeImage = (index: number) => {
    setEditImages((previous) => previous.filter((_, imageIndex) => imageIndex !== index))
  }

  const handleAddAsset = (asset: SelectedAsset) => {
    setSelectedAssets((previous) => {
      if (previous.some((item) => item.id === asset.id && item.type === asset.type)) return previous
      return [...previous, asset]
    })
  }

  const handleRemoveAsset = (assetId: string, assetType: string) => {
    setSelectedAssets((previous) => previous.filter((item) => !(item.id === assetId && item.type === assetType)))
  }

  const handleSubmit = () => {
    if (!editPrompt.trim()) {
      alert(t('prompts.enterInstruction'))
      return
    }
    onSubmit(editPrompt, editImages, selectedAssets)
  }

  return (
    <ProductModalShell
      open={true}
      onClose={onClose}
      title={t('imageEdit.title')}
      eyebrow="图片编辑"
      description={t('imageEdit.subtitle')}
      size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]">
            {t('candidate.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!editPrompt.trim()}
            className="h-9 rounded-md bg-[#f3e9cf] px-4 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t('imageEdit.start')}
          </button>
        </div>
      )}
    >
      <div className="space-y-5" onPaste={handlePaste}>
          <div>
            <label className="mb-2 block text-sm font-medium text-stone-300">{t('prompts.aiInstruction')}</label>
            <textarea
              value={editPrompt}
              onChange={(event) => setEditPrompt(event.target.value)}
              placeholder={t('imageEdit.promptPlaceholder')}
              className="h-28 w-full resize-none rounded-md border border-white/10 bg-[#10110f] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
              autoFocus
            />
          </div>

          <ImageEditModalSelectedAssets
            selectedAssets={selectedAssets}
            onOpenAssetPicker={() => setShowAssetPicker(true)}
            onPreviewImage={setPreviewImage}
            onRemoveAsset={handleRemoveAsset}
          />

          <div>
            <label className="mb-2 block text-sm font-medium text-stone-300">
              {t('imageEdit.referenceImagesLabel')} <span className="font-normal text-stone-500">{t('imageEdit.referenceImagesHint')}</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
            <div className="flex flex-wrap gap-2">
              {editImages.map((image, index) => (
                <div key={index} className="relative h-16 w-16">
                  <MediaImageWithLoading
                    src={image}
                    alt=""
                    containerClassName="w-full h-full rounded-lg"
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <button
                    onClick={() => removeImage(index)}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-xs text-white hover:bg-rose-400"
                  >
                    <AppIcon name="closeSm" className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-white/20 text-stone-500 transition-colors hover:border-[#e8d18a] hover:text-[#e8d18a]"
              >
                <AppIcon name="plus" className="w-6 h-6" />
              </button>
            </div>
          </div>
      </div>

      <ImageEditModalAssetPicker
        isOpen={showAssetPicker}
        characters={characters}
        locations={locations}
        selectedAssets={selectedAssets}
        onClose={() => setShowAssetPicker(false)}
        onAddAsset={handleAddAsset}
        onRemoveAsset={handleRemoveAsset}
        onPreviewImage={setPreviewImage}
      />

      {previewImage && (
        <ImagePreviewModal
          imageUrl={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </ProductModalShell>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import ProductModalShell from '@/components/product/ProductModalShell'
import { resolveOriginalImageUrl, toDisplayImageUrl } from '@/lib/media/image-url'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'

interface ImagePreviewModalProps {
  imageUrl: string | null
  onClose: () => void
}

export default function ImagePreviewModal({ imageUrl, onClose }: ImagePreviewModalProps) {
  const t = useTranslations('common')
  const displayImageUrl = imageUrl ? toDisplayImageUrl(imageUrl) : null
  const originalImageUrl = imageUrl ? resolveOriginalImageUrl(imageUrl) || displayImageUrl : null
  if (!displayImageUrl) return null

  return (
    <ProductModalShell
      open
      onClose={onClose}
      size="xl"
      eyebrow="图片预览"
      title={t('preview')}
      footer={originalImageUrl ? (
        <div className="flex justify-end">
          <a href={originalImageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]">
            <AppIcon name="externalLink" className="h-3.5 w-3.5" />
            {t('viewOriginal')}
          </a>
        </div>
      ) : null}
    >
      <div className="flex min-h-[320px] items-center justify-center rounded-md bg-black p-2 sm:min-h-[520px]">
        <MediaImageWithLoading src={displayImageUrl} alt={t('preview')} containerClassName="flex max-h-[72dvh] w-full items-center justify-center" className="max-h-[72dvh] max-w-full rounded-md object-contain" />
      </div>
    </ProductModalShell>
  )
}

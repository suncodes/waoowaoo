'use client'
import { useTranslations } from 'next-intl'

interface PanelVariantModalCustomOptionsProps {
  customInput: string
  includeCharacterAssets: boolean
  includeLocationAsset: boolean
  isSubmittingVariantTask: boolean
  onCustomInputChange: (value: string) => void
  onIncludeCharacterAssetsChange: (checked: boolean) => void
  onIncludeLocationAssetChange: (checked: boolean) => void
}

export default function PanelVariantModalCustomOptions({
  customInput,
  includeCharacterAssets,
  includeLocationAsset,
  isSubmittingVariantTask,
  onCustomInputChange,
  onIncludeCharacterAssetsChange,
  onIncludeLocationAssetChange,
}: PanelVariantModalCustomOptionsProps) {
  const t = useTranslations('storyboard')

  return (
    <>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-stone-200">{t('variant.customInstruction')}</h3>
        <textarea
          value={customInput}
          onChange={(event) => onCustomInputChange(event.target.value)}
          placeholder={t('variant.customPlaceholder')}
          className="h-20 w-full resize-y rounded-md border border-white/10 bg-[#10110f] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
          disabled={isSubmittingVariantTask}
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
          <input
            type="checkbox"
            checked={includeCharacterAssets}
            onChange={(event) => onIncludeCharacterAssetsChange(event.target.checked)}
            className="h-4 w-4 accent-[#e8d18a]"
          />
          {t('variant.includeCharacter')}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
          <input
            type="checkbox"
            checked={includeLocationAsset}
            onChange={(event) => onIncludeLocationAssetChange(event.target.checked)}
            className="h-4 w-4 accent-[#e8d18a]"
          />
          {t('variant.includeLocation')}
        </label>
      </div>
    </>
  )
}

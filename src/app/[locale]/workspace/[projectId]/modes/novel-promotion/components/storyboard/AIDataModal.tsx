'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import ProductModalShell from '@/components/product/ProductModalShell'
import type { AIDataModalProps } from './AIDataModal.types'
import { useAIDataModalState } from './hooks/useAIDataModalState'
import AIDataModalFormPane from './AIDataModalFormPane'
import AIDataModalPreviewPane from './AIDataModalPreviewPane'

export type {
  AIDataModalProps,
  AIDataSavePayload,
  PhotographyRules,
  ActingCharacter,
  ActingNotes,
  AIDataCharacter,
} from './AIDataModal.types'

export default function AIDataModal({
  isOpen,
  onClose,
  syncKey,
  panelNumber,
  shotType: initialShotType,
  cameraMove: initialCameraMove,
  description: initialDescription,
  location,
  characters,
  videoPrompt: initialVideoPrompt,
  photographyRules: initialPhotographyRules,
  actingNotes: initialActingNotes,
  videoRatio,
  onSave,
}: AIDataModalProps) {
  const t = useTranslations('storyboard')
  const [activeCharIdx, setActiveCharIdx] = useState(0)

  const {
    shotType,
    setShotType,
    cameraMove,
    setCameraMove,
    description,
    setDescription,
    videoPrompt,
    setVideoPrompt,
    photographyRules,
    actingNotes,
    updatePhotographyField,
    updatePhotographyCharacter,
    updateActingCharacter,
    savePayload,
  } = useAIDataModalState({
    isOpen,
    syncKey,
    initialShotType,
    initialCameraMove,
    initialDescription,
    initialVideoPrompt,
    initialPhotographyRules,
    initialActingNotes,
  })

  const handleSave = () => {
    onSave(savePayload)
    onClose()
  }

  const previewJson = {
    aspect_ratio: videoRatio,
    shot: {
      shot_type: shotType,
      camera_move: cameraMove,
      description,
      location,
      characters,
      prompt_text: `A ${videoRatio} shot: ${description}. ${videoPrompt}`,
    },
    ...(photographyRules ? { photography_rules: photographyRules } : {}),
    ...(actingNotes.length > 0 ? { acting_notes: actingNotes } : {}),
  }

  return (
    <ProductModalShell
      open={isOpen}
      onClose={onClose}
      size="xl"
      eyebrow="镜头数据"
      title={t('aiData.title')}
      description={`${t('aiData.subtitle', { number: panelNumber })} · ${videoRatio}`}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            {characters.map((character) => character.name).join('、')}
            {location ? ` · ${location}` : ''}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={handleSave} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9]">
              <AppIcon name="check" className="h-3.5 w-3.5" />
              {t('aiData.save')}
            </button>
          </div>
        </div>
      )}
    >
        <div className="flex min-h-[620px] overflow-hidden rounded-md border border-white/10 bg-[#10110f]">
          <AIDataModalFormPane
            t={t}
            shotType={shotType}
            cameraMove={cameraMove}
            description={description}
            location={location}
            characters={characters}
            videoPrompt={videoPrompt}
            photographyRules={photographyRules}
            actingNotes={actingNotes}
            activeCharIdx={activeCharIdx}
            onActiveCharIdxChange={setActiveCharIdx}
            onShotTypeChange={setShotType}
            onCameraMoveChange={setCameraMove}
            onDescriptionChange={setDescription}
            onVideoPromptChange={setVideoPrompt}
            onPhotographyFieldChange={updatePhotographyField}
            onPhotographyCharacterChange={updatePhotographyCharacter}
            onActingCharacterChange={updateActingCharacter}
          />
          <AIDataModalPreviewPane
            t={t}
            previewJson={previewJson}
          />
        </div>
    </ProductModalShell>
  )
}

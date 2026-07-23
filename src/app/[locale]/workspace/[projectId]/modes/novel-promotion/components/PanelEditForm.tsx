'use client'

import { useTranslations } from 'next-intl'
import PanelEditFormV2 from '@/components/ui/patterns/PanelEditFormV2'
import ProductModalShell from '@/components/product/ProductModalShell'
import { Character, Location } from '@/types/project'
import { useProjectAssets } from '@/lib/query/hooks/useProjectAssets'
import { AppIcon } from '@/components/ui/icons'

interface CharacterAppearance {
  id?: string
  appearanceIndex?: string | number
  changeReason?: string | null
}

export interface PanelEditData {
  id: string
  panelIndex: number
  panelNumber: number | null
  shotType: string | null
  cameraMove: string | null
  description: string | null
  location: string | null
  characters: { name: string; appearance: string; slot?: string }[]
  srtStart: number | null
  srtEnd: number | null
  duration: number | null
  imagePrompt?: string | null
  videoPrompt: string | null
  photographyRules?: string | null
  actingNotes?: string | null
  sourceText?: string | null
}

interface PanelEditFormProps {
  panelData: PanelEditData
  isSaving?: boolean
  saveStatus?: 'idle' | 'saving' | 'error'
  saveErrorMessage?: string | null
  onRetrySave?: () => void
  onUpdate: (updates: Partial<PanelEditData>) => void
  onOpenCharacterPicker: () => void
  onOpenLocationPicker: () => void
  onRemoveCharacter: (index: number) => void
  onRemoveLocation: () => void
}

export default function PanelEditForm({
  panelData,
  isSaving = false,
  saveStatus = 'idle',
  saveErrorMessage = null,
  onRetrySave,
  onUpdate,
  onOpenCharacterPicker,
  onOpenLocationPicker,
  onRemoveCharacter,
  onRemoveLocation
}: PanelEditFormProps) {
  return (
    <PanelEditFormV2
      panelData={panelData}
      isSaving={isSaving}
      saveStatus={saveStatus}
      saveErrorMessage={saveErrorMessage}
      onRetrySave={onRetrySave}
      onUpdate={onUpdate}
      onOpenCharacterPicker={onOpenCharacterPicker}
      onOpenLocationPicker={onOpenLocationPicker}
      onRemoveCharacter={onRemoveCharacter}
      onRemoveLocation={onRemoveLocation}
      uiMode="flow"
    />
  )
}

interface CharacterPickerModalProps {
  projectId: string
  currentCharacters: { name: string; appearance: string; slot?: string }[]
  onSelect: (charName: string, appearance: string) => void
  onClose: () => void
}

export function CharacterPickerModal({
  projectId,
  currentCharacters,
  onSelect,
  onClose
}: CharacterPickerModalProps) {
  const ts = useTranslations('storyboard')
  const { data: assets } = useProjectAssets(projectId)
  const characters: Character[] = assets?.characters ?? []

  return (
    <ProductModalShell open onClose={onClose} size="md" eyebrow="资产选择" title={ts('panel.selectCharacter')} description="选择要绑定到当前镜头的角色形象。">
      <div className="space-y-3">
        {characters.length === 0 ? (
          <p className="rounded-md border border-dashed border-white/15 px-4 py-8 text-center text-sm text-stone-500">{ts('panel.noCharacterAssets')}</p>
        ) : (
          characters.map(char => {
            const appearances = char.appearances || []
            return (
              <section key={char.id} className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
                <h5 className="text-sm font-semibold text-stone-100">{char.name}</h5>
                <div className="flex flex-wrap gap-2">
                  {appearances.map((app: CharacterAppearance) => {
                    const appearanceName = app.changeReason || ts('panel.defaultAppearance')
                    const isSelected = currentCharacters.some(
                      c => c.name === char.name && c.appearance === appearanceName
                    )
                    return (
                      <button
                        key={app.id || app.appearanceIndex}
                        type="button"
                        disabled={isSelected}
                        onClick={() => {
                          if (!isSelected) onSelect(char.name, appearanceName)
                        }}
                        className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${isSelected ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/[0.04] text-stone-200 hover:bg-white/[0.08]'}`}
                      >
                        {appearanceName}
                        {isSelected && (
                          <AppIcon name="checkTiny" className="h-3 w-3" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>
    </ProductModalShell>
  )
}

interface LocationPickerModalProps {
  projectId: string
  currentLocation: string | null
  onSelect: (locationName: string) => void
  onClose: () => void
}

export function LocationPickerModal({
  projectId,
  currentLocation,
  onSelect,
  onClose
}: LocationPickerModalProps) {
  const ts = useTranslations('storyboard')
  const { data: assets } = useProjectAssets(projectId)
  const locations: Location[] = assets?.locations ?? []

  return (
    <ProductModalShell open onClose={onClose} size="md" eyebrow="资产选择" title={ts('panel.selectLocation')} description="选择要绑定到当前镜头的场景。">
      <div>
        {locations.length === 0 ? (
          <p className="rounded-md border border-dashed border-white/15 px-4 py-8 text-center text-sm text-stone-500">{ts('panel.noLocationAssets')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {locations.map(loc => {
              const isSelected = currentLocation === loc.name
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => onSelect(loc.name)}
                  className={`rounded-md border px-3 py-3 text-left transition-colors ${
                    isSelected
                      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'
                      : 'border-white/10 bg-white/[0.03] text-stone-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-stone-100">
                    <AppIcon name="imageAlt" className="h-3.5 w-3.5 text-stone-500" />
                    <span>{loc.name}</span>
                  </div>
                  {isSelected ? (
                    <span className="text-xs text-emerald-200">{ts('panel.selected')}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </ProductModalShell>
  )
}

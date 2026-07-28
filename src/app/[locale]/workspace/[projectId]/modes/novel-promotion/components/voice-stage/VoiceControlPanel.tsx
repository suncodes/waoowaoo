import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { TaskPresentationState } from '@/lib/task/presentation'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import VoiceToolbar from '../voice/VoiceToolbar'
import EmbeddedVoiceToolbar from '../voice/EmbeddedVoiceToolbar'
import SpeakerVoiceStatus from '../voice/SpeakerVoiceStatus'
import ProductModalShell from '@/components/product/ProductModalShell'

interface BindablePanelOption {
  id: string
  storyboardId: string
  panelIndex: number
  label: string
}

interface VoiceControlPanelProps {
  children: ReactNode
  embedded: boolean
  nativeAudioMode?: boolean
  onBack?: () => void
  analyzing: boolean
  isBatchSubmittingAll: boolean
  isRebuildingSpeechPlan?: boolean
  isGeneratingDeliveryLines?: boolean
  isDownloading: boolean
  runningLineCount: number
  allSpeakersHaveVoice: boolean
  totalLines: number
  linesWithVoice: number
  linesWithAudio: number
  speakers: string[]
  speakerStats: Record<string, number>
  isLineEditorOpen: boolean
  isSavingLineEditor: boolean
  editingLineId: string | null
  editingContent: string
  editingSpeaker: string
  editingMatchedPanelId: string
  speakerOptions: string[]
  bindablePanelOptions: BindablePanelOption[]
  savingLineEditorState: TaskPresentationState | null
  onAnalyze: () => Promise<void>
  onRebuildSpeechPlans?: () => Promise<void>
  onGenerateDeliveryLines?: () => Promise<void>
  onGenerateAll: () => Promise<void>
  onDownloadAll: () => Promise<void>
  onStartAdd: () => void
  onOpenAssetLibraryForSpeaker: (speaker: string) => void
  onOpenInlineBinding?: (speaker: string) => void
  hasSpeakerCharacter?: (speaker: string) => boolean
  onCancelEdit: () => void
  onSaveEdit: () => Promise<void>
  onEditingContentChange: (value: string) => void
  onEditingSpeakerChange: (value: string) => void
  onEditingMatchedPanelIdChange: (value: string) => void
  hasSpeakerVoiceBinding: (speaker: string) => boolean
}

export default function VoiceControlPanel({
  children,
  embedded,
  nativeAudioMode = false,
  onBack,
  analyzing,
  isBatchSubmittingAll,
  isRebuildingSpeechPlan = false,
  isGeneratingDeliveryLines = false,
  isDownloading,
  runningLineCount,
  allSpeakersHaveVoice,
  totalLines,
  linesWithVoice,
  linesWithAudio,
  speakers,
  speakerStats,
  isLineEditorOpen,
  isSavingLineEditor,
  editingLineId,
  editingContent,
  editingSpeaker,
  editingMatchedPanelId,
  speakerOptions,
  bindablePanelOptions,
  savingLineEditorState,
  onAnalyze,
  onRebuildSpeechPlans,
  onGenerateDeliveryLines,
  onGenerateAll,
  onDownloadAll,
  onStartAdd,
  onOpenAssetLibraryForSpeaker,
  onOpenInlineBinding,
  hasSpeakerCharacter,
  onCancelEdit,
  onSaveEdit,
  onEditingContentChange,
  onEditingSpeakerChange,
  onEditingMatchedPanelIdChange,
  hasSpeakerVoiceBinding,
}: VoiceControlPanelProps) {
  const t = useTranslations('voice')

  return (
    <div className="space-y-6 pb-20">
      {!embedded ? (
        <VoiceToolbar
          onBack={onBack}
          onAddLine={onStartAdd}
          onAnalyze={onAnalyze}
          onGenerateAll={onGenerateAll}
          onDownloadAll={onDownloadAll}
          analyzing={analyzing}
          isBatchSubmitting={isBatchSubmittingAll}
          runningCount={runningLineCount}
          isDownloading={isDownloading}
          allSpeakersHaveVoice={allSpeakersHaveVoice}
          totalLines={totalLines}
          linesWithVoice={linesWithVoice}
          linesWithAudio={linesWithAudio}
        />
      ) : (
        <EmbeddedVoiceToolbar
          totalLines={totalLines}
          linesWithAudio={linesWithAudio}
          analyzing={analyzing}
          rebuildingSpeechPlan={isRebuildingSpeechPlan}
          generatingDeliveryLines={isGeneratingDeliveryLines}
          isDownloading={isDownloading}
          isBatchSubmitting={isBatchSubmittingAll}
          runningCount={runningLineCount}
          allSpeakersHaveVoice={allSpeakersHaveVoice}
          nativeAudioMode={nativeAudioMode}
          onAddLine={onStartAdd}
          onAnalyze={onAnalyze}
          onRebuildSpeechPlans={onRebuildSpeechPlans}
          onGenerateDeliveryLines={onGenerateDeliveryLines}
          onDownloadAll={onDownloadAll}
          onGenerateAll={onGenerateAll}
        />
      )}

      {speakers.length > 0 && (
        <SpeakerVoiceStatus
          speakers={speakers}
          speakerStats={speakerStats}
          hasSpeakerVoiceBinding={hasSpeakerVoiceBinding}
          onOpenAssetLibrary={onOpenAssetLibraryForSpeaker}
          onOpenInlineBinding={onOpenInlineBinding}
          hasSpeakerCharacter={hasSpeakerCharacter}
          embedded={embedded}
        />
      )}

      {children}

      {isLineEditorOpen && (
        <ProductModalShell
          open
          onClose={onCancelEdit}
          size="md"
          eyebrow="配音台词"
          title={editingLineId ? t('lineEditor.editTitle') : t('lineEditor.addTitle')}
          description="编辑台词、说话人和关联镜头。"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onCancelEdit} disabled={isSavingLineEditor} className="inline-flex h-9 items-center rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08] disabled:opacity-60">{t('common.cancel')}</button>
              <button type="button" onClick={onSaveEdit} disabled={isSavingLineEditor} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:opacity-60">
                {isSavingLineEditor ? <TaskStatusInline state={savingLineEditorState} className="text-[#161512] [&>span]:text-[#161512] [&_svg]:text-[#161512]" /> : null}
                <span>{editingLineId ? t('lineEditor.saveEdit') : t('lineEditor.saveAdd')}</span>
              </button>
            </div>
          )}
        >
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-stone-300">{t('lineEditor.contentLabel')}</label>
                <textarea
                  value={editingContent}
                  onChange={(event) => onEditingContentChange(event.target.value)}
                  placeholder={t('lineEditor.contentPlaceholder')}
                  rows={4}
                  className="w-full resize-y rounded-md border border-white/10 bg-[#10110f] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-stone-300">{t('lineEditor.speakerLabel')}</label>
                <select
                  value={editingSpeaker}
                  onChange={(event) => onEditingSpeakerChange(event.target.value)}
                  className="h-10 w-full rounded-md border border-white/10 bg-[#10110f] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
                >
                  <option value="" disabled>{t('lineEditor.selectSpeaker')}</option>
                  {speakerOptions.map((speaker) => (
                    <option key={speaker} value={speaker}>
                      {speaker}
                    </option>
                  ))}
                </select>
                {speakerOptions.length === 0 && (
                  <p className="mt-1 text-xs text-amber-200">{t('lineEditor.noSpeakerOptions')}</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-stone-300">{t('lineEditor.bindPanelLabel')}</label>
                <select
                  value={editingMatchedPanelId}
                  onChange={(event) => onEditingMatchedPanelIdChange(event.target.value)}
                  className="h-10 w-full rounded-md border border-white/10 bg-[#10110f] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
                >
                  <option value="">{t('lineEditor.unboundPanel')}</option>
                  {bindablePanelOptions.map((panel) => (
                    <option key={panel.id} value={panel.id}>
                      {panel.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
        </ProductModalShell>
      )}
    </div>
  )
}

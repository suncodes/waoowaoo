'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'
import VoiceDesignGeneratorSection from './VoiceDesignGeneratorSection'
import ProductModalShell from '@/components/product/ProductModalShell'
import {
  DEFAULT_VOICE_SCHEME_COUNT,
  generateVoiceDesignOptions,
  type GeneratedVoice,
  type VoiceDesignMutationPayload,
  type VoiceDesignMutationResult,
} from './voice-design-shared'

export type { VoiceDesignMutationPayload, VoiceDesignMutationResult } from './voice-design-shared'

interface VoiceDesignDialogBaseProps {
  isOpen: boolean
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave: (voiceId: string, audioBase64: string) => void
  onDesignVoice: (payload: VoiceDesignMutationPayload) => Promise<VoiceDesignMutationResult>
}

export default function VoiceDesignDialogBase({
  isOpen,
  speaker,
  hasExistingVoice = false,
  onClose,
  onSave,
  onDesignVoice,
}: VoiceDesignDialogBaseProps) {
  const t = useTranslations('common')
  const tv = useTranslations('voice.voiceDesign')

  const [voicePrompt, setVoicePrompt] = useState('')
  const [previewText, setPreviewText] = useState(tv('defaultPreviewText'))
  const [schemeCount, setSchemeCount] = useState(String(DEFAULT_VOICE_SCHEME_COUNT))
  const [isDesignSubmitting, setIsDesignSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedVoices, setGeneratedVoices] = useState<GeneratedVoice[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const designSubmittingState = isDesignSubmitting
    ? resolveTaskPresentationState({
        phase: 'processing',
        intent: 'generate',
        resource: 'audio',
        hasOutput: false,
      })
    : null

  const handleGenerate = async () => {
    if (!voicePrompt.trim()) {
      setError(tv('pleaseSelectStyle'))
      return
    }

    setIsDesignSubmitting(true)
    setError(null)
    setGeneratedVoices([])
    setSelectedIndex(null)

    try {
      const voices = await generateVoiceDesignOptions({
        count: schemeCount,
        voicePrompt,
        previewText,
        defaultPreviewText: tv('defaultPreviewText'),
        onDesignVoice,
      })
      setGeneratedVoices(voices)
    } catch (err: unknown) {
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined
      if (status === 402) {
        const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined
        alert(t('insufficientBalance') + '\n\n' + (detail || t('insufficientBalanceDetail')))
        setError('INSUFFICIENT_BALANCE')
        return
      }

      const message = err instanceof Error ? err.message : tv('generationError')
      setError(message === 'VOICE_DESIGN_EMPTY_RESULT' ? tv('noVoiceGenerated') : (message || tv('generationError')))
    } finally {
      setIsDesignSubmitting(false)
    }
  }

  const handlePlayVoice = (index: number) => {
    if (playingIndex === index && audioRef.current) {
      audioRef.current.pause()
      setPlayingIndex(null)
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
    }

    setPlayingIndex(index)
    const audio = new Audio(generatedVoices[index].audioUrl)
    audioRef.current = audio
    audio.onended = () => setPlayingIndex(null)
    audio.onerror = () => setPlayingIndex(null)
    void audio.play()
  }

  const handleConfirmSelection = () => {
    if (selectedIndex !== null && generatedVoices[selectedIndex]) {
      if (hasExistingVoice) {
        setShowConfirmDialog(true)
      } else {
        doSave()
      }
    }
  }

  const doSave = () => {
    if (selectedIndex !== null && generatedVoices[selectedIndex]) {
      const voice = generatedVoices[selectedIndex]
      onSave(voice.voiceId, voice.audioBase64)
      handleClose()
    }
  }

  const handleClose = () => {
    setVoicePrompt('')
    setPreviewText(tv('defaultPreviewText'))
    setSchemeCount(String(DEFAULT_VOICE_SCHEME_COUNT))
    setError(null)
    setGeneratedVoices([])
    setSelectedIndex(null)
    setShowConfirmDialog(false)
    setPlayingIndex(null)
    if (audioRef.current) {
      audioRef.current.pause()
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <>
      <ProductModalShell
        open={isOpen}
        onClose={handleClose}
        size="md"
        eyebrow="Voice Lab"
        title={tv('designVoiceFor', { speaker })}
        description={hasExistingVoice ? tv('hasExistingVoice') : '生成多个可试听方案，确认后绑定到当前角色。'}
      >
        <div className="space-y-4">
          <VoiceDesignGeneratorSection
            voicePrompt={voicePrompt}
            onVoicePromptChange={setVoicePrompt}
            previewText={previewText}
            onPreviewTextChange={setPreviewText}
            schemeCount={schemeCount}
            onSchemeCountChange={setSchemeCount}
            isSubmitting={isDesignSubmitting}
            submittingState={designSubmittingState}
            error={error}
            generatedVoices={generatedVoices}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            playingIndex={playingIndex}
            onPlayVoice={handlePlayVoice}
            onGenerate={() => {
              void handleGenerate()
            }}
            footer={(
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    void handleGenerate()
                  }}
                  disabled={isDesignSubmitting}
                  className="inline-flex h-10 flex-1 items-center justify-center border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-stone-100 hover:bg-white/[0.08]"
                >
                  {tv('regenerate')}
                </button>
                <button
                  onClick={handleConfirmSelection}
                  disabled={selectedIndex === null}
                  className="inline-flex h-10 flex-1 items-center justify-center bg-[#e8d18a] px-4 text-sm font-semibold text-[#171810] hover:bg-[#f3e9cf] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tv('confirmUse')}
                </button>
              </div>
            )}
          />
        </div>
      </ProductModalShell>

      <ProductModalShell
        open={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        size="md"
        eyebrow="确认替换"
        title={tv('confirmReplace')}
        description={tv('replaceWarning')}
        footer={(
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowConfirmDialog(false)} className="inline-flex h-10 items-center border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-stone-100 hover:bg-white/[0.08]">{t('cancel')}</button>
            <button onClick={doSave} className="inline-flex h-10 items-center bg-rose-300 px-4 text-sm font-semibold text-[#251316] hover:bg-rose-200">{tv('confirmReplaceBtn')}</button>
          </div>
        )}
      >
        <div className="flex items-start gap-4 border border-amber-300/20 bg-amber-300/10 p-4">
          <AppIcon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
          <p className="text-sm leading-6 text-stone-300">当前操作会替换角色 <span className="font-semibold text-stone-50">「{speaker}」</span> 已绑定的音色。</p>
        </div>
      </ProductModalShell>
    </>
  )
}

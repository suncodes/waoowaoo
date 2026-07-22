'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { AppIcon } from '@/components/ui/icons'
import type { TaskPresentationState } from '@/lib/task/presentation'
import {
  MAX_VOICE_SCHEME_COUNT,
  MIN_VOICE_SCHEME_COUNT,
  normalizeVoiceSchemeCount,
  type GeneratedVoice,
} from './voice-design-shared'

const VOICE_PRESET_KEYS = [
  'maleBroadcaster',
  'gentleFemale',
  'matureMale',
  'livelyFemale',
  'intellectualFemale',
  'narrator',
] as const

type VoicePresetKey = (typeof VOICE_PRESET_KEYS)[number]

interface VoiceDesignGeneratorSectionProps {
  voicePrompt: string
  onVoicePromptChange: (value: string) => void
  previewText: string
  onPreviewTextChange: (value: string) => void
  schemeCount: string
  onSchemeCountChange: (value: string) => void
  isSubmitting: boolean
  submittingState: TaskPresentationState | null
  error: string | null
  generatedVoices: GeneratedVoice[]
  selectedIndex: number | null
  onSelectIndex: (index: number) => void
  playingIndex: number | null
  onPlayVoice: (index: number) => void
  onGenerate: () => void
  footer?: ReactNode
}

export default function VoiceDesignGeneratorSection({
  voicePrompt,
  onVoicePromptChange,
  previewText,
  onPreviewTextChange,
  schemeCount,
  onSchemeCountChange,
  isSubmitting,
  submittingState,
  error,
  generatedVoices,
  selectedIndex,
  onSelectIndex,
  playingIndex,
  onPlayVoice,
  onGenerate,
  footer = null,
}: VoiceDesignGeneratorSectionProps) {
  const tv = useTranslations('voice.voiceDesign')
  const normalizedSchemeCount = normalizeVoiceSchemeCount(schemeCount)

  return (
    <>
      <div>
        <div className="mb-2 text-sm text-stone-300">{tv('selectStyle')}</div>
        <div className="flex flex-wrap gap-1.5">
          {VOICE_PRESET_KEYS.map((presetKey) => {
            const prompt = tv(`presetsPrompts.${presetKey}` as `presetsPrompts.${VoicePresetKey}`)
            return (
              <button
                key={presetKey}
                onClick={() => onVoicePromptChange(prompt)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  voicePrompt === prompt
                    ? 'border-[#e8d18a]/60 bg-[#e8d18a]/10 text-[#f3e9cf]'
                    : 'border-white/10 bg-white/[0.03] text-stone-400 hover:border-white/25 hover:bg-white/[0.06]'
                }`}
              >
                {tv(`presets.${presetKey}` as `presets.${VoicePresetKey}`)}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="mb-1 text-sm text-stone-300">{tv('orCustomDescription')}</div>
        <textarea
          value={voicePrompt}
          onChange={(event) => onVoicePromptChange(event.target.value)}
          placeholder={tv('describePlaceholder')}
          className="w-full resize-y rounded-md border border-white/10 bg-[#10110f] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a]"
          rows={2}
        />
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-stone-400 hover:text-stone-100">
          {tv('editPreviewText')}
        </summary>
        <input
          type="text"
          value={previewText}
          onChange={(event) => onPreviewTextChange(event.target.value)}
          placeholder={tv('defaultPreviewText')}
          className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#10110f] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
        />
      </details>

      {generatedVoices.length === 0 && !isSubmitting && (
        <div
          role="button"
          tabIndex={!voicePrompt.trim() ? -1 : 0}
          aria-disabled={!voicePrompt.trim()}
          onClick={() => {
            if (!voicePrompt.trim()) return
            onGenerate()
          }}
          onKeyDown={(event) => {
            if (!voicePrompt.trim()) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onGenerate()
            }
          }}
          className={`w-full rounded-md bg-[#f3e9cf] py-2.5 text-sm font-semibold text-[#161512] transition-opacity hover:bg-[#fff5d9] ${
            !voicePrompt.trim() ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span>{tv('generateSchemesPrefix')}</span>
            <div
              className="group relative inline-flex items-center rounded-md px-1.5 py-0.5 transition-colors hover:bg-white/12 focus-within:bg-white/14"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <select
                value={String(normalizedSchemeCount)}
                onChange={(event) => onSchemeCountChange(event.target.value)}
                aria-label={tv('schemeCountAriaLabel')}
                className="cursor-pointer appearance-none border-0 bg-transparent pl-0 pr-3 text-sm font-semibold leading-none text-[#161512] outline-none"
              >
                {Array.from({ length: MAX_VOICE_SCHEME_COUNT - MIN_VOICE_SCHEME_COUNT + 1 }, (_, index) => {
                  const value = String(index + MIN_VOICE_SCHEME_COUNT)
                  return (
                    <option key={value} value={value} className="text-black">
                      {value}
                    </option>
                  )
                })}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-[#161512]">
                <AppIcon name="chevronDown" className="h-3 w-3" />
              </div>
            </div>
            <span>{tv('generateSchemesSuffix')}</span>
          </div>
        </div>
      )}

      {isSubmitting && submittingState && (
        <div className="py-6">
          <TaskStatusInline
            state={submittingState}
            className="justify-center text-stone-400 [&>span]:text-stone-400"
          />
        </div>
      )}

      {generatedVoices.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm text-stone-300">{tv('selectScheme')}</div>
          <div className="grid grid-cols-3 gap-2">
            {generatedVoices.map((voice, index) => (
              <div
                key={voice.voiceId}
                onClick={() => onSelectIndex(index)}
                className={`relative cursor-pointer rounded-md border p-3 text-center transition-colors ${
                  selectedIndex === index
                    ? 'border-[#e8d18a]/60 bg-[#e8d18a]/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                }`}
              >
                {selectedIndex === index && (
                  <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#e8d18a] p-0">
                    <AppIcon name="checkSolid" className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className="mb-2 text-sm font-medium text-stone-100">{tv('schemeN', { n: index + 1 })}</div>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    onPlayVoice(index)
                  }}
                  className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                    playingIndex === index
                      ? 'animate-pulse border-cyan-400/30 bg-cyan-400/10 text-cyan-100'
                      : 'border-white/10 bg-white/[0.04] text-stone-300 hover:bg-white/[0.08]'
                  }`}
                >
                  {playingIndex === index ? (
                    <AppIcon name="pause" className="w-4 h-4" />
                  ) : (
                    <AppIcon name="play" className="w-5 h-5" />
                  )}
                </button>
              </div>
            ))}
          </div>
          {footer}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}
    </>
  )
}

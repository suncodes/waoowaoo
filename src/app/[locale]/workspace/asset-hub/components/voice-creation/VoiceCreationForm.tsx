import type { ReactNode } from 'react'
import type { VoiceCreationRuntime } from './hooks/useVoiceCreation'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

interface VoiceCreationFormProps {
  runtime: VoiceCreationRuntime
  children: ReactNode
}

export default function VoiceCreationForm({ runtime, children }: VoiceCreationFormProps) {
  const {
    mode,
    voiceName,
    tHub,
    tvCreate,
    setVoiceName,
    handleModeChange,
  } = runtime

  return (
    <div className="space-y-5">
      <div>
          <SegmentedControl
            options={[
              { value: 'design' as const, label: tvCreate('aiDesignMode') },
              { value: 'upload' as const, label: tvCreate('uploadMode') },
            ]}
            value={mode}
            onChange={(val) => handleModeChange(val as 'design' | 'upload')}
          />
      </div>
      <div>
          <label className="mb-2 block text-sm font-medium text-stone-300">{tHub('voiceName')}</label>
          <input
            type="text"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            placeholder={tHub('voiceNamePlaceholder')}
            className="h-10 w-full rounded-md border border-white/10 bg-[#10110f] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
          />
        </div>

        {children}
    </div>
  )
}

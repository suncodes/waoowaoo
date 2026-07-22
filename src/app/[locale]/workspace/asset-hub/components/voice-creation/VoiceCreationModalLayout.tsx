'use client'

import ProductModalShell from '@/components/product/ProductModalShell'
import VoiceCreationForm from './VoiceCreationForm'
import VoicePreviewSection from './VoicePreviewSection'
import { useVoiceCreation, type VoiceCreationModalShellProps } from './hooks/useVoiceCreation'

export type { VoiceCreationModalShellProps }

export default function VoiceCreationModalLayout(props: VoiceCreationModalShellProps) {
  const runtime = useVoiceCreation(props)

  if (!runtime.isOpen) return null
  return (
    <ProductModalShell
      open
      onClose={runtime.handleClose}
      size="md"
      eyebrow="音色资产"
      title={runtime.tHub('addVoice')}
      description={runtime.mode === 'design' ? runtime.tvCreate('aiDesignMode') : runtime.tvCreate('uploadMode')}
    >
      <VoiceCreationForm runtime={runtime}>
        <VoicePreviewSection runtime={runtime} />
      </VoiceCreationForm>
    </ProductModalShell>
  )
}

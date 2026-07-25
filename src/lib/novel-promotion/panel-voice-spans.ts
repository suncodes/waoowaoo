import { getPrismaErrorCode } from '@/lib/prisma-error'

export function isPanelVoiceSpanTableMissing(error: unknown) {
  const code = getPrismaErrorCode(error)
  if (code === 'P2021') return true
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('novel_promotion_panel_voice_spans')
    && message.toLowerCase().includes('does not exist')
}

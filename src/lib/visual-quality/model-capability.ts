import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'

export function assertVisionInputSupported(modelKey: string): void {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) throw new Error(`MODEL_KEY_INVALID: ${modelKey}`)
  const capabilities = findBuiltinCapabilities('llm', parsed.provider, parsed.modelId)
  if (capabilities?.llm?.visionInput !== true) {
    throw new Error(`VISION_INPUT_NOT_SUPPORTED: ${modelKey}`)
  }
}

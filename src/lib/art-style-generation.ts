import {
  getArtStylePrompt,
  getArtStyleReferenceImage,
  getStyleReferenceInstruction,
} from '@/lib/constants'

export type ArtStyleMode = 'preset' | 'custom'

export interface ArtStyleGenerationInput {
  artStyleMode?: string | null
  artStyle?: string | null
  artStylePrompt?: string | null
  customArtStyleReferenceImage?: string | null
  artStyleReferenceEnabled?: boolean | null
  locale: 'zh' | 'en'
}

export interface ArtStyleGenerationResult {
  source: ArtStyleMode
  prompt: string
  referenceImage: string | null
  referenceEnabled: boolean
  referenceInstruction: string
}

export function normalizeArtStyleMode(value: string | null | undefined): ArtStyleMode {
  return value === 'custom' ? 'custom' : 'preset'
}

function normalizeOptionalText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveArtStyleForGeneration(input: ArtStyleGenerationInput): ArtStyleGenerationResult {
  const source = normalizeArtStyleMode(input.artStyleMode)
  const referenceEnabled = input.artStyleReferenceEnabled === true

  if (source === 'custom') {
    const referenceImage = normalizeOptionalText(input.customArtStyleReferenceImage) || null
    return {
      source,
      prompt: normalizeOptionalText(input.artStylePrompt),
      referenceImage,
      referenceEnabled,
      referenceInstruction: getStyleReferenceInstruction(referenceImage, referenceEnabled, input.locale),
    }
  }

  const referenceImage = getArtStyleReferenceImage(input.artStyle)
  return {
    source,
    prompt: getArtStylePrompt(input.artStyle, input.locale),
    referenceImage,
    referenceEnabled,
    referenceInstruction: getStyleReferenceInstruction(referenceImage, referenceEnabled, input.locale),
  }
}

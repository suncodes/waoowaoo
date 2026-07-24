export type PanelImageTextPolicy = 'no_text' | 'safe_area_only'

export interface PanelTextPolicy {
  imageTextPolicy: PanelImageTextPolicy
  overlayText: string
  requiredImageText: string
  reviewHint: string
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolvePanelTextPolicy(params: {
  renderMode?: string | null
  onScreenText?: string | null
}): PanelTextPolicy {
  const overlayText = normalizeText(params.onScreenText)
  const needsOverlaySpace = overlayText.length > 0 || params.renderMode === 'text_card'
  return {
    imageTextPolicy: needsOverlaySpace ? 'safe_area_only' : 'no_text',
    overlayText,
    requiredImageText: '',
    reviewHint: needsOverlaySpace
      ? 'Generated image must stay text-free and reserve clean space for downstream overlay text.'
      : 'Generated image must stay text-free.',
  }
}

export function appendPanelTextPolicyForbiddenPatterns(
  forbiddenPatterns: string[],
  policy: PanelTextPolicy,
): string[] {
  return Array.from(new Set([
    ...forbiddenPatterns,
    'Do not render any subtitles, captions, book titles, UI text, logos, watermarks, labels, numbers, or readable text inside the image.',
    'Book titles, author names, chapter titles, and promotional copy are downstream overlays, not pixels to generate.',
    policy.overlayText
      ? `Do not render the overlay copy "${policy.overlayText}" inside the image; it is composed downstream.`
      : '',
  ].filter(Boolean)))
}

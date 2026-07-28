export type SubtitleStylePreset = 'cinematic' | 'clean' | 'boxed'
export type SubtitlePosition = 'bottom' | 'middle' | 'top'

export interface SubtitleStyle {
  preset: SubtitleStylePreset
  position: SubtitlePosition
  fontSize: number | null
  fontColor: string
  outlineColor: string
  outlineWidth: number
  backgroundOpacity: number
  verticalOffset: number
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  preset: 'cinematic',
  position: 'bottom',
  fontSize: null,
  fontColor: '#FFFFFF',
  outlineColor: '#151515',
  outlineWidth: 3,
  backgroundOpacity: 0.55,
  verticalOffset: 0,
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeColor(value: unknown, fallback: string): string {
  const color = readString(value)
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback
}

export function normalizeSubtitleStyle(value: unknown): SubtitleStyle {
  const record = readRecord(value)
  const preset = record?.preset === 'clean' || record?.preset === 'boxed' || record?.preset === 'cinematic'
    ? record.preset
    : DEFAULT_SUBTITLE_STYLE.preset
  const position = record?.position === 'middle' || record?.position === 'top' || record?.position === 'bottom'
    ? record.position
    : DEFAULT_SUBTITLE_STYLE.position
  const fontSize = readFiniteNumber(record?.fontSize)
  const outlineWidth = readFiniteNumber(record?.outlineWidth)
  const backgroundOpacity = readFiniteNumber(record?.backgroundOpacity)
  const verticalOffset = readFiniteNumber(record?.verticalOffset)
  return {
    preset,
    position,
    fontSize: fontSize && fontSize > 0 ? Math.round(clamp(fontSize, 24, 120)) : null,
    fontColor: normalizeColor(record?.fontColor, DEFAULT_SUBTITLE_STYLE.fontColor),
    outlineColor: normalizeColor(record?.outlineColor, DEFAULT_SUBTITLE_STYLE.outlineColor),
    outlineWidth: outlineWidth === null ? DEFAULT_SUBTITLE_STYLE.outlineWidth : Math.round(clamp(outlineWidth, 0, 12)),
    backgroundOpacity: backgroundOpacity === null ? DEFAULT_SUBTITLE_STYLE.backgroundOpacity : clamp(backgroundOpacity, 0, 1),
    verticalOffset: verticalOffset === null ? DEFAULT_SUBTITLE_STYLE.verticalOffset : Math.round(clamp(verticalOffset, -240, 240)),
  }
}

import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'

import { ART_STYLES } from '@/lib/constants'
import { BASELINE_ART_STYLE_PROMPTS } from '@/lib/art-style-ab/baseline-prompts'
import { arkImageGeneration } from '@/lib/ark-api'

export const runtime = 'nodejs'

type ProviderMode = 'openai-compatible' | 'ark'
type StyleMode = 'preset' | 'custom'
type PromptVersion = 'old' | 'new'
type ReferenceMode = 'text-only' | 'with-reference'
type PromptLocale = 'zh' | 'en'
type ResponseFormat = 'b64_json' | 'url' | 'omit'

const CUSTOM_STYLE_VALUE = '__custom__'
const MAX_CUSTOM_REFERENCE_BYTES = 8 * 1024 * 1024

interface GenerateRequestBody {
  provider?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  model?: unknown
  contentPrompt?: unknown
  styleMode?: unknown
  styleValue?: unknown
  customStyleLabel?: unknown
  customStylePrompt?: unknown
  customReferenceImageDataUrl?: unknown
  promptVersion?: unknown
  referenceMode?: unknown
  promptLocale?: unknown
  size?: unknown
  responseFormat?: unknown
  outputFormat?: unknown
  quality?: unknown
}

interface ImageApiResult {
  imageUrl: string
  rawPayload: unknown
}

interface CustomReferenceImage {
  dataUrl: string
  blob: Blob
  filename: string
}

function isEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_ART_STYLE_AB_TEST === '1'
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const input = readString(value)
  return allowed.includes(input as T) ? input as T : fallback
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeBaseUrl(input: string): string {
  if (!input) throw new Error('baseUrl is required')
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('baseUrl must be a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https')
  }
  return parsed.toString().replace(/\/$/, '')
}

function joinEndpoint(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`
}

function pickStyle(styleValue: string) {
  const style = ART_STYLES.find((item) => item.value === styleValue)
  if (!style) throw new Error(`Unknown styleValue: ${styleValue}`)
  return style
}

function resolveStylePrompt(params: {
  styleMode: StyleMode
  styleValue: string
  customStylePrompt: string
  promptVersion: PromptVersion
  promptLocale: PromptLocale
}): string {
  if (params.styleMode === 'custom') {
    if (!params.customStylePrompt) throw new Error('customStylePrompt is required when styleMode=custom')
    if (params.promptVersion === 'old') {
      throw new Error('Custom style does not support old baseline prompt')
    }
    return params.customStylePrompt
  }

  if (params.promptVersion === 'old') {
    const baseline = BASELINE_ART_STYLE_PROMPTS[params.styleValue]
    if (!baseline) throw new Error(`Missing baseline prompt for style: ${params.styleValue}`)
    return params.promptLocale === 'en' ? baseline.promptEn : baseline.promptZh
  }

  const style = pickStyle(params.styleValue)
  return params.promptLocale === 'en' ? style.promptEn : style.promptZh
}

function buildFinalPrompt(params: {
  contentPrompt: string
  stylePrompt: string
  referenceMode: ReferenceMode
  promptLocale: PromptLocale
}): string {
  if (params.promptLocale === 'en') {
    const referenceRule = params.referenceMode === 'with-reference'
      ? 'Use the uploaded reference image only for visual style, linework, color palette, material texture, and lighting. Do not copy its subject, objects, composition, text, logo, or watermark.'
      : 'Use only the textual style description; no image reference is provided.'
    return [
      params.contentPrompt,
      '',
      `Visual style: ${params.stylePrompt}`,
      referenceRule,
      'Do not include any text, subtitles, labels, numbers, watermarks, or symbols inside the image.',
    ].join('\n')
  }

  const referenceRule = params.referenceMode === 'with-reference'
    ? '仅参考上传参考图的画面风格、线条、色彩、材质和光影，不参考其中的主体、物品、构图、文字、Logo 或水印。'
    : '仅使用文本风格描述，不提供风格参考图。'
  return [
    params.contentPrompt,
    '',
    `画面风格：${params.stylePrompt}`,
    referenceRule,
    '画面中不得出现任何文字、字幕、标签、数字、水印或符号。',
  ].join('\n')
}

function mimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.png') return 'image/png'
  return 'application/octet-stream'
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function normalizeImageDataUrl(input: string): CustomReferenceImage {
  const match = input.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/)
  if (!match) {
    throw new Error('customReferenceImageDataUrl must be a png/jpeg/webp base64 data URL')
  }

  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1]
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (bytes.length === 0) {
    throw new Error('customReferenceImageDataUrl is empty')
  }
  if (bytes.length > MAX_CUSTOM_REFERENCE_BYTES) {
    throw new Error(`customReferenceImageDataUrl is too large; max ${MAX_CUSTOM_REFERENCE_BYTES} bytes`)
  }

  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return {
    dataUrl,
    blob: new Blob([copy.buffer], { type: mimeType }),
    filename: `custom-style-reference.${extensionFromMime(mimeType)}`,
  }
}

function resolveStyleAssetPath(referenceImage: string): string {
  if (!referenceImage.startsWith('/art-styles/')) {
    throw new Error(`Unsupported style reference path: ${referenceImage}`)
  }
  const root = path.resolve(process.cwd(), 'public', 'art-styles')
  const relative = referenceImage.replace(/^\/art-styles\//, '')
  const target = path.resolve(root, relative)
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
    throw new Error(`Style reference path escapes /art-styles: ${referenceImage}`)
  }
  return target
}

async function loadStyleReferenceBlob(styleValue: string): Promise<{ blob: Blob; filename: string }> {
  const style = pickStyle(styleValue)
  if (!style.referenceImage) throw new Error(`Style has no referenceImage: ${styleValue}`)
  const filePath = resolveStyleAssetPath(style.referenceImage)
  const bytes = await fs.readFile(filePath)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return {
    blob: new Blob([copy.buffer], { type: mimeFromFilename(filePath) }),
    filename: path.basename(filePath),
  }
}

async function loadStyleReferenceDataUrl(styleValue: string): Promise<string> {
  const style = pickStyle(styleValue)
  if (!style.referenceImage) throw new Error(`Style has no referenceImage: ${styleValue}`)
  const filePath = resolveStyleAssetPath(style.referenceImage)
  const bytes = await fs.readFile(filePath)
  return `data:${mimeFromFilename(filePath)};base64,${bytes.toString('base64')}`
}

function appendOptionalJsonFields(
  payload: Record<string, unknown>,
  params: {
    size: string
    responseFormat: ResponseFormat
    outputFormat: string
    quality: string
  },
) {
  if (params.size) payload.size = params.size
  if (params.responseFormat !== 'omit') payload.response_format = params.responseFormat
  if (params.outputFormat) payload.output_format = params.outputFormat
  if (params.quality) payload.quality = params.quality
}

function appendOptionalFormFields(
  form: FormData,
  params: {
    size: string
    responseFormat: ResponseFormat
    outputFormat: string
    quality: string
  },
) {
  if (params.size) form.append('size', params.size)
  if (params.responseFormat !== 'omit') form.append('response_format', params.responseFormat)
  if (params.outputFormat) form.append('output_format', params.outputFormat)
  if (params.quality) form.append('quality', params.quality)
}

function extractImageUrl(payload: unknown, outputFormat: string): string | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    for (const key of ['imageUrl', 'image_url', 'url', 'output_url']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    const images = record.images
    if (Array.isArray(images) && images.length > 0) {
      const first = extractImageUrl(images[0], outputFormat)
      if (first) return first
    }
    const data = record.data
    if (Array.isArray(data) && data.length > 0) {
      for (const item of data) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const itemRecord = item as Record<string, unknown>
        const b64 = itemRecord.b64_json
        if (typeof b64 === 'string' && b64.trim()) {
          const mimeType = outputFormat === 'jpeg' || outputFormat === 'jpg'
            ? 'image/jpeg'
            : outputFormat === 'webp'
              ? 'image/webp'
              : 'image/png'
          return `data:${mimeType};base64,${b64.trim()}`
        }
        for (const key of ['url', 'image_url', 'imageUrl']) {
          const value = itemRecord[key]
          if (typeof value === 'string' && value.trim()) return value.trim()
        }
      }
    }
  }
  return null
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return { rawText: text }
  }
}

function extractProviderError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    const error = record.error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message.trim()
    }
    const message = record.message
    if (typeof message === 'string' && message.trim()) return message.trim()
    const rawText = record.rawText
    if (typeof rawText === 'string' && rawText.trim()) return rawText.slice(0, 800)
  }
  return `Image API request failed with status ${status}`
}

async function callOpenAICompatibleImage(params: {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  styleMode: StyleMode
  styleValue: string
  customReferenceImage: CustomReferenceImage | null
  referenceMode: ReferenceMode
  size: string
  responseFormat: ResponseFormat
  outputFormat: string
  quality: string
}): Promise<ImageApiResult> {
  const commonFields = {
    size: params.size,
    responseFormat: params.responseFormat,
    outputFormat: params.outputFormat,
    quality: params.quality,
  }

  if (params.referenceMode === 'with-reference') {
    const { blob, filename } = params.styleMode === 'custom'
      ? params.customReferenceImage ?? (() => { throw new Error('customReferenceImageDataUrl is required when referenceMode=with-reference') })()
      : await loadStyleReferenceBlob(params.styleValue)
    const form = new FormData()
    form.append('model', params.model)
    form.append('prompt', params.prompt)
    form.append('image', blob, filename)
    form.append('n', '1')
    appendOptionalFormFields(form, commonFields)

    const response = await fetch(joinEndpoint(params.baseUrl, '/images/edits'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: form,
    })
    const payload = await readResponsePayload(response)
    if (!response.ok) throw new Error(extractProviderError(payload, response.status))
    const imageUrl = extractImageUrl(payload, params.outputFormat)
    if (!imageUrl) throw new Error('Image API response does not contain image url or b64_json')
    return { imageUrl, rawPayload: payload }
  }

  const payload: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: 1,
  }
  appendOptionalJsonFields(payload, commonFields)

  const response = await fetch(joinEndpoint(params.baseUrl, '/images/generations'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const responsePayload = await readResponsePayload(response)
  if (!response.ok) throw new Error(extractProviderError(responsePayload, response.status))
  const imageUrl = extractImageUrl(responsePayload, params.outputFormat)
  if (!imageUrl) throw new Error('Image API response does not contain image url or b64_json')
  return { imageUrl, rawPayload: responsePayload }
}

async function callArkImage(params: {
  apiKey: string
  model: string
  prompt: string
  styleMode: StyleMode
  styleValue: string
  customReferenceImage: CustomReferenceImage | null
  referenceMode: ReferenceMode
  size: string
  responseFormat: ResponseFormat
  outputFormat: string
}): Promise<ImageApiResult> {
  const responseFormat = params.responseFormat === 'b64_json' ? 'b64_json' : 'url'
  const payload: {
    model: string
    prompt: string
    sequential_image_generation: 'disabled'
    response_format: 'url' | 'b64_json'
    stream: false
    watermark: false
    size?: string
    image?: string[]
  } = {
    model: params.model,
    prompt: params.prompt,
    sequential_image_generation: 'disabled',
    response_format: responseFormat,
    stream: false,
    watermark: false,
  }

  if (params.size) {
    payload.size = params.size
  }
  if (params.referenceMode === 'with-reference') {
    payload.image = [
      params.styleMode === 'custom'
        ? params.customReferenceImage?.dataUrl ?? (() => { throw new Error('customReferenceImageDataUrl is required when referenceMode=with-reference') })()
        : await loadStyleReferenceDataUrl(params.styleValue),
    ]
  }

  const responsePayload = await arkImageGeneration(payload, {
    apiKey: params.apiKey,
    logPrefix: '[ArtStyleAB Ark Image]',
  })
  const imageUrl = extractImageUrl(responsePayload, params.outputFormat)
  if (!imageUrl) throw new Error('Ark image API response does not contain image url or b64_json')
  return { imageUrl, rawPayload: responsePayload }
}

export async function POST(request: NextRequest) {
  if (!isEnabled()) {
    return jsonError('ART_STYLE_AB_TEST_DISABLED', 404)
  }

  let body: GenerateRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const provider = readEnum<ProviderMode>(body.provider, ['openai-compatible', 'ark'], 'openai-compatible')
  const baseUrlRaw = readString(body.baseUrl)
  const apiKey = readString(body.apiKey)
  const model = readString(body.model)
  const contentPrompt = readString(body.contentPrompt)
  const styleMode = readEnum<StyleMode>(body.styleMode, ['preset', 'custom'], 'preset')
  const styleValue = readString(body.styleValue)
  const customStyleLabel = readString(body.customStyleLabel) || '自定义风格'
  const customStylePrompt = readString(body.customStylePrompt)
  const customReferenceImageDataUrl = readString(body.customReferenceImageDataUrl)
  const promptVersion = readEnum<PromptVersion>(body.promptVersion, ['old', 'new'], 'new')
  const referenceMode = readEnum<ReferenceMode>(body.referenceMode, ['text-only', 'with-reference'], 'text-only')
  const promptLocale = readEnum<PromptLocale>(body.promptLocale, ['zh', 'en'], 'zh')
  const responseFormat = readEnum<ResponseFormat>(body.responseFormat, ['b64_json', 'url', 'omit'], 'b64_json')
  const size = readString(body.size) || (provider === 'ark' ? '1920x1920' : '1024x1024')
  const outputFormat = readString(body.outputFormat)
  const quality = readString(body.quality)

  try {
    if (!apiKey) throw new Error('apiKey is required')
    if (!model) throw new Error('model is required')
    if (!contentPrompt) throw new Error('contentPrompt is required')
    if (styleMode === 'preset' && !styleValue) throw new Error('styleValue is required')
    if (styleMode === 'custom' && !customStylePrompt) throw new Error('customStylePrompt is required')
    const style = styleMode === 'custom' ? null : pickStyle(styleValue)
    const customReferenceImage = customReferenceImageDataUrl
      ? normalizeImageDataUrl(customReferenceImageDataUrl)
      : null
    const stylePrompt = resolveStylePrompt({
      styleMode,
      styleValue,
      customStylePrompt,
      promptVersion,
      promptLocale,
    })
    const finalPrompt = buildFinalPrompt({
      contentPrompt,
      stylePrompt,
      referenceMode,
      promptLocale,
    })

    const result = provider === 'ark'
      ? await callArkImage({
        apiKey,
        model,
        prompt: finalPrompt,
        styleMode,
        styleValue,
        customReferenceImage,
        referenceMode,
        size,
        responseFormat,
        outputFormat,
      })
      : await callOpenAICompatibleImage({
        baseUrl: normalizeBaseUrl(baseUrlRaw),
        apiKey,
        model,
        prompt: finalPrompt,
        styleMode,
        styleValue,
        customReferenceImage,
        referenceMode,
        size,
        responseFormat,
        outputFormat,
        quality,
      })

    return NextResponse.json({
      imageUrl: result.imageUrl,
      prompt: finalPrompt,
      style: {
        value: style?.value ?? CUSTOM_STYLE_VALUE,
        label: style?.label ?? customStyleLabel,
        referenceImage: style?.referenceImage || (customReferenceImage ? 'custom-upload' : null),
      },
      meta: {
        provider,
        styleMode,
        promptVersion,
        referenceMode,
        promptLocale,
        size,
        responseFormat,
        outputFormat: outputFormat || null,
        quality: quality || null,
      },
    })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400)
  }
}

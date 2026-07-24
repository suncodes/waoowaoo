import type { VideoProfile } from '@/lib/video-profile'
import type { VisualAssetRef, VisualLicense } from './types'

type VisualAssetKind = VisualAssetRef['kind']

export type VisualBeatFunction =
  | 'hook'
  | 'concept_setup'
  | 'evidence'
  | 'contrast'
  | 'wonder'
  | 'character_moment'
  | 'reading_advice'
  | 'cta'

export interface VisualBeatAssetNeed {
  name: string
  expectedKind: VisualAssetKind
  role: 'primary_subject' | 'supporting_visible' | 'environment' | 'reference_only'
  mustLock: boolean
  assetId?: string
}

export interface VisualBeat {
  id: string
  clipId: string
  narrationSlice: string
  sourceAnchor: {
    label: string
    sourceText: string
    sourceType: 'clip' | 'content_plan'
    confidence: number
  }
  beatFunction: VisualBeatFunction
  visualLicense: VisualLicense
  screenEvent: string
  subject: string
  actionMoment: string
  continuityIn: string
  continuityOut: string
  assetNeeds: VisualBeatAssetNeed[]
  recommendedShotCount: number
  riskFlags: string[]
}

export interface VisualBeatPlan {
  schemaVersion: 1
  profilePreset: string
  strategy: string
  beats: VisualBeat[]
}

interface ClipInput {
  id: string
  summary?: string | null
  content?: string | null
  screenplay?: string | null
  characters?: string | null
  location?: string | null
  props?: string | null
  duration?: number | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
      : []
  } catch {
    return value.split(/[，,、/|]/u).map((item) => item.trim()).filter(Boolean)
  }
}

function clipText(clip: ClipInput): string {
  return [
    clip.summary,
    clip.content,
    clip.screenplay,
    clip.characters,
    clip.location,
    clip.props,
  ].map(text).filter(Boolean).join(' ')
}

function assetAliases(asset: VisualAssetRef): string[] {
  return [
    asset.name,
    ...asset.name.split(/[\/|,，、：《》"“”'’‘\s]+/u),
  ].map((item) => item.trim()).filter((item) => item.length >= 2)
}

function mentionedAssets(clip: ClipInput, assets: VisualAssetRef[]): VisualAssetRef[] {
  const source = normalize(clipText(clip))
  const explicitNames = new Set([
    ...parseStringArray(clip.characters),
    ...parseStringArray(clip.props),
    ...(text(clip.location) ? [text(clip.location)] : []),
  ].map(normalize))
  return assets.filter((asset) => (
    explicitNames.has(normalize(asset.name))
    || assetAliases(asset).some((alias) => source.includes(normalize(alias)))
  ))
}

function beatFunctionForClip(clip: ClipInput, index: number, total: number): VisualBeatFunction {
  const source = normalize(clipText(clip))
  if (index === 0) return 'hook'
  if (index === total - 1) return /(关注|读|阅读|推荐|适合|入门|结尾|行动|cta|subscribe)/iu.test(source) ? 'cta' : 'reading_advice'
  if (/(为什么|原因|关键|证据|事实|资料|核心|evidence|why|because)/iu.test(source)) return 'evidence'
  if (/(对比|反差|但是|然而|contrast|but|versus|vs)/iu.test(source)) return 'contrast'
  if (/(奇观|震撼|深海|宇宙|巨大|wonder|spectacle)/iu.test(source)) return 'wonder'
  if (/(人物|角色|内心|情绪|选择|船长|教授|character|emotion)/iu.test(source)) return 'character_moment'
  return 'concept_setup'
}

function visualLicenseForClip(clip: ClipInput, beatFunction: VisualBeatFunction): VisualLicense {
  const source = normalize(clipText(clip))
  if (/(金句|引用|标题|字幕|quote|caption)/iu.test(source)) return 'text_card'
  if (/(转场|过渡|transition)/iu.test(source)) return 'transition'
  if (/(比喻|象征|隐喻|metaphor|symbolic)/iu.test(source)) return 'metaphor'
  if (beatFunction === 'evidence' || beatFunction === 'character_moment') return 'literal'
  return 'illustrative'
}

function expectedRole(asset: VisualAssetRef, index: number): VisualBeatAssetNeed['role'] {
  if (asset.kind === 'location') return 'environment'
  if (index === 0) return 'primary_subject'
  return asset.kind === 'character' ? 'supporting_visible' : 'primary_subject'
}

function assetNeedFor(asset: VisualAssetRef, index: number, beatFunction: VisualBeatFunction): VisualBeatAssetNeed {
  const role = expectedRole(asset, index)
  return {
    name: asset.name,
    expectedKind: asset.kind,
    role,
    mustLock: role === 'primary_subject' || beatFunction === 'hook' || beatFunction === 'character_moment',
    assetId: asset.id,
  }
}

function recommendedShotCount(clip: ClipInput, beatFunction: VisualBeatFunction): number {
  const duration = typeof clip.duration === 'number' && Number.isFinite(clip.duration) ? clip.duration : 0
  if (duration >= 18 && (beatFunction === 'evidence' || beatFunction === 'wonder')) return 2
  return 1
}

function riskFlagsForBeat(clip: ClipInput, assetNeeds: VisualBeatAssetNeed[], visualLicense: VisualLicense): string[] {
  const flags: string[] = []
  const source = normalize(clipText(clip))
  if (assetNeeds.length === 0 && visualLicense !== 'text_card' && visualLicense !== 'transition') flags.push('no_locked_asset')
  if (assetNeeds.filter((item) => item.role === 'primary_subject').length > 1) flags.push('multi_primary_subject')
  if (/(混剪|拼接|依次|同时展示|多个场景|split|collage|montage)/iu.test(source)) flags.push('too_many_visual_moments')
  if (/(书名|标题|年份|文字|caption|title|text)/iu.test(source)) flags.push('text_prone')
  return flags
}

function subjectForBeat(clip: ClipInput, assets: VisualAssetRef[]): string {
  const primary = assets.find((asset) => asset.kind !== 'location') || assets[0]
  return primary?.name || text(clip.summary) || truncate(text(clip.content), 32) || '当前导读信息'
}

export function buildVisualBeatPlan(params: {
  profile: VideoProfile
  clips: ClipInput[]
  assets: VisualAssetRef[]
}): VisualBeatPlan {
  const beats = params.clips.map((clip, index) => {
    const sourceText = clipText(clip)
    const assets = mentionedAssets(clip, params.assets)
    const beatFunction = beatFunctionForClip(clip, index, params.clips.length)
    const visualLicense = visualLicenseForClip(clip, beatFunction)
    const subject = subjectForBeat(clip, assets)
    const assetNeeds = assets.map((asset, assetIndex) => assetNeedFor(asset, assetIndex, beatFunction))
    const sourceAnchorLabel = text(clip.summary) || `clip_${index + 1}`
    return {
      id: `beat_${index + 1}`,
      clipId: clip.id,
      narrationSlice: truncate(text(clip.content) || sourceText, 220),
      sourceAnchor: {
        label: sourceAnchorLabel,
        sourceText: truncate(sourceText, 360),
        sourceType: 'clip' as const,
        confidence: sourceText ? 0.82 : 0.62,
      },
      beatFunction,
      visualLicense,
      screenEvent: `${subject} 在画面中承担 ${beatFunction} 功能，呈现一个可被单帧捕捉的关键瞬间`,
      subject,
      actionMoment: `${subject} 处于当前旁白信息的可见动作或状态变化中`,
      continuityIn: index === 0 ? '建立全片视觉钩子和主调' : '承接上一镜的主体、光色或信息方向',
      continuityOut: index === params.clips.length - 1 ? '收束到阅读建议或行动指向' : '把视线、动作或信息线索交给下一镜',
      assetNeeds,
      recommendedShotCount: recommendedShotCount(clip, beatFunction),
      riskFlags: riskFlagsForBeat(clip, assetNeeds, visualLicense),
    }
  })

  return {
    schemaVersion: 1,
    profilePreset: params.profile.preset,
    strategy: '先把口播段落转成可拍摄的视听节拍，再规划具体分镜；每个镜头必须有画面动作、来源锚点、资产需求和连续性职责。',
    beats,
  }
}

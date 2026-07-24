import type { VideoProfile } from '@/lib/video-profile'
import type { RenderMode, ShotFunction, VisualLicense } from './types'
import type { VisualBeat, VisualBeatPlan } from './visual-beat-plan'

const TARGET_GENERATED_IMAGE_DURATION_SEC = 8
const MAX_GENERATED_IMAGE_DURATION_SEC = 12

interface ClipInput {
  id: string
  summary?: string | null
  content?: string | null
  duration?: number | null
}

export interface VisualShotSlot {
  id: string
  clipId: string
  beatId: string
  slotIndex: number
  slotsInBeat: number
  targetDurationSec: number
  maxGeneratedImageDurationSec: number
  shotFunction: ShotFunction
  visualLicense: VisualLicense
  preferredRenderMode: RenderMode
  primarySubject: string
  screenEvent: string
  actionMoment: string
  continuityIn: string
  continuityOut: string
  requiredAssetIds: string[]
  constraints: string[]
}

export interface VisualShotSlotPlan {
  schemaVersion: 1
  strategy: string
  maxGeneratedImageDurationSec: number
  targetGeneratedImageDurationSec: number
  slots: VisualShotSlot[]
}

function finiteDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}

function roundDuration(value: number): number {
  return Math.round(value * 10) / 10
}

function shotFunctionForBeat(beat: VisualBeat): ShotFunction {
  if (beat.beatFunction === 'hook') return 'hook'
  if (beat.beatFunction === 'evidence' || beat.beatFunction === 'contrast') return 'evidence'
  if (beat.beatFunction === 'character_moment') return 'reaction'
  if (beat.beatFunction === 'reading_advice') return 'payoff'
  if (beat.beatFunction === 'cta') return 'cta'
  return 'setup'
}

function preferredRenderModeForBeat(beat: VisualBeat): RenderMode {
  if (beat.visualLicense === 'text_card') return 'text_card'
  if (beat.riskFlags.includes('text_prone')) return 'composite'
  return 'generated_image'
}

function clipDuration(clip: ClipInput | undefined, fallbackSec: number): number {
  return finiteDuration(clip?.duration) || fallbackSec
}

function slotCountForBeat(beat: VisualBeat, durationSec: number): number {
  const durationSlots = Math.max(1, Math.ceil(durationSec / TARGET_GENERATED_IMAGE_DURATION_SEC))
  const riskSlots = beat.riskFlags.some((flag) => (
    flag === 'too_many_visual_moments'
    || flag === 'multi_primary_subject'
  )) ? 2 : 1
  return Math.max(beat.recommendedShotCount || 1, durationSlots, riskSlots)
}

function actionMomentForSlot(beat: VisualBeat, slotIndex: number, slotsInBeat: number): string {
  if (slotsInBeat === 1) return beat.actionMoment
  if (slotIndex === 1) return `${beat.subject} 建立清晰的起始状态`
  if (slotIndex === slotsInBeat) return `${beat.subject} 完成这一节拍的关键结果`
  return `${beat.subject} 推进第 ${slotIndex} 个单一动作瞬间`
}

export function buildVisualShotSlotPlan(params: {
  profile: VideoProfile
  clips: ClipInput[]
  beatPlan: VisualBeatPlan
}): VisualShotSlotPlan {
  const clipById = new Map(params.clips.map((clip) => [clip.id, clip]))
  const fallbackClipDuration = params.beatPlan.beats.length > 0
    ? params.profile.targetDurationSec / params.beatPlan.beats.length
    : TARGET_GENERATED_IMAGE_DURATION_SEC
  const slots: VisualShotSlot[] = []

  for (const beat of params.beatPlan.beats) {
    const durationSec = clipDuration(clipById.get(beat.clipId), fallbackClipDuration)
    const slotsInBeat = slotCountForBeat(beat, durationSec)
    const targetDurationSec = roundDuration(Math.max(1, durationSec / slotsInBeat))
    const requiredAssetIds = beat.assetNeeds.flatMap((need) => (
      need.mustLock && need.assetId ? [need.assetId] : []
    ))

    for (let index = 1; index <= slotsInBeat; index += 1) {
      slots.push({
        id: `slot_${slots.length + 1}`,
        clipId: beat.clipId,
        beatId: beat.id,
        slotIndex: index,
        slotsInBeat,
        targetDurationSec,
        maxGeneratedImageDurationSec: MAX_GENERATED_IMAGE_DURATION_SEC,
        shotFunction: shotFunctionForBeat(beat),
        visualLicense: beat.visualLicense,
        preferredRenderMode: preferredRenderModeForBeat(beat),
        primarySubject: beat.subject,
        screenEvent: beat.screenEvent,
        actionMoment: actionMomentForSlot(beat, index, slotsInBeat),
        continuityIn: index === 1 ? beat.continuityIn : `${beat.subject} 延续上一槽位的动作方向和光色`,
        continuityOut: index === slotsInBeat ? beat.continuityOut : `${beat.subject} 把动作或视线交给下一槽位`,
        requiredAssetIds,
        constraints: [
          '每个槽位只能生成一个 visualUnit',
          'generated_image 必须是单一时空、单一构图、一个主要视觉事件',
          `generated_image.durationSec 必须小于或等于 ${MAX_GENERATED_IMAGE_DURATION_SEC}`,
          'generated_image.shotSpec.actionBeats 只允许一个主动作，可额外保留一个轻微环境动作',
          '如果槽位无法用单张完整画面表达，必须改为 composite、diagram 或 text_card，不得混剪或拼接',
        ],
      })
    }
  }

  return {
    schemaVersion: 1,
    strategy: '先由本地规则按旁白时长和视觉复杂度分配受限镜头槽位；LLM 只能填充槽位内容，不应自由合并成长镜头。',
    maxGeneratedImageDurationSec: MAX_GENERATED_IMAGE_DURATION_SEC,
    targetGeneratedImageDurationSec: TARGET_GENERATED_IMAGE_DURATION_SEC,
    slots,
  }
}

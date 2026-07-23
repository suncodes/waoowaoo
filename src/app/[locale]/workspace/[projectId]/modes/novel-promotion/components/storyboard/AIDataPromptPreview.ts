import type {
  ActingCharacter,
  ActingNotes,
  AIDataCharacter,
  PhotographyRules,
} from './AIDataModal.types'

export interface AIDataPromptPreview {
  image: string
  video: string
  imageSource: 'snapshot' | 'draft'
  videoSource: 'snapshot' | 'draft'
  imageMeta?: AIDataPromptSnapshotMeta
  videoMeta?: AIDataPromptSnapshotMeta
}

export interface AIDataPromptSnapshotMeta {
  modelKey: string
  promptHash: string
  createdAt: string
}

export interface AIDataPromptSnapshot {
  artifactType: string
  modelKey: string
  promptHash: string
  compiledPrompt: string
  createdAt: string
}

export interface AIDataPromptSnapshotSet {
  image: AIDataPromptSnapshot | null
  video: AIDataPromptSnapshot | null
}

function cleanText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function joinParts(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join('\n')
}

function actingSummary(actingNotes: ActingNotes | ActingCharacter[] | null): string {
  if (!actingNotes) return ''
  const characters = Array.isArray(actingNotes) ? actingNotes : actingNotes.characters
  return characters
    .map((item) => `${item.name}: ${item.acting}`)
    .filter((item) => item.trim().length > 1)
    .join('；')
}

export function buildAIDataPromptPreview(params: {
  videoRatio: string
  shotType: string | null
  cameraMove: string | null
  description: string | null
  location: string | null
  characters: AIDataCharacter[]
  imagePrompt: string | null
  videoPrompt: string | null
  photographyRules: PhotographyRules | null
  actingNotes: ActingNotes | ActingCharacter[] | null
}): AIDataPromptPreview {
  const characterLocks = params.characters
    .map((character) => [
      character.name,
      cleanText(character.appearance),
      cleanText(character.slot) ? `站位：${cleanText(character.slot)}` : '',
    ].filter(Boolean).join('，'))
    .join('；')
  const photography = params.photographyRules
  const lighting = photography?.lighting
    ? [photography.lighting.direction, photography.lighting.quality].map(cleanText).filter(Boolean).join('，')
    : ''
  const acting = actingSummary(params.actingNotes)
  const imagePreview = joinParts([
    `画幅：${params.videoRatio}`,
    `镜头：${cleanText(params.shotType) || '当前景别'}，${cleanText(params.cameraMove) || '稳定机位'}`,
    `主体与资产：${characterLocks || '按镜头描述保持唯一主视觉主体'}`,
    `场景：${cleanText(params.location) || cleanText(photography?.scene_summary) || '与镜头描述一致的具体空间'}`,
    `画面动作：${cleanText(params.imagePrompt) || cleanText(params.description) || '当前分镜的关键瞬间'}`,
    lighting ? `光线：${lighting}` : '',
    photography?.depth_of_field ? `景深：${photography.depth_of_field}` : '',
    photography?.color_tone ? `色彩：${photography.color_tone}` : '',
    acting ? `表演：${acting}` : '',
    '禁止：文字、水印、标志、多格拼图、未指定角色、风格替换角色身份。',
  ])
  const videoPreview = joinParts([
    '图生视频：源图作为锁定首帧，不重新设计静态外观。',
    `主体主运动：${cleanText(params.videoPrompt) || cleanText(params.description) || '符合分镜意图的轻微受控运动'}`,
    `摄影机运动：${cleanText(params.cameraMove) || '锁定机位或轻微运动'}`,
    lighting ? `光色连续性：${lighting}` : '',
    acting ? `表演连续性：${acting}` : '',
    '结束状态：停在稳定、可读、便于衔接下一镜的姿态。',
    '禁止：改脸、改服装、增加角色、生成文字、跳剪、分屏、过度抖动。',
  ])
  return {
    image: imagePreview,
    video: videoPreview,
    imageSource: 'draft',
    videoSource: 'draft',
  }
}

function snapshotPrompt(snapshot: AIDataPromptSnapshot | null | undefined): string {
  return typeof snapshot?.compiledPrompt === 'string' && snapshot.compiledPrompt.trim()
    ? snapshot.compiledPrompt.trim()
    : ''
}

function snapshotMeta(snapshot: AIDataPromptSnapshot): AIDataPromptSnapshotMeta {
  return {
    modelKey: snapshot.modelKey,
    promptHash: snapshot.promptHash,
    createdAt: snapshot.createdAt,
  }
}

export function applyPromptSnapshotsToPreview(
  draft: AIDataPromptPreview,
  snapshots: AIDataPromptSnapshotSet | null,
): AIDataPromptPreview {
  const imagePrompt = snapshotPrompt(snapshots?.image)
  const videoPrompt = snapshotPrompt(snapshots?.video)
  return {
    image: imagePrompt || draft.image,
    video: videoPrompt || draft.video,
    imageSource: imagePrompt ? 'snapshot' : draft.imageSource,
    videoSource: videoPrompt ? 'snapshot' : draft.videoSource,
    ...(imagePrompt && snapshots?.image ? { imageMeta: snapshotMeta(snapshots.image) } : {}),
    ...(videoPrompt && snapshots?.video ? { videoMeta: snapshotMeta(snapshots.video) } : {}),
  }
}

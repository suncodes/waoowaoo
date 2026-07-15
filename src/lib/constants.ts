/**
 * 主形象的 appearanceIndex 值。
 * 所有判断主/子形象的逻辑必须引用此常量，禁止硬编码数字。
 * 子形象的 appearanceIndex 从 PRIMARY_APPEARANCE_INDEX + 1 开始递增。
 */
export const PRIMARY_APPEARANCE_INDEX = 0

// 比例配置（nanobanana 支持的所有比例，按常用程度排序）
export const ASPECT_RATIO_CONFIGS: Record<string, { label: string; isVertical: boolean }> = {
  '16:9': { label: '16:9', isVertical: false },
  '9:16': { label: '9:16', isVertical: true },
  '1:1': { label: '1:1', isVertical: false },
  '3:2': { label: '3:2', isVertical: false },
  '2:3': { label: '2:3', isVertical: true },
  '4:3': { label: '4:3', isVertical: false },
  '3:4': { label: '3:4', isVertical: true },
  '5:4': { label: '5:4', isVertical: false },
  '4:5': { label: '4:5', isVertical: true },
  '21:9': { label: '21:9', isVertical: false },
}

// 配置页面使用的选项列表（从 ASPECT_RATIO_CONFIGS 派生）
export const VIDEO_RATIOS = Object.entries(ASPECT_RATIO_CONFIGS).map(([value, config]) => ({
  value,
  label: config.label
}))

// 获取比例配置
export function getAspectRatioConfig(ratio: string) {
  return ASPECT_RATIO_CONFIGS[ratio] || ASPECT_RATIO_CONFIGS['16:9']
}

export const ANALYSIS_MODELS = [
  { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' }
]

export const IMAGE_MODELS = [
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' }
]

// 图像模型选项（ 生成完整图片）
export const IMAGE_MODEL_OPTIONS = [
  { value: 'banana', label: 'Banana Pro (FAL)' },
  { value: 'banana-2', label: 'Banana 2 (FAL)' },
  { value: 'gemini-3-pro-image-preview', label: 'Banana (Google)' },
  { value: 'gemini-3-pro-image-preview-batch', label: 'Banana (Google Batch) 省50%' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' },
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'imagen-4.0-generate-001', label: 'Imagen 4.0 (Google)' },
  { value: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4.0 Ultra' },
  { value: 'imagen-4.0-fast-generate-001', label: 'Imagen 4.0 Fast' }
]

// Banana 模型分辨率选项（仅用于九宫格分镜图，单张生成固定2K）
export const BANANA_RESOLUTION_OPTIONS = [
  { value: '2K', label: '2K (推荐，快速)' },
  { value: '4K', label: '4K (高清，较慢)' }
]

// 支持分辨率选择的 Banana 模型
export const BANANA_MODELS = ['banana', 'banana-2', 'gemini-3-pro-image-preview', 'gemini-3-pro-image-preview-batch']

export const VIDEO_MODELS = [
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0' },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
  { value: 'doubao-seedance-1-0-pro-fast-251015', label: 'Seedance 1.0 Pro Fast' },
  { value: 'doubao-seedance-1-0-pro-fast-251015-batch', label: 'Seedance 1.0 Pro Fast (批量) 省50%' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428', label: 'Seedance 1.0 Lite' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428-batch', label: 'Seedance 1.0 Lite (批量) 省50%' },
  { value: 'doubao-seedance-1-5-pro-251215', label: 'Seedance 1.5 Pro' },
  { value: 'doubao-seedance-1-5-pro-251215-batch', label: 'Seedance 1.5 Pro (批量) 省50%' },
  { value: 'doubao-seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro' },
  { value: 'doubao-seedance-1-0-pro-250528-batch', label: 'Seedance 1.0 Pro (批量) 省50%' },
  { value: 'fal-wan25', label: 'Wan 2.6' },
  { value: 'fal-veo31', label: 'Veo 3.1 Fast' },
  { value: 'fal-sora2', label: 'Sora 2' },
  { value: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', label: 'Kling 2.5 Turbo Pro' },
  { value: 'fal-ai/kling-video/v3/standard/image-to-video', label: 'Kling 3 Standard' },
  { value: 'fal-ai/kling-video/v3/pro/image-to-video', label: 'Kling 3 Pro' }
]

// SeeDream 批量模型列表（使用 GPU 空闲时间，成本降低50%）
export const SEEDANCE_BATCH_MODELS = [
  'doubao-seedance-1-5-pro-251215-batch',
  'doubao-seedance-1-0-pro-250528-batch',
  'doubao-seedance-1-0-pro-fast-251015-batch',
  'doubao-seedance-1-0-lite-i2v-250428-batch',
]

// 支持生成音频的模型
export const AUDIO_SUPPORTED_MODELS = [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-1-5-pro-251215',
  'doubao-seedance-1-5-pro-251215-batch',
]

// 首尾帧视频模型（能力权威来源是 standards/capabilities；此常量仅作静态兜底展示）
export const FIRST_LAST_FRAME_MODELS = [
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0 (首尾帧)' },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast (首尾帧)' },
  { value: 'doubao-seedance-1-5-pro-251215', label: 'Seedance 1.5 Pro (首尾帧)' },
  { value: 'doubao-seedance-1-5-pro-251215-batch', label: 'Seedance 1.5 Pro (首尾帧/批量) 省50%' },
  { value: 'doubao-seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro (首尾帧)' },
  { value: 'doubao-seedance-1-0-pro-250528-batch', label: 'Seedance 1.0 Pro (首尾帧/批量) 省50%' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428', label: 'Seedance 1.0 Lite (首尾帧)' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428-batch', label: 'Seedance 1.0 Lite (首尾帧/批量) 省50%' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (首尾帧)' },
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast (首尾帧)' }
]

export const VIDEO_RESOLUTIONS = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' }
]

export const TTS_RATES = [
  { value: '+0%', label: '正常速度 (1.0x)' },
  { value: '+20%', label: '轻微加速 (1.2x)' },
  { value: '+50%', label: '加速 (1.5x)' },
  { value: '+100%', label: '快速 (2.0x)' }
]

export const TTS_VOICES = [
  { value: 'zh-CN-YunxiNeural', label: '云希 (男声)', preview: '男' },
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女声)', preview: '女' },
  { value: 'zh-CN-YunyangNeural', label: '云扬 (男声)', preview: '男' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊 (女声)', preview: '女' }
]

export interface ArtStyleDefinition {
  value: string
  label: string
  preview: string
  promptZh: string
  promptEn: string
  previewImage?: string
  referenceImage?: string
}

export const ART_STYLES = [
  {
    value: 'american-comic',
    label: '漫画风',
    preview: '漫',
    promptZh: '现代美式漫画风格，清晰有力的墨线，饱满平涂色块，适度网点和动态构图，画面干净利落。',
    promptEn: 'Modern American comic style with bold clean ink lines, saturated flat colors, subtle halftone texture, dynamic composition, and a crisp polished look.',
    previewImage: '/art-styles/american-comic.png',
    referenceImage: '/art-styles/american-comic.png',
  },
  {
    value: 'chinese-comic',
    label: '精致国漫',
    preview: '国',
    promptZh: '现代高质量漫画风格，动漫风格，细节丰富精致，线条锐利干净，质感饱满，超清，干净的画面风格，2D风格，动漫风格。',
    promptEn: 'Modern premium Chinese comic style, rich details, clean sharp line art, full texture, ultra-clear 2D anime aesthetics.',
    previewImage: '/art-styles/chinese-comic.png',
    referenceImage: '/art-styles/chinese-comic.png',
  },
  {
    value: 'japanese-anime',
    label: '日系动漫风',
    preview: '日',
    promptZh: '现代日系动漫风格，赛璐璐上色，清晰干净的线条，视觉小说CG感。高质量2D风格',
    promptEn: 'Modern Japanese anime style, cel shading, clean line art, visual-novel CG look, high-quality 2D style.',
    previewImage: '/art-styles/japanese-anime.png',
    referenceImage: '/art-styles/japanese-anime.png',
  },
  {
    value: 'realistic',
    label: '真人风格',
    preview: '实',
    promptZh: '真实电影级画面质感，真实现实场景，色彩饱满通透，画面干净精致，真实感',
    promptEn: 'Realistic cinematic look, real-world scene fidelity, rich transparent colors, clean and refined image quality.',
    previewImage: '/art-styles/realistic.png',
    referenceImage: '/art-styles/realistic.png',
  },
  {
    value: 'watercolor-illustration',
    label: '水彩插画',
    preview: '水',
    promptZh: '柔和透明的水彩插画风格，自然纸张纹理，轻盈颜料晕染边缘，低对比柔光，温暖治愈的手绘质感。',
    promptEn: 'Soft transparent watercolor illustration with natural paper texture, gentle pigment bleeding, low-contrast soft light, and a warm hand-painted feeling.',
    previewImage: '/art-styles/watercolor-illustration.png',
    referenceImage: '/art-styles/watercolor-illustration.png',
  },
  {
    value: 'chinese-ink-wash',
    label: '国风水墨',
    preview: '墨',
    promptZh: '国风水墨画风格，留白构图，墨色浓淡层次，淡雅色彩点染，东方诗意氛围，线条克制流畅。',
    promptEn: 'Chinese ink wash style with elegant negative space, layered ink tones, restrained color accents, poetic Eastern atmosphere, and fluid controlled brushwork.',
    previewImage: '/art-styles/chinese-ink-wash.png',
    referenceImage: '/art-styles/chinese-ink-wash.png',
  },
  {
    value: '3d-animation',
    label: '3D 动画',
    preview: '3D',
    promptZh: '风格化 3D 动画画面，圆润造型，柔和全局光照，干净材质，明快色彩，适合家庭向和儿童内容。',
    promptEn: 'Stylized 3D animation look with rounded shapes, soft global illumination, clean materials, bright colors, suitable for family-friendly and children-oriented content.',
    previewImage: '/art-styles/3d-animation.png',
    referenceImage: '/art-styles/3d-animation.png',
  },
  {
    value: 'cinematic-cg',
    label: '电影 CG',
    preview: 'CG',
    promptZh: '电影级 CG 画面质感，高细节材质，体积光和景深，戏剧化布光，史诗感构图，精致数字渲染。',
    promptEn: 'Cinematic CG look with highly detailed materials, volumetric light, depth of field, dramatic lighting, epic composition, and polished digital rendering.',
    previewImage: '/art-styles/cinematic-cg.png',
    referenceImage: '/art-styles/cinematic-cg.png',
  },
  {
    value: 'paper-cut-3d',
    label: '立体纸雕',
    preview: '纸',
    promptZh: '立体纸雕风格，多层剪纸结构，清晰纸张边缘，柔和投影，轻微手作纹理，像精致纸艺场景盒。',
    promptEn: 'Layered 3D paper-cut style with crisp paper edges, soft cast shadows, subtle handmade texture, and a refined paper craft diorama look.',
    previewImage: '/art-styles/paper-cut-3d.png',
    referenceImage: '/art-styles/paper-cut-3d.png',
  },
  {
    value: 'claymation',
    label: '黏土定格',
    preview: '泥',
    promptZh: '黏土定格动画风格，手塑黏土材质，微小指纹和不规则表面，柔和棚拍灯光，温暖可触摸的手作质感。',
    promptEn: 'Claymation stop-motion style with hand-molded clay material, tiny fingerprints and irregular surfaces, soft studio lighting, and a warm tactile handmade feel.',
    previewImage: '/art-styles/claymation.png',
    referenceImage: '/art-styles/claymation.png',
  },
  {
    value: 'gongbi-heavy-color',
    label: '工笔重彩',
    preview: '工',
    promptZh: '工笔重彩风格，精细线描，浓郁矿物色彩，装饰性图案，层次清晰，典雅华丽的中式绘画质感。',
    promptEn: 'Gongbi heavy-color painting style with precise fine linework, rich mineral colors, decorative patterns, clear layering, and an elegant ornate Chinese painting texture.',
    previewImage: '/art-styles/gongbi-heavy-color.png',
    referenceImage: '/art-styles/gongbi-heavy-color.png',
  },
  {
    value: 'modern-american-cartoon',
    label: '美式现代卡通',
    preview: '卡',
    promptZh: '美式现代卡通风格，简洁夸张造型，清晰轮廓线，明亮色块，轻松幽默的动画质感，画面干净友好。',
    promptEn: 'Modern American cartoon style with simplified exaggerated shapes, clean outlines, bright color blocks, a playful animated feel, and a clean friendly image.',
    previewImage: '/art-styles/modern-american-cartoon.png',
    referenceImage: '/art-styles/modern-american-cartoon.png',
  },
] as const satisfies readonly ArtStyleDefinition[]

function assertArtStylesValid(styles: readonly ArtStyleDefinition[]) {
  const seen = new Set<string>()
  for (const style of styles) {
    if (seen.has(style.value)) {
      throw new Error(`Duplicate ART_STYLES value: ${style.value}`)
    }
    seen.add(style.value)
    if (!style.promptZh.trim() || !style.promptEn.trim()) {
      throw new Error(`ART_STYLES prompt is required: ${style.value}`)
    }
  }
}

assertArtStylesValid(ART_STYLES)

export type ArtStyleValue = (typeof ART_STYLES)[number]['value']

export function isArtStyleValue(value: unknown): value is ArtStyleValue {
  return typeof value === 'string' && ART_STYLES.some((style) => style.value === value)
}

export function getArtStyleDefinition(artStyle: string | null | undefined): ArtStyleDefinition | null {
  if (!artStyle) return null
  return ART_STYLES.find((style) => style.value === artStyle) ?? null
}

export function getArtStyleReferenceImage(artStyle: string | null | undefined): string | null {
  return getArtStyleDefinition(artStyle)?.referenceImage ?? null
}

export function appendArtStyleReferenceImage(
  referenceImages: readonly string[],
  artStyle: string | null | undefined,
): string[] {
  const styleReferenceImage = getArtStyleReferenceImage(artStyle)
  const merged = [...referenceImages]
  if (styleReferenceImage) {
    merged.push(styleReferenceImage)
  }
  return Array.from(new Set(merged.filter((item) => typeof item === 'string' && item.trim().length > 0)))
}

/**
 * 🔥 实时从 ART_STYLES 常量获取风格 prompt
 * 这是获取风格 prompt 的唯一正确方式，确保始终使用最新的常量定义
 * 
 * @param artStyle - 风格标识符，如 'realistic', 'american-comic' 等
 * @returns 对应的风格 prompt，如果找不到则返回空字符串
 */
export function getArtStylePrompt(
  artStyle: string | null | undefined,
  locale: 'zh' | 'en',
): string {
  if (!artStyle) return ''
  const style = getArtStyleDefinition(artStyle)
  if (!style) return ''
  return locale === 'en' ? style.promptEn : style.promptZh
}

// 角色形象生成的系统后缀（始终添加到提示词末尾，不显示给用户）- 左侧面部特写+右侧三视图
export const CHARACTER_PROMPT_SUFFIX = '角色设定图，画面分为左右两个区域：【左侧区域】占约1/3宽度，是角色的正面特写（如果是人类则展示完整正脸，如果是动物/生物则展示最具辨识度的正面形态）；【右侧区域】占约2/3宽度，是角色三视图横向排列（从左到右依次为：正面全身、侧面全身、背面全身），三视图高度一致。纯白色背景，无其他元素。'

// 道具图片生成的系统后缀（固定白底三视图资产图）
export const PROP_PROMPT_SUFFIX = '道具设定图，画面分为左右两个区域：【左侧区域】占约1/3宽度，是道具主体的主视图特写；【右侧区域】占约2/3宽度，是同一道具的三视图横向排列（从左到右依次为：正面、侧面、背面），三视图高度一致。纯白色背景，主体居中完整展示，无人物、无手部、无桌面陈设、无环境背景、无其他元素。'

// 场景图片生成的系统后缀（已禁用四视图，直接生成单张场景图）
export const LOCATION_PROMPT_SUFFIX = ''

// 角色资产图生成比例（当前角色设定图实际使用 3:2）
export const CHARACTER_ASSET_IMAGE_RATIO = '3:2'
// 历史保留：旧注释中曾写 16:9，但当前资产图生成统一以 CHARACTER_ASSET_IMAGE_RATIO 为准
export const CHARACTER_IMAGE_RATIO = CHARACTER_ASSET_IMAGE_RATIO
// 角色图片尺寸（用于Seedream API）
export const CHARACTER_IMAGE_SIZE = '3840x2160'  // 16:9 横版
// 角色图片尺寸（用于Banana API）
export const CHARACTER_IMAGE_BANANA_RATIO = CHARACTER_ASSET_IMAGE_RATIO

// 道具图片生成比例（与角色资产图保持一致）
export const PROP_IMAGE_RATIO = CHARACTER_ASSET_IMAGE_RATIO

// 场景图片生成比例（1:1 正方形单张场景）
export const LOCATION_IMAGE_RATIO = '1:1'
// 场景图片尺寸（用于Seedream API）- 4K
export const LOCATION_IMAGE_SIZE = '4096x4096'  // 1:1 正方形 4K
// 场景图片尺寸（用于Banana API）
export const LOCATION_IMAGE_BANANA_RATIO = '1:1'

// 从提示词中移除角色系统后缀（用于显示给用户）
export function removeCharacterPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(CHARACTER_PROMPT_SUFFIX, '').trim()
}

// 添加角色系统后缀到提示词（用于生成图片）
export function addCharacterPromptSuffix(prompt: string): string {
  if (!prompt) return CHARACTER_PROMPT_SUFFIX
  const cleanPrompt = removeCharacterPromptSuffix(prompt)
  return `${cleanPrompt}${cleanPrompt ? '，' : ''}${CHARACTER_PROMPT_SUFFIX}`
}

export function removePropPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(PROP_PROMPT_SUFFIX, '').replace(/，$/, '').trim()
}

export function addPropPromptSuffix(prompt: string): string {
  if (!prompt) return PROP_PROMPT_SUFFIX
  const cleanPrompt = removePropPromptSuffix(prompt)
  return `${cleanPrompt}${cleanPrompt ? '，' : ''}${PROP_PROMPT_SUFFIX}`
}

// 从提示词中移除场景系统后缀（用于显示给用户）
export function removeLocationPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(LOCATION_PROMPT_SUFFIX, '').replace(/，$/, '').trim()
}

// 添加场景系统后缀到提示词（用于生成图片）
export function addLocationPromptSuffix(prompt: string): string {
  // 后缀为空时直接返回原提示词
  if (!LOCATION_PROMPT_SUFFIX) return prompt || ''
  if (!prompt) return LOCATION_PROMPT_SUFFIX
  const cleanPrompt = removeLocationPromptSuffix(prompt)
  return `${cleanPrompt}${cleanPrompt ? '，' : ''}${LOCATION_PROMPT_SUFFIX}`
}

/**
 * 构建角色介绍字符串（用于发送给 AI，帮助理解"我"和称呼对应的角色）
 * @param characters - 角色列表，需要包含 name 和 introduction 字段
 * @returns 格式化的角色介绍字符串
 */
export function buildCharactersIntroduction(characters: Array<{ name: string; introduction?: string | null }>): string {
  if (!characters || characters.length === 0) return '暂无角色介绍'

  const introductions = characters
    .filter(c => c.introduction && c.introduction.trim())
    .map(c => `- ${c.name}：${c.introduction}`)

  if (introductions.length === 0) return '暂无角色介绍'

  return introductions.join('\n')
}

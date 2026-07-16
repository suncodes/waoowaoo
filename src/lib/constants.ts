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
    label: '美漫',
    preview: '美',
    promptZh: '现代美式漫画与前卫动作动画风格，极强视觉张力，粗犷动感黑色轮廓线，夸张爆发力透视构图，高对比波普色彩，印刷半调网点，色散偏移，故障艺术残影，风格化动态模糊，浓重墨迹阴影。',
    promptEn: 'Modern American comic and avant-garde action animation style, strong visual impact, bold dynamic black outlines, exaggerated explosive perspective, high-contrast pop colors, printed halftone dots, chromatic aberration, glitch-art afterimages, stylized motion blur, and heavy ink shadows.',
    previewImage: '/art-styles/american-comic.jpg',
    referenceImage: '/art-styles/american-comic.jpg',
  },
  {
    value: 'chinese-comic',
    label: '新国风动画',
    preview: '国',
    promptZh: '新国风高级动画风格，融合写意水墨、工笔线描与现代数字插画技法，流畅飘逸线条，东方传统色彩美学，武侠与东方奇幻氛围，气韵生动，2D 与 3D 融合的高级手绘质感。',
    promptEn: 'Premium neo-Chinese animation style blending expressive ink wash, gongbi linework, and modern digital illustration, flowing elegant lines, traditional Eastern color aesthetics, wuxia and oriental fantasy atmosphere, vivid spirit, and a refined hybrid 2D/3D hand-painted feel.',
    previewImage: '/art-styles/chinese-comic.jpg',
    referenceImage: '/art-styles/chinese-comic.jpg',
  },
  {
    value: 'japanese-anime',
    label: '日系动漫风',
    preview: '日',
    promptZh: '高品质 2D 日式动画风格，赛璐璐涂装，清晰细腻轮廓线稿，平涂上色，层次分明的硬边阴影，高饱和纯净动漫色彩，富有空气感的光影氛围，精致手绘背景，高质量动画截图质感。',
    promptEn: 'High-quality 2D Japanese anime style, cel shading, clean detailed line art, flat colors, crisp hard-edge shadows, saturated pure anime palette, atmospheric lighting, refined hand-painted backgrounds, and polished animation still quality.',
    previewImage: '/art-styles/japanese-anime.jpg',
    referenceImage: '/art-styles/japanese-anime.jpg',
  },
  {
    value: 'realistic',
    label: '真人电影感',
    preview: '实',
    promptZh: '好莱坞电影级写实摄影风格，真实真人画面，35mm 电影镜头，浅景深，专业电影级打光，边缘背光，变形镜头眩光，高级胶片颗粒，青橙电影调色，真实皮肤和材质细节，极具真实世界光影质感。',
    promptEn: 'Hollywood cinematic realism, live-action photographic look, 35mm film lens, shallow depth of field, professional film lighting, rim light, anamorphic lens flare, premium film grain, teal-orange color grading, realistic skin and material details, and natural real-world lighting.',
    previewImage: '/art-styles/realistic.jpg',
    referenceImage: '/art-styles/realistic.jpg',
  },
  {
    value: 'watercolor-illustration',
    label: '治愈手绘',
    preview: '绘',
    promptZh: '温暖治愈的手绘插画风格，柔和低对比色彩，细腻纸张纹理，轻盈笔触和自然色彩过渡，干净温柔的光影氛围，适合童话、亲子、爱情和日常治愈内容。',
    promptEn: 'Warm healing hand-painted illustration style with soft low-contrast colors, delicate paper texture, light brushwork, natural color transitions, clean gentle lighting, suitable for fairy-tale, family, romance, and cozy everyday content.',
    previewImage: '/art-styles/watercolor-illustration.jpg',
    referenceImage: '/art-styles/watercolor-illustration.jpg',
  },
  {
    value: 'chinese-ink-wash',
    label: '国风水墨',
    preview: '墨',
    promptZh: '国风水墨画风格，宣纸肌理，墨色浓淡层次，干湿笔触与飞白质感，留白构图，淡雅设色点染，克制流畅线条，东方诗意氛围和气韵生动感。',
    promptEn: 'Chinese ink wash painting style with xuan paper texture, layered ink tones, dry and wet brushwork, feibai dry-brush texture, elegant negative space, restrained color accents, fluid controlled lines, poetic Eastern atmosphere, and vivid qi rhythm.',
    previewImage: '/art-styles/chinese-ink-wash.jpg',
    referenceImage: '/art-styles/chinese-ink-wash.jpg',
  },
  {
    value: '3d-animation',
    label: '3D 动画',
    preview: '3D',
    promptZh: '高品质风格化 3D 卡通动画画面，精细 3D 渲染，圆润且富有表现力的角色比例，柔和全局光照，体积光，通透皮肤材质，细腻毛发与织物纹理，鲜明温暖色彩，电影级构图和柔和景深。',
    promptEn: 'High-quality stylized 3D cartoon animation look with refined 3D rendering, rounded expressive character proportions, soft global illumination, volumetric light, translucent skin material, detailed hair and fabric textures, bright warm colors, cinematic composition, and soft depth of field.',
    previewImage: '/art-styles/3d-animation.jpg',
    referenceImage: '/art-styles/3d-animation.jpg',
  },
  {
    value: 'cinematic-cg',
    label: '电影 CG',
    preview: 'CG',
    promptZh: '次世代电影级 CG 动画风格，超高精度 3D 模型，PBR 材质，光线追踪，环境光遮蔽，复杂粒子特效，细腻皮肤微观纹理与硬表面反射，强烈明暗对比，戏剧性打光，史诗感构图。',
    promptEn: 'Next-generation cinematic CG animation style with ultra-detailed 3D models, PBR materials, ray tracing, ambient occlusion, complex particle effects, subtle skin micro-textures, hard-surface reflections, strong contrast, dramatic lighting, and epic composition.',
    previewImage: '/art-styles/cinematic-cg.jpg',
    referenceImage: '/art-styles/cinematic-cg.jpg',
  },
  {
    value: 'paper-cut-3d',
    label: '立体纸雕',
    preview: '纸',
    promptZh: '立体纸雕风格，多层剪纸结构，清晰手工裁切纸边，纸张纤维纹理，层叠纵深，柔和投影和环境遮挡，像精致纸艺场景盒。',
    promptEn: 'Layered 3D paper-cut style with crisp handmade cut paper edges, visible paper fiber texture, stacked depth, soft cast shadows, ambient occlusion, and a refined paper craft diorama look.',
    previewImage: '/art-styles/paper-cut-3d.jpg',
    referenceImage: '/art-styles/paper-cut-3d.jpg',
  },
  {
    value: 'claymation',
    label: '黏土定格',
    preview: '泥',
    promptZh: '黏土定格动画风格，手塑黏土材质，微小指纹和不规则表面，轻微定格帧感，微缩棚拍布景，柔和工作室灯光，温暖可触摸的手作质感。',
    promptEn: 'Claymation stop-motion style with hand-molded clay material, tiny fingerprints, irregular surfaces, subtle stop-motion frame feel, miniature studio sets, soft studio lighting, and a warm tactile handmade texture.',
    previewImage: '/art-styles/claymation.jpg',
    referenceImage: '/art-styles/claymation.jpg',
  },
  {
    value: 'gongbi-heavy-color',
    label: '工笔重彩',
    preview: '工',
    promptZh: '工笔重彩风格，精细工笔线描，浓郁矿物颜料色彩，绢本质感，金线与装饰性纹样，平面装饰构图，层次清晰，典雅华丽的中式绘画质感。',
    promptEn: 'Gongbi heavy-color painting style with precise fine linework, rich mineral pigments, silk texture, gold-line accents, decorative patterns, flat ornamental composition, clear layering, and an elegant ornate Chinese painting quality.',
    previewImage: '/art-styles/gongbi-heavy-color.jpg',
    referenceImage: '/art-styles/gongbi-heavy-color.jpg',
  },
  {
    value: 'modern-american-cartoon',
    label: '美式现代卡通',
    preview: '卡',
    promptZh: '美式现代卡通风格，简洁夸张造型，清晰圆润轮廓线，明亮干净色块，轻松幽默的动画质感，表情友好，画面清爽，适合科普、儿童和轻喜剧内容。',
    promptEn: 'Modern American cartoon style with simplified exaggerated shapes, clean rounded outlines, bright clean color blocks, playful animated feel, friendly expressions, crisp imagery, suitable for educational, children-oriented, and light comedy content.',
    previewImage: '/art-styles/modern-american-cartoon.jpg',
    referenceImage: '/art-styles/modern-american-cartoon.jpg',
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
  enabled = true,
): string[] {
  if (!enabled) {
    return Array.from(new Set(referenceImages.filter((item) => typeof item === 'string' && item.trim().length > 0)))
  }
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

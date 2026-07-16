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
    promptZh: '经典美式漫画与超级英雄漫画风格，厚重黑色墨线和粗犷外轮廓，强烈肌肉结构与动态短缩透视，戏剧性低角度构图，硬边高反差赛璐璐阴影，Ben-Day 半调网点和印刷纸感，高饱和红蓝黄波普配色，爆炸速度线和漫画分镜张力；避免圆润电视卡通、儿童动画和真实摄影。',
    promptEn: 'Classic American comic-book superhero style with heavy black inks, bold rugged contours, strong anatomy, dynamic foreshortened perspective, dramatic low-angle panel composition, hard-edge high-contrast cel shadows, Ben-Day halftone print texture, saturated red-blue-yellow pop palette, explosive action lines, and comic panel energy; avoid rounded TV cartoon, children animation, and live-action realism.',
    previewImage: '/art-styles/american-comic.jpg',
    referenceImage: '/art-styles/american-comic.jpg',
  },
  {
    value: 'chinese-comic',
    label: '新国风动画',
    preview: '国',
    promptZh: '新国风东方幻想动画风格，融合水墨写意气韵、工笔线描和现代数字动画，飘逸衣纹、云气流线和古典装饰纹样，青绿、朱砂、黛蓝与金色点缀的东方配色，清透分层光影，武侠、神话和山海幻想氛围，精致二维动画截图质感；避免日系赛璐璐、欧美卡通和纯水墨单色画。',
    promptEn: 'Neo-Chinese oriental fantasy animation style combining expressive ink spirit, gongbi linework, and modern digital animation, flowing drapery, cloud-like motion lines, classical decorative patterns, Eastern palette of mineral green, cinnabar, deep blue, and gold accents, transparent layered lighting, wuxia, mythology, and Shanhai fantasy atmosphere, refined 2D animation still quality; avoid Japanese cel anime, Western cartoon, and pure monochrome ink painting.',
    previewImage: '/art-styles/chinese-comic.jpg',
    referenceImage: '/art-styles/chinese-comic.jpg',
  },
  {
    value: 'japanese-anime',
    label: '日系动漫风',
    preview: '日',
    promptZh: '高品质 2D 日式动画风格，干净细腻线稿，赛璐璐平涂上色，层次明确的硬边阴影，清澈高饱和动漫色彩，柔和空气感光影，精致手绘背景，角色五官与表情具有日漫审美，高质量动画截图质感；避免美式超级英雄漫画、半调网点和 3D CG 渲染。',
    promptEn: 'High-quality 2D Japanese anime style with clean delicate line art, cel-shaded flat colors, clear hard-edge shadow layers, pure saturated anime palette, soft atmospheric lighting, refined hand-painted backgrounds, Japanese anime facial design and expressions, polished animation still quality; avoid American superhero comics, halftone dots, and 3D CG rendering.',
    previewImage: '/art-styles/japanese-anime.jpg',
    referenceImage: '/art-styles/japanese-anime.jpg',
  },
  {
    value: 'realistic',
    label: '真人电影感',
    preview: '实',
    promptZh: '真人电影级写实摄影风格，真实演员与真实场景质感，35mm 电影镜头，浅景深，专业电影布光，边缘背光和自然反射，克制的变形镜头眩光，高级胶片颗粒，电影级调色，真实皮肤、织物、金属和环境材质细节；避免动漫、插画、卡通和玩具化 3D 质感。',
    promptEn: 'Live-action cinematic realism with real actors and real location texture, 35mm film lens, shallow depth of field, professional film lighting, rim light and natural reflections, restrained anamorphic flare, premium film grain, cinematic color grading, realistic skin, fabric, metal, and environmental material details; avoid anime, illustration, cartoon, and toy-like 3D style.',
    previewImage: '/art-styles/realistic.jpg',
    referenceImage: '/art-styles/realistic.jpg',
  },
  {
    value: 'watercolor-illustration',
    label: '治愈手绘',
    preview: '绘',
    promptZh: '温暖治愈的手绘绘本插画风格，柔和低对比配色，细腻纸张纹理，轻盈手绘笔触，自然晕染和色彩过渡，干净温柔的散射光，安静亲和的童话与日常氛围；避免高反差漫画墨线、强烈 CG 光影和照片写实。',
    promptEn: 'Warm healing hand-painted storybook illustration style with soft low-contrast colors, delicate paper texture, light hand-drawn brushwork, natural washes and color transitions, clean gentle diffused light, quiet friendly fairy-tale and everyday mood; avoid high-contrast comic inks, strong CG lighting, and photographic realism.',
    previewImage: '/art-styles/watercolor-illustration.jpg',
    referenceImage: '/art-styles/watercolor-illustration.jpg',
  },
  {
    value: 'chinese-ink-wash',
    label: '国风水墨',
    preview: '墨',
    promptZh: '传统国风水墨画风格，宣纸肌理清晰，墨色浓淡、焦润、干湿层次分明，飞白与皴擦笔触，留白构图，少量淡彩点染，线条克制流动，东方诗意、山水烟岚和气韵生动；避免厚涂重彩、现代赛璐璐动画和写实摄影。',
    promptEn: 'Traditional Chinese ink wash painting style with clear xuan paper texture, layered ink tones from dry to wet and dark to light, feibai dry-brush marks, cun texture strokes, elegant negative space, sparse pale color accents, restrained flowing lines, poetic Eastern atmosphere, misty landscape mood, and vivid qi rhythm; avoid heavy-color painting, modern cel animation, and photographic realism.',
    previewImage: '/art-styles/chinese-ink-wash.jpg',
    referenceImage: '/art-styles/chinese-ink-wash.jpg',
  },
  {
    value: '3d-animation',
    label: '3D 动画',
    preview: '3D',
    promptZh: '高品质合家欢风格化 3D 动画画面，圆润友好的角色比例，夸张但亲和的表情，抛光玩具般的精细材质，柔和全局光照，温暖明亮色彩，轻微体积光，细腻毛发和织物纹理，电影级构图与柔和景深；避免真人写实、硬核 PBR 科幻和暗黑电影 CG。',
    promptEn: 'High-quality family-friendly stylized 3D animation look with rounded approachable character proportions, expressive friendly faces, polished toy-like refined materials, soft global illumination, warm bright colors, subtle volumetric light, detailed hair and fabric textures, cinematic composition, and soft depth of field; avoid live-action realism, hard PBR sci-fi, and dark cinematic CG.',
    previewImage: '/art-styles/3d-animation.jpg',
    referenceImage: '/art-styles/3d-animation.jpg',
  },
  {
    value: 'cinematic-cg',
    label: '电影 CG',
    preview: 'CG',
    promptZh: '次世代电影级 CG 概念短片风格，超高精度 3D 模型，真实 PBR 材质，光线追踪、环境光遮蔽和全局照明，硬表面反射、皮肤微观纹理、烟尘粒子与体积光，强烈明暗对比，戏剧性布光，史诗感大场面构图；避免圆润儿童 3D 动画、平面卡通和手绘插画。',
    promptEn: 'Next-generation cinematic CG concept-film style with ultra-detailed 3D models, physically based PBR materials, ray tracing, ambient occlusion, global illumination, hard-surface reflections, skin micro-texture, dust particles, volumetric light, strong contrast, dramatic lighting, and epic large-scale composition; avoid rounded children 3D animation, flat cartoon, and hand-painted illustration.',
    previewImage: '/art-styles/cinematic-cg.jpg',
    referenceImage: '/art-styles/cinematic-cg.jpg',
  },
  {
    value: 'paper-cut-3d',
    label: '立体纸雕',
    preview: '纸',
    promptZh: '立体纸雕与多层剪纸场景盒风格，清晰手工裁切纸边，纸张纤维和轻微压痕可见，前中后景分层堆叠，扁平色纸拼贴，柔和投影和环境遮挡，像微缩纸艺舞台；避免真实摄影、塑料玩具质感和普通平面插画。',
    promptEn: 'Layered 3D paper-cut diorama style with crisp handmade cut paper edges, visible paper fibers and slight embossing, stacked foreground-midground-background layers, flat colored paper collage, soft cast shadows, ambient occlusion, and miniature paper craft stage feeling; avoid photographic realism, plastic toy material, and ordinary flat illustration.',
    previewImage: '/art-styles/paper-cut-3d.jpg',
    referenceImage: '/art-styles/paper-cut-3d.jpg',
  },
  {
    value: 'claymation',
    label: '黏土定格',
    preview: '泥',
    promptZh: '黏土定格动画风格，手塑黏土角色和道具，表面有细小指纹、刮痕和不规则形变，微缩棚拍布景，轻微逐帧定格感，柔和工作室灯光，温暖可触摸的手作材质；避免光滑 3D CG、真实摄影和纸雕材质。',
    promptEn: 'Claymation stop-motion style with hand-molded clay characters and props, tiny fingerprints, scratches, and irregular surface deformation, miniature studio sets, subtle frame-by-frame stop-motion feel, soft studio lighting, and warm tactile handmade material; avoid smooth 3D CG, photographic realism, and paper-cut material.',
    previewImage: '/art-styles/claymation.jpg',
    referenceImage: '/art-styles/claymation.jpg',
  },
  {
    value: 'gongbi-heavy-color',
    label: '工笔重彩',
    preview: '工',
    promptZh: '中国工笔重彩绘画风格，极精细工笔线描，矿物颜料的浓郁青绿、朱砂、赭石和石青色彩，绢本质感，金线勾勒与装饰性纹样，平面化构图，层次清晰，典雅华丽、庄重细密的古典中式绘画质感；避免水墨留白、现代动漫和写实照片。',
    promptEn: 'Chinese gongbi heavy-color painting style with extremely precise fine linework, rich mineral pigments in malachite green, cinnabar, ochre, and azurite blue, silk texture, gold-line accents, decorative patterns, flat ornamental composition, clear layering, elegant ornate and meticulous classical Chinese painting quality; avoid ink-wash negative space, modern anime, and photographic realism.',
    previewImage: '/art-styles/gongbi-heavy-color.jpg',
    referenceImage: '/art-styles/gongbi-heavy-color.jpg',
  },
  {
    value: 'modern-american-cartoon',
    label: '美式现代卡通',
    preview: '卡',
    promptZh: '美式现代电视卡通与流媒体动画风格，简洁几何造型，圆润友好的轮廓线，明亮干净的扁平色块，低到中等对比，弹性夸张表情，轻松幽默、清爽亲和的画面，适合科普、儿童和轻喜剧内容；避免超级英雄美漫、厚重墨影、半调网点和写实电影光影。',
    promptEn: 'Modern American TV cartoon and streaming animation style with simplified geometric shapes, rounded friendly outlines, bright clean flat color blocks, low-to-medium contrast, elastic exaggerated expressions, light humorous and approachable imagery, suitable for educational, children-oriented, and light comedy content; avoid superhero American comics, heavy ink shadows, halftone dots, and live-action cinematic lighting.',
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

export function getArtStyleReferenceInstruction(
  artStyle: string | null | undefined,
  enabled: boolean,
  locale: 'zh' | 'en',
): string {
  if (!enabled || !getArtStyleReferenceImage(artStyle)) return ''
  return locale === 'en'
    ? 'Reference image 1 is used only for visual style, linework, color palette, material texture, lighting, and rendering mood. Do not copy its subject, objects, composition, text, logo, or watermark. Use later reference images only for character identity, scene, or object consistency.'
    : '参考图 1 仅用于画面风格、线条、色彩、材质、光影和渲染气质参考；不要复制其中的主体、物品、构图、文字、Logo 或水印。后续参考图仅用于角色、场景或物品一致性。'
}

export function joinPromptSegments(
  segments: readonly (string | null | undefined)[],
  locale: 'zh' | 'en',
): string {
  const validSegments = segments
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  return validSegments.join(locale === 'en' ? ', ' : '，')
}

export function appendPromptSegments(
  basePrompt: string,
  segments: readonly (string | null | undefined)[],
  locale: 'zh' | 'en',
): string {
  const suffix = joinPromptSegments(segments, locale)
  if (!suffix) return basePrompt
  return `${basePrompt}${locale === 'en' ? ', ' : '，'}${suffix}`
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
  const merged = styleReferenceImage ? [styleReferenceImage, ...referenceImages] : [...referenceImages]
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

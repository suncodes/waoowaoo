export interface BaselineArtStylePrompt {
  label: string
  promptZh: string
  promptEn: string
}

export const BASELINE_ART_STYLE_PROMPTS: Record<string, BaselineArtStylePrompt> = {
  'american-comic': {
    label: '漫画风',
    promptZh: '现代美式漫画风格，清晰有力的墨线，饱满平涂色块，适度网点和动态构图，画面干净利落。',
    promptEn: 'Modern American comic style with bold clean ink lines, saturated flat colors, subtle halftone texture, dynamic composition, and a crisp polished look.',
  },
  'chinese-comic': {
    label: '精致国漫',
    promptZh: '现代高质量漫画风格，动漫风格，细节丰富精致，线条锐利干净，质感饱满，超清，干净的画面风格，2D风格，动漫风格。',
    promptEn: 'Modern premium Chinese comic style, rich details, clean sharp line art, full texture, ultra-clear 2D anime aesthetics.',
  },
  'japanese-anime': {
    label: '日系动漫风',
    promptZh: '现代日系动漫风格，赛璐璐上色，清晰干净的线条，视觉小说CG感。高质量2D风格',
    promptEn: 'Modern Japanese anime style, cel shading, clean line art, visual-novel CG look, high-quality 2D style.',
  },
  realistic: {
    label: '真人风格',
    promptZh: '真实电影级画面质感，真实现实场景，色彩饱满通透，画面干净精致，真实感',
    promptEn: 'Realistic cinematic look, real-world scene fidelity, rich transparent colors, clean and refined image quality.',
  },
  'watercolor-illustration': {
    label: '水彩插画',
    promptZh: '柔和透明的水彩插画风格，自然纸张纹理，轻盈颜料晕染边缘，低对比柔光，温暖治愈的手绘质感。',
    promptEn: 'Soft transparent watercolor illustration with natural paper texture, gentle pigment bleeding, low-contrast soft light, and a warm hand-painted feeling.',
  },
  'chinese-ink-wash': {
    label: '国风水墨',
    promptZh: '国风水墨画风格，留白构图，墨色浓淡层次，淡雅色彩点染，东方诗意氛围，线条克制流畅。',
    promptEn: 'Chinese ink wash style with elegant negative space, layered ink tones, restrained color accents, poetic Eastern atmosphere, and fluid controlled brushwork.',
  },
  '3d-animation': {
    label: '3D 动画',
    promptZh: '风格化 3D 动画画面，圆润造型，柔和全局光照，干净材质，明快色彩，适合家庭向和儿童内容。',
    promptEn: 'Stylized 3D animation look with rounded shapes, soft global illumination, clean materials, bright colors, suitable for family-friendly and children-oriented content.',
  },
  'cinematic-cg': {
    label: '电影 CG',
    promptZh: '电影级 CG 画面质感，高细节材质，体积光和景深，戏剧化布光，史诗感构图，精致数字渲染。',
    promptEn: 'Cinematic CG look with highly detailed materials, volumetric light, depth of field, dramatic lighting, epic composition, and polished digital rendering.',
  },
  'paper-cut-3d': {
    label: '立体纸雕',
    promptZh: '立体纸雕风格，多层剪纸结构，清晰纸张边缘，柔和投影，轻微手作纹理，像精致纸艺场景盒。',
    promptEn: 'Layered 3D paper-cut style with crisp paper edges, soft cast shadows, subtle handmade texture, and a refined paper craft diorama look.',
  },
  claymation: {
    label: '黏土定格',
    promptZh: '黏土定格动画风格，手塑黏土材质，微小指纹和不规则表面，柔和棚拍灯光，温暖可触摸的手作质感。',
    promptEn: 'Claymation stop-motion style with hand-molded clay material, tiny fingerprints and irregular surfaces, soft studio lighting, and a warm tactile handmade feel.',
  },
  'gongbi-heavy-color': {
    label: '工笔重彩',
    promptZh: '工笔重彩风格，精细线描，浓郁矿物色彩，装饰性图案，层次清晰，典雅华丽的中式绘画质感。',
    promptEn: 'Gongbi heavy-color painting style with precise fine linework, rich mineral colors, decorative patterns, clear layering, and an elegant ornate Chinese painting texture.',
  },
  'modern-american-cartoon': {
    label: '美式现代卡通',
    promptZh: '美式现代卡通风格，简洁夸张造型，清晰轮廓线，明亮色块，轻松幽默的动画质感，画面干净友好。',
    promptEn: 'Modern American cartoon style with simplified exaggerated shapes, clean outlines, bright color blocks, a playful animated feel, and a clean friendly image.',
  },
}

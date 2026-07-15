# 画面风格扩展与参考图传输方案

- 状态：已定稿，待实施
- 适用项目：`waoowaoo`
- 更新时间：2026-07-15
- 方案范围：内置画面风格扩展、风格参考图管理、图片/视频模型参考图传输

## 1. 决策摘要

本方案不复制 `ai-fusion-video` 的独立存储配置和预设图公网 URL 机制，也不把 `waoowaoo` 改造成 URL-first。

最终采用以下原则：

1. 数据库和业务对象继续只保存稳定的风格 key、媒体 storageKey 或原始 URL，不保存 Base64。
2. 内置风格参考图作为仓库静态资源管理，不上传对象存储，也不要求具备公网 URL。
3. Worker 只负责收集、排序和裁剪参考图，不再统一提前转换 Base64。
4. Provider Adapter 根据厂商协议选择 Data URL、`inlineData`、multipart 或公网 URL。
5. URL-only 模型只有在输入本身是外部可访问的 HTTPS URL 时才启用参考图；不能伪造或透传内部地址。
6. 风格参考图只参与图片生成。视频生成继续使用已生成画面作为首尾帧，并通过文本提示词继承画风。

## 2. 当前实现与问题

### 2.1 当前风格体系

当前四种风格集中定义在 [`ART_STYLES`](../../src/lib/constants.ts)，注册项包含：

- `value`
- `label`
- `preview`
- `promptZh`
- `promptEn`

该数组同时承担前端选项、API 白名单和生成提示词解析职责。数据库中的 `artStyle` 是普通字符串，因此新增风格不需要数据库迁移。

当前问题：

- 风格仅依赖文本提示词，跨角色、场景和分镜的一致性有限。
- `american-comic` 实际使用日式动漫提示词，名称与效果不一致。
- 四种风格中动漫类占比较高，媒介和题材覆盖不足。
- 风格没有真实图片预览，也没有可选的生成参考图。

### 2.2 当前媒体存储

`waoowaoo` 已存在存储抽象，支持 `local`、`minio`，并为 `cos` 预留接口，参见：

- [`src/lib/storage/factory.ts`](../../src/lib/storage/factory.ts)
- [`src/lib/storage/providers/local.ts`](../../src/lib/storage/providers/local.ts)
- [`src/lib/storage/providers/minio.ts`](../../src/lib/storage/providers/minio.ts)

该存储体系解决的是应用内部持久化和读取问题，不代表生成的 URL 一定可被模型厂商访问：

- Local Storage 返回 `/api/files/...` 相对路径。
- Docker 内的 MinIO 通常使用 `http://minio:9000` 等内部地址。
- 签名路由 `/api/storage/sign` 仍依赖应用自身域名和网络拓扑。
- 本地开发地址、内网地址和容器服务名对云端模型不可见。

因此“应用能够读取”与“模型厂商能够通过 URL 下载”必须作为两个不同能力处理。

### 2.3 当前参考图链路

当前 [`outbound-image.ts`](../../src/lib/media/outbound-image.ts) 的 `normalizeToBase64ForGeneration()` 会先解析 storageKey 或 URL，再下载并转换为 Data URL。

图片 Worker 普遍调用 `normalizeReferenceImagesForGeneration()`；视频 Worker 也会在调用模型前把首帧和尾帧转换为 Base64，参见 [`video.worker.ts`](../../src/lib/workers/video.worker.ts)。

这种实现解决了本地和内网图片无法被外部模型访问的问题，但存在两个边界缺陷：

1. Worker 提前决定了传输格式，Provider Adapter 无法按照真实协议选择二进制上传或公网 URL。
2. 百炼等使用 `img_url`、`first_frame_url` 字段的接口可能收到 Data URL，字段名称和实际值语义不一致。

## 3. 设计目标

### 3.1 目标

- 在不增加数据库迁移和独立存储配置中心的前提下扩展内置风格。
- 允许风格同时拥有文本提示词、预览图和可选生成参考图。
- 默认不依赖公网 URL，兼容本地和内网部署。
- 由 Provider Adapter 决定最终传输格式。
- 保证编辑目标、人物一致性和场景参考的优先级高于风格参考图。
- 对 URL-only 模型提供明确、可预测的降级和失败行为。

### 3.2 非目标

- 本期不建设数据库化风格管理后台。
- 本期不实现用户上传自定义风格参考图。
- 本期不新增外部对象存储或 CDN 配置。
- 本期不要求所有视频模型支持额外风格参考图。
- 本期不清理历史 `artStylePrompt` 字段。

## 4. 总体架构

```text
ART_STYLES / storageKey / Data URL / external HTTPS URL
                         |
                         v
                图片资源解析与校验层
             loadImageResource(source)
                         |
                         v
       { bytes, mimeType, filename, sourceKind }
                         |
          +--------------+---------------+----------------+
          |              |               |                |
          v              v               v                v
       Data URL      inlineData       multipart      remote URL
    FAL/ARK等       Google/Gemini      OpenAI       URL-only模型
```

核心边界：

- 风格注册表描述“是什么风格、使用什么资源”。
- 图片资源解析层负责“如何可靠读取图片内容”。
- Provider Adapter 负责“模型协议要求怎样发送”。
- Worker 不处理厂商传输协议。

## 5. 风格注册表设计

在现有 `ART_STYLES` 项上增加可选字段，保持原结构兼容：

```ts
export interface ArtStyleDefinition {
  value: string
  label: string
  preview: string
  promptZh: string
  promptEn: string
  previewImage?: string
  referenceImage?: string
}
```

示例：

```ts
{
  value: 'watercolor-illustration',
  label: '水彩插画',
  preview: '水',
  promptZh: '柔和透明的水彩插画风格，保留自然纸张纹理与颜料晕染边缘...',
  promptEn: 'Soft transparent watercolor illustration with natural paper texture...',
  previewImage: '/art-styles/watercolor-illustration.jpg',
  referenceImage: '/art-styles/watercolor-illustration.jpg',
}
```

约束：

- `value` 是数据库和 API 使用的稳定标识，发布后不随显示名称变化。
- `promptZh`、`promptEn` 始终保留，作为不支持参考图时的降级路径。
- `previewImage` 用于前端展示。
- `referenceImage` 用于模型生成，可与预览图相同，也可使用更适合模型理解的独立图片。
- 未配置图片时继续使用现有单字 `preview`。
- 注册表必须校验 `value` 唯一、提示词非空、静态资源存在。

### 5.1 静态资源目录

内置风格图片统一放置于：

```text
public/art-styles/<style-value>.jpg
```

资源约束：

- 推荐尺寸：`1024x1024`。
- 支持格式：JPEG、PNG、WebP。
- 单文件建议不超过 2 MB。
- 图片应清晰呈现画风本身，避免品牌 Logo、文字水印和具体影视 IP。
- 图片内容避免过强的角色、场景和题材语义，以免污染实际生成内容。

### 5.2 首批风格调整

首批扩展建议：

| value | 显示名称 | 主要场景 |
|---|---|---|
| `watercolor-illustration` | 水彩插画 | 治愈、童话、爱情、儿童内容 |
| `chinese-ink-wash` | 国风水墨 | 古装、武侠、仙侠、历史题材 |
| `3d-animation` | 3D 动画 | 儿童、家庭、轻喜剧、商业角色 |
| `cinematic-cg` | 电影 CG | 奇幻、科幻、史诗、动作内容 |

同时修正 `american-comic`：

- 保留 key，并将提示词修改为真正的现代美式漫画风格；或
- 如果希望保留当前日漫效果，则新增正确 key 并提供兼容迁移。

优先选择第一种，避免数据库迁移和历史项目 key 变更。

### 5.3 VideoLens 外部风格候选池

VideoLens《短视频视觉风格大全：21 种爆款风格 + AI 提示词》可作为候选风格和提示词措辞参考，但不能一比一导入 `ART_STYLES`。

筛选原则：

- `ART_STYLES` 只收基础画风、媒介、材质和渲染方式。
- 品牌、艺术家、工作室、影视 IP 不进入 `value`、`label` 和正式提示词。
- 题材、氛围、镜头和构图效果不作为基础画风，后续可进入主题、镜头或氛围预设。
- 参考图应弱化具体角色、场景和题材，只表达材质、线条、色彩和渲染方式。

建议先从 VideoLens 风格中选 4 类做试点，验证注册表、提示词、静态参考图和多 Provider 传输链路稳定后，再扩展剩余候选：

| value | 显示名称 | 来源风格 | 处理方式 | 优先原因 |
|---|---|---|---|---|
| `paper-cut-3d` | 立体纸雕 | 立体纸雕 | 直接参考 | 材质、层次和阴影特征清晰，和现有风格差异大 |
| `claymation` | 黏土定格 | 黏土定格 | 直接参考 | 手作材质强，适合儿童、轻喜剧和短视频内容 |
| `gongbi-heavy-color` | 工笔重彩 | 工笔重彩 | 直接参考 | 与国风水墨同属中式视觉，但线条、色彩和装饰性差异明显 |
| `modern-american-cartoon` | 美式现代卡通 | 美式现代卡通 | 直接参考 | 可承接 `american-comic` 提示词修正，适合科普、儿童和轻内容 |

试点通过后，再按以下候选池扩展：

| value | 显示名称 | 来源风格 | 处理方式 | 备注 |
|---|---|---|---|---|
| `warm-healing-illustration` | 治愈手绘插画 | 治愈手绘插画 | 改写后参考 | 如与 `watercolor-illustration`、`storybook-illustration` 差异不足，可合并 |
| `needle-felt-stop-motion` | 羊毛毡定格 | 羊毛毡定格 | 直接参考 | 与黏土定格同属手作定格，但材质不同 |
| `storybook-illustration` | 童书插画 | 童书插画 | 改写后参考 | 移除具体艺术家名称，保留低饱和绘本叙事感 |
| `impasto-oil-painting` | 厚涂油画 | 厚涂印象派油画 | 直接参考 | 强笔触和颜料堆叠适合风格参考图表达 |
| `retro-cel-anime-90s` | 90s 复古赛璐璐动画 | 复古赛博动画·90s | 改写后参考 | 移除“赛博”题材，保留手绘赛璐璐、OVA 怀旧和干净线条 |
| `mixed-media-lineart-photo` | 线稿实拍混合媒介 | 2D 线稿 + 实拍 | 直接参考 | 更依赖输入照片，适合作为图片修改或视频模板增强项 |
| `pop-art-doodle` | 波普涂鸦 | 波普涂鸦/美漫 | 改写后参考 | 可作为美式漫画外的潮流涂鸦分支，避免和 `american-comic` 重复 |
| `warm-hand-painted-fantasy-animation` | 温暖手绘奇幻动画 | 吉卜力风 | 改写后参考 | 不使用工作室名称，只保留手绘、柔和光影和治愈奇幻 |
| `high-saturation-cinematic-anime` | 高饱和电影感日漫 | 日系动漫·新海诚 | 改写后参考 | 不使用导演名称，只保留高饱和天空、光晕和青春感 |
| `family-friendly-stylized-3d` | 家庭向风格化 3D | 皮克斯/迪士尼 3D | 改写后参考 | 不使用工作室名称；如与 `3d-animation` 差异不足，可合并 |
| `clean-line-sci-fi-illustration` | 清线科幻插画 | 莫比斯极繁插画 | 改写后参考 | 不使用艺术家名称，保留清线、平涂和高细节科幻构成 |
| `oriental-fantasy-3d` | 东方奇幻 3D | 国潮 3D / 东方奇幻 | 改写后参考 | 容易注入民族服饰和题材语义，建议靠后验证 |
| `cinematic-hyperrealism` | 电影级超写实 | 电影级写实/超现实 | 改写后参考 | 如现有真人风格已覆盖，可不单独新增 |

以下 VideoLens 项不建议进入基础画风注册表：

| 来源风格 | 处理建议 | 原因 |
|---|---|---|
| 国风水墨 | 已由基础批 `chinese-ink-wash` 覆盖 | 不重复新增同义风格 |
| 废土末世·Mad Max | 作为题材或氛围预设 | 含影视 IP 和强题材语义，不是通用画风 |
| 移轴微缩写实 | 作为镜头效果预设 | 属于摄影/景深效果，不是媒介画风 |
| 治愈微距 3D·萌宠 | 拆为镜头和角色标签 | “微距”“萌宠”会污染主体和构图 |
| 复古赛博动画·90s 中的赛博语义 | 作为主题标签 | 赛博是题材氛围，应与 90s 赛璐璐画风解耦 |

## 6. 图片资源解析层

新增统一函数：

```ts
interface ImageBinaryResource {
  bytes: Buffer
  mimeType: string
  filename: string
  sourceKind: 'data-url' | 'style-asset' | 'storage' | 'remote-url'
}

async function loadImageResource(source: string): Promise<ImageBinaryResource>
```

### 6.1 输入处理规则

| 输入类型 | 处理方式 |
|---|---|
| `data:image/...;base64,...` | 校验并解码 Base64 |
| `/art-styles/...` | 从 `public/art-styles/` 直接读取文件 |
| storageKey | 使用现有 `getObjectBuffer()` 读取 |
| `/m/...`、`/api/files/...` | 解析为 storageKey 后读取 |
| 外部 HTTPS URL | 校验后下载 |
| 相对路径或未知协议 | 明确拒绝 |

读取 storageKey 时不再先生成签名 URL 再由服务端 HTTP 回源，避免不必要的网络跳转和公网依赖。

### 6.2 输出转换函数

资源解析完成后提供三个独立转换方法：

```ts
function imageResourceToDataUrl(resource: ImageBinaryResource): string
function imageResourceToInlineData(resource: ImageBinaryResource): { mimeType: string; data: string }
async function imageResourceToUploadFile(resource: ImageBinaryResource): Promise<File>
```

`normalizeToBase64ForGeneration()` 可以保留为兼容包装，但内部应复用 `loadImageResource()`，不再单独维护下载和 MIME 判断逻辑。

### 6.3 安全与资源限制

- 静态风格路径只允许 `/art-styles/` 白名单目录，并验证最终路径未越界。
- 外部 URL 只允许 HTTP/HTTPS，默认优先 HTTPS。
- 拒绝访问 loopback、链路本地地址和私有网段，防止 SSRF。
- 下载设置连接、响应和总时长超时。
- 校验响应 MIME，拒绝 HTML、JSON 等非图片内容。
- 设置单图和单次请求总大小限制。
- Base64 解码失败、MIME 不支持、文件不存在时返回结构化错误。
- 日志只记录来源类型、大小和 MIME，不记录完整 Base64。

## 7. Provider 传输策略

Provider Adapter 内部声明参考图传输方式，不由 Worker 推断：

```ts
type ReferenceImageTransport =
  | 'data-url'
  | 'inline-data'
  | 'multipart'
  | 'remote-url'
```

初始映射：

| Provider/协议 | 传输方式 | 处理规则 |
|---|---|---|
| Google/Gemini 图片 | `inline-data` | 发送 `{ mimeType, data }` |
| Google Veo | `inline-data` | 首帧和尾帧发送 Base64 字节 |
| OpenAI 图片编辑 | `multipart` | 发送 `image[]` 文件 |
| OpenAI 视频 | `multipart` | 发送 `input_reference` 文件 |
| FAL 图片 | `data-url` | 发送 `image_urls` Data URL |
| ARK 图片/视频 | `data-url` | 在 `image` 或 `image_url.url` 中发送 Data URL |
| MiniMax 视频 | `data-url` | 发送 `first_frame_image`、`last_frame_image` |
| Vidu 视频 | `data-url` | 发送 `images` 数组 |
| 百炼视频 | `remote-url` | 只允许外部可访问 HTTPS URL |
| OpenAI Compatible Template | 显式声明 | 模板必须声明所需格式，禁止按字段名猜测 |

如果同一 Provider 的不同模型协议不同，应以模型 Adapter 或模板配置为准，而不是只按 Provider 名称判断。

### 7.1 URL-only 模型规则

传给模型厂商的 URL 必须满足：

- 绝对 HTTPS URL。
- 不能是相对路径。
- 不能是 localhost、私有 IP、Docker 服务名或内部 MinIO 地址。
- 有效期必须覆盖模型下载和任务排队时间。
- 不依赖浏览器 Cookie 或应用内部会话。

当前阶段不为本地风格图和 storageKey 自动生成所谓“公网 URL”。如果部署没有外部媒体服务，这类输入不能用于 URL-only 模型。

降级策略：

- 风格参考图：忽略图片，只保留风格文本提示词，并记录降级原因。
- 可选上下文参考图：根据模型能力忽略并告警。
- 图生视频必需首帧：提交前失败，返回 `REFERENCE_IMAGE_PUBLIC_URL_REQUIRED` 一类明确错误。

## 8. Worker 与生成流程

### 8.1 Worker 职责调整

Worker 应负责：

- 收集业务参考图。
- 加入当前风格的可选参考图。
- 按业务优先级排序。
- 去重并根据模型限制裁剪。
- 将原始图片源传给生成器。

Worker 不再负责：

- 下载图片。
- 转换 Base64。
- 创建 multipart 文件。
- 判断公网 URL 是否适用于某个厂商。

可以新增 `prepareReferenceImageSources()`，替代 Worker 直接调用 `normalizeReferenceImagesForGeneration()` 的行为。生成器对外接口初期仍可保持 `string[]`，避免一次性引入跨模块复杂对象。

### 8.2 参考图排序

统一顺序：

1. 编辑目标图或首帧图。
2. 用户上传的草图。
3. 角色身份和主要外观参考。
4. 场景、地点和道具参考。
5. 风格参考图。

超过模型上限时：

- 编辑目标和首帧不可丢弃。
- 优先丢弃风格参考图。
- 其次丢弃低优先级的场景上下文。
- 不允许因为风格图挤掉人物身份参考图。

### 8.3 不同生成场景

| 生成场景 | 风格文本 | 风格参考图 |
|---|---|---|
| 角色首次生成 | 使用 | 支持时追加 |
| 场景/道具首次生成 | 使用 | 支持时追加 |
| 分镜图片生成 | 使用 | 放在角色和场景参考之后 |
| 图片修改 | 使用 | 有剩余参考图槽位时追加 |
| 视频首帧生成 | 使用图片生成规则 | 在图片阶段完成 |
| 视频生成 | 可继续保留简短风格描述 | 不额外传风格图 |

视频模型不额外传风格参考图的原因：

- 生成出的分镜图片已经承载画风。
- 大多数视频模型只稳定支持首帧、尾帧或少量参考图。
- 额外风格图可能与首帧内容竞争，降低主体一致性。
- 避免增加 Base64 请求体积和 URL-only 兼容问题。

## 9. 代码落点

预计涉及以下文件和模块：

| 文件/目录 | 修改内容 |
|---|---|
| `src/lib/constants.ts` | 扩展风格注册结构、修正美漫提示词、新增风格 |
| `public/art-styles/` | 新增风格预览和参考图 |
| `src/lib/media/outbound-image.ts` | 增加统一二进制资源读取和转换能力 |
| `src/lib/storage/index.ts` | 复用现有 `getObjectBuffer()`，原则上不新增存储类型 |
| `src/lib/workers/handlers/*image-task-handler.ts` | 收集并按优先级加入风格参考图 |
| `src/lib/workers/video.worker.ts` | 移除统一提前 Base64 转换 |
| `src/lib/generators/**` | 各 Adapter 按协议转换参考图 |
| `src/lib/model-gateway/openai-compat/**` | 复用二进制资源并处理 multipart |
| OpenAI Compatible 模板定义 | 增加显式参考图传输格式 |

不修改 Prisma schema。

## 10. 实施顺序

### 阶段一：风格注册表治理

1. 为 `ART_STYLES` 增加明确接口和唯一性校验。
2. 修正 `american-comic` 提示词错配。
3. 新增基础批四种风格文本定义：`watercolor-illustration`、`chinese-ink-wash`、`3d-animation`、`cinematic-cg`。
4. 前端选择器支持真实图片预览和原单字预览降级。

### 阶段一-B：VideoLens 试点批

基础批通过生成效果抽样后，优先实现 4 个 VideoLens 衍生风格：

1. `paper-cut-3d`
2. `claymation`
3. `gongbi-heavy-color`
4. `modern-american-cartoon`

试点批目标是验证强材质、手作感、中式细分风格和美式卡通修正四类差异化风格是否能被当前模型稳定理解。

试点批通过后，再从 5.3 的剩余候选池继续实现。每次新增建议控制在 3-5 个，避免一次性加入大量风格导致效果问题难以定位。

### 阶段二：静态参考图与资源解析

1. 新增 `public/art-styles/` 资源。
2. 实现 `loadImageResource()`。
3. 让 `normalizeToBase64ForGeneration()` 复用统一读取层。
4. 增加静态路径、storageKey、Data URL、外部 URL 测试。

### 阶段三：Adapter 传输下沉

1. Worker 改为传递原始图片源。
2. Google、OpenAI、FAL、ARK、MiniMax、Vidu Adapter 分别处理协议转换。
3. 百炼等 URL-only Adapter 增加公网 URL 校验和明确错误。
4. OpenAI Compatible Template 增加显式传输格式。

### 阶段四：风格参考图注入

1. 角色、场景、道具和分镜图片任务追加风格参考图。
2. 实现统一排序、去重和数量裁剪。
3. 模型不支持参考图或资源不可用时降级为纯文本。
4. 视频任务保持只传首尾帧。

## 11. 测试方案

### 11.1 单元测试

- `ART_STYLES.value` 唯一。
- 中英文提示词非空。
- 配置的静态图片存在且 MIME 合法。
- 静态路径不能目录穿越。
- storageKey 直接读取二进制，不经过 HTTP 自回源。
- Data URL 编解码一致。
- 非图片响应和超限资源被拒绝。
- 私有网段和 localhost 外部 URL 被拒绝。

### 11.2 Adapter 契约测试

- Google 请求只出现 `inlineData`，不出现内部 URL。
- OpenAI 图片和视频请求使用 multipart 文件。
- FAL、ARK、MiniMax、Vidu 获得合法 Data URL。
- 百炼只接受通过校验的外部 HTTPS URL。
- OpenAI Compatible Template 未声明格式时拒绝发送参考图。

### 11.3 Worker 测试

- 编辑目标始终位于第一位。
- 风格图位于角色和场景参考之后。
- 超限时优先移除风格图。
- 不支持参考图时仍注入风格文本。
- 视频任务不额外加入风格图。

### 11.4 生成效果抽样

至少覆盖：

- 角色设定图。
- 场景图。
- 分镜图。
- 图片修改。
- 首尾帧视频。
- 中文和英文提示词。
- 至少一个 `inline-data` 模型和一个 multipart 模型。

分批门禁：

- 基础批通过后，才能进入 VideoLens 试点批。
- VideoLens 试点批每个风格至少生成角色图、场景图和分镜图各一组。
- 试点批需对比“仅文本提示词”和“文本 + 风格参考图”两种结果。
- 若某个风格明显污染题材或主体一致性，先调整提示词和参考图；仍不稳定则暂不进入正式注册表。
- 试点批通过后，剩余候选按 3-5 个一批继续实现并复用同一套测试。

## 12. 验收标准

方案完成需同时满足：

1. 新增风格无需数据库迁移即可被首页、项目配置、资产和分镜流程识别。
2. 风格预览图在本地和容器部署中正常显示。
3. 静态风格图无需公网 URL 即可传给 Base64 或 multipart 模型。
4. Worker 不再统一提前决定参考图传输格式。
5. URL-only 模型不会收到相对 URL、内部 URL或伪装成 URL 的 Data URL。
6. 不支持参考图时能够稳定降级为纯文本风格。
7. 风格参考图不会挤掉编辑目标和人物身份参考图。
8. 视频生成不增加额外风格图负担。
9. 测试覆盖资源解析、Adapter 请求体和参考图排序。
10. VideoLens 衍生风格使用通用视觉语言命名，不出现品牌、艺术家、工作室或影视 IP 名称。
11. 每批新增风格通过生成效果抽样后再进入下一批。

## 13. 风险与处理

| 风险 | 处理方式 |
|---|---|
| Base64 请求体过大 | 压缩静态风格图，限制单图与总大小 |
| 风格图污染内容 | 使用低题材语义参考图，风格图排在最后 |
| 外部风格包含品牌或艺术家语义 | 改写为通用视觉语言，正式注册表不保留来源品牌名 |
| 模型参考图上限不同 | Adapter 声明上限，Worker 按优先级裁剪 |
| 外部 URL 引发 SSRF | 私有地址拦截、协议白名单、超时和大小限制 |
| URL-only 模型在本地部署不可用 | 风格图降级文本，必需首帧明确报错 |
| 不同模型对 Data URL 支持不同 | 通过 Adapter 契约声明，不按字段名推断 |
| 静态资源缺失导致任务失败 | 启动或测试阶段校验，运行时风格图可降级 |

## 14. 最终结论

`waoowaoo` 应继续以现有 storageKey 和本地/MinIO 存储抽象作为媒体持久化基础，但不把这些地址直接等同于模型厂商可访问的公网 URL。

内置风格参考图应作为静态资源由服务端直接读取，统一解析成二进制后，再由 Provider Adapter 转换为厂商所需格式。该方案既保留当前 Base64 链路对本地部署友好的优势，又修复统一提前 Base64 导致 URL-only Provider 语义不正确的问题，同时不引入新的数据库和存储配置复杂度。

# 小说推广核心质量优化标准与落地方案

- 状态：方案文档，待按阶段实现
- 日期：2026-07-23
- 适用范围：小说推广、书籍导读、AI 漫剧、分镜图、资产图、分镜到图片/视频提示词
- 关联文档：
  - `standards/design/content-and-image-quality-improvement-20260722.md`
  - `standards/design/video-generation-quality-optimization.md`
- 本次参考资料：
  - `D:/document/workspace/tmp/grok/提示词示例.txt`
  - `D:/document/workspace/tmp/grok/提示词.zip`
  - `D:/document/workspace/tmp/grok/GPT电影感生图skill.zip`
  - `.tmp/2.zip`、`.tmp/3.zip` 运行日志对比
  - VideoLens 专栏中关于短视频结构、镜头功能、Seedance 提示词八要素、电影级布光的公开方法论：
    - `https://videolens.cc/zh/blog`
    - `https://videolens.cc/en/blog/seedance-2-prompt-guide`
    - `https://videolens.cc/zh/blog/cinematic-lighting-guide`

## 1. 结论

用户提出的五个方向是正确的，而且正好对应当前质量上限：

1. 剧本/文稿质量。
2. 资产提取。
3. 分镜规划。
4. 资产描述到提示词的转换。
5. 分镜描述到提示词的转换。

还需要补一个第六项：质量评审与版本锁定。没有这一层，即使前五项都加强，两次运行仍可能因为模型随机性、来源不足、修复候选差异、资产版本漂移而产生明显不稳定。

因此目标不应是“把提示词写长”，而是建立从内容到生成结果的生产合同：

```text
CreativeBrief
  -> ContentPlan / Script
  -> ScriptReview
  -> AssetBible
  -> DirectorTreatment / ProductionBible
  -> ShotPlan / ShotSpec
  -> AssetPromptSpec / PanelPromptSpec
  -> PromptCompiler
  -> Generation
  -> QualityReview / AutoRepair
  -> VersionLock / Metrics
```

这条链路的核心是：每一步都有结构化产物、评分门禁、失败路由和可回归样本。提示词只是最后的编译结果，不是质量体系本身。

## 2. 当前问题定位

### 2.1 已经改进的部分

现有 P0 方案已经解决了一批明显问题：

- 内容计划增加了时长缓冲、来源边界和单段职责。
- 视觉计划增加了 `DirectorTreatment`、`ProductionBible`、`visualUnits`、`ShotSpec` 和 `assetRefs`。
- 单图生成已经限制为一个时空、一个构图、一个主要视觉事件。
- 图片生成禁止直接生成文字，准确文字交给后续合成。
- 分镜图接入了视觉质量评审和有界自动修复。
- 自动修复确实生效，日志中最终采用图多次来自 `visual-repair-candidate-*`。

这些改进能减少明显跑偏和低级错误，但还不足以稳定提升“成片质感”和“文稿张力”。

### 2.2 仍然薄弱的根因

| 问题 | 根因 | 后果 |
| --- | --- | --- |
| 文稿不稳定 | 只输入书名或弱材料时，内容依赖模型常识；缺少强结构、事实账本和独立编辑修订 | 两次内容角度差异大，文稿有时像摘要，有时像剧情复述 |
| 剧本偏弱 | `screenplay_conversion` 强调忠实原文，但缺少“导读型/推广型”的戏剧化重写合同 | 忠实但不够抓人，或抓人但事实/原文边界不稳 |
| 资产提取不完整 | 资产提取偏角色/场景，缺少“剧情功能”和“镜头使用计划” | 重要道具、符号、时代形态、关键环境容易漏 |
| 分镜规划粗糙 | 分镜按 clip 局部生成，缺少全片镜头经济、节奏曲线和跨 clip 连续性复核 | 镜头局部合理，组合后节奏、景别、情绪重复 |
| 图片提示词简单 | `imagePrompt` 是视觉意图字段，不是最终专业提示词；专业摄影/构图/光色层被分散在上下文中 | UI 上看起来不专业，最终生成也可能缺少明确美术方向 |
| 自动修复难以评估 | 修复结果缺少 `scoreBefore/scoreAfter/accepted/reason` 等量化血缘 | 无法证明具体是哪条规则带来提升 |
| 两次生成差异大 | 缺少内容计划锁定、资产版本锁定、prompt 快照、seed/候选策略和回归样本 | 同一书名两次项目可能变成不同作品 |

## 3. 参考资料可复用规则

### 3.1 `grok` 资料的价值

`grok` 资料的价值不是可以直接复制它的长提示词，而是它把创作过程拆成了可执行规则：

| 资料类型 | 可复用规则 | 本项目采用方式 |
| --- | --- | --- |
| 爆款开头 | 反转、设定、对比、铺垫、主题等开头结构 | 转成 `HookPattern`，用于文稿开头候选和评审 |
| 角色提取 | 全文角色扫描、别名合并、时期变化、形象格式 | 转成 `AssetBible` 的别名、时期、外观不变量 |
| 分镜合并 | 时长累加、语义合并、对话/场景/情绪断点 | 转成 `ShotBudget` 和 `ShotPlan` 规则 |
| 图片提示词 | 主体、表情、动作、背景、视角、构图、天气、时间、细节 | 转成 `PanelPromptSpec` 的字段，不照搬词库 |
| 细节控 | 环境层次、表情肌肉、动作序列、音效、景别运动 | 用于剧本/分镜细化，不直接让图片模型生成所有动态过程 |
| 视频提示词 | 预设锁定、数人头、辨方位、主运动、二级动画、时间片段 | 用于视频 Prompt Compiler 和 I2V 模式 |
| 电影感生图 skill | 主体身份、尺度参照、空间层级、摄影机逻辑、光色、负面约束 | 转成视觉风格预设库和镜头提示词标准 |

### 3.2 不能直接照搬的部分

- 爆款示例里有大量夸张断言、极端数字和反常识表达，书籍导读不能无来源照搬。
- 部分参考提示词要求“每个分镜必须丰富发挥”，这与本项目的事实边界、成本和一致性要求冲突。
- 图片提示词资料偏 Midjourney 语法，本项目需要同时兼容图片模型、视频模型、参考图和后续合成。
- 超长提示词容易引入互相冲突的主体、风格和构图要求，尤其是批量分镜生成时会放大漂移。

采用原则：吸收结构，控制文风；吸收字段，保留工程边界；吸收词库，先做有限预设，不做无限堆叠。

## 4. 总体架构

### 4.1 目标产物

新增或强化以下结构化产物：

```text
CreativeBrief       目标、受众、平台、时长、风格边界、禁用项
ContentPlan         内容结构、段落目的、来源锚点、旁白草稿
ScriptDraft         可配音文稿或剧本
ScriptReview        结构、张力、事实、时长、可视化评分
AssetBible          角色、场景、道具、符号、时期、别名、使用镜头
DirectorTreatment   叙事策略、节奏、镜头语言、声音策略
ProductionBible     美术、灯光、调色、构图、连续性、禁用模式
ShotPlan            全片镜头预算、节奏曲线、镜头功能、转场
ShotSpec            单镜头叙事目的、主体、动作、空间、摄影、约束
AssetPromptSpec     资产图提示词结构化规格
PanelPromptSpec     分镜图提示词结构化规格
QualityReview       内容/资产/分镜/图片分项评分和失败路由
GenerationSnapshot  模型、参数、输入、prompt、参考图、候选、版本
```

### 4.2 阶段职责

| 阶段 | 只负责 | 不负责 |
| --- | --- | --- |
| 内容规划 | 信息结构、受众承诺、来源边界、段落目的 | 具体镜头构图 |
| 文稿/剧本 | 可配音表达、冲突与节奏、情绪推进 | 生成图片提示词 |
| 资产提取 | 需要稳定复用的角色/场景/道具/符号 | 直接决定最终构图 |
| 导演统筹 | 全片视听规则、镜头语言和连续性基线 | 逐字生成每个 prompt |
| 分镜规划 | 镜头功能、景别、主体动作、节奏、转场 | 资产形象细节重写 |
| Prompt Compiler | 把结构化规格编译成模型输入 | 判断故事是否好看 |
| 质量评审 | 按规格找错、给证据、路由修复 | 自行创造新剧情 |

## 5. 核心标准一：剧本/文稿质量

### 5.1 目标

文稿要同时满足四个条件：

1. 有明确观众承诺：观众为什么要看完。
2. 有稳定结构：不是每次运行都换一个方向。
3. 有事实边界：哪些来自材料，哪些来自模型常识。
4. 可视觉化：每段都能转成一个或多个可执行画面。

### 5.2 输入分级

| 输入类型 | 允许产物 | 风险控制 |
| --- | --- | --- |
| 只有书名 | 可编辑导读框架草稿 | `sourceType=model_knowledge`，置信度不高于 0.7，禁止精确引用和绝对化事实 |
| 书名 + 简介 | 导读大纲 + 保守旁白 | 简介优先于模型常识，未提供细节不能编造 |
| 章节/原文摘录 | 可配音文稿 + 来源锚点 | 可引用用户材料，但必须标明位置 |
| 完整长文 | 分块摘要 + 来源账本 + 分层计划 | 禁止单次截断导致后文丢失 |

### 5.3 文稿结构标准

`ContentPlan` 必须输出：

- `audiencePromise`：一句话说明观众看完得到什么。
- `thesis` 或 `logline`：全片中心判断。
- `hookPattern`：`contrast|reversal|question|visual_wonder|identity_filter`。
- `segments`：每段只回答一个问题或推进一个剧情节拍。
- `sourceAnchor`：每段来源锚点和置信度。
- `visualPurpose`：画面承担的信息功能。
- `riskFlags`：事实、剧透、夸张表达、不可视化风险。

### 5.4 文稿评分门禁

| 维度 | 权重 | 通过标准 |
| --- | --- | --- |
| 结构清晰度 | 20 | 有开场问题、主体段落、收束，不是散点罗列 |
| 观众吸引力 | 20 | 前 5-12 秒有一个明确反差、问题或承诺 |
| 来源可靠性 | 20 | 高风险事实有来源；弱来源使用保守表达 |
| 口播自然度 | 15 | 短句为主，按目标时长 85%-92% 规划 |
| 可视化程度 | 15 | 每段有可生成的视觉职责 |
| 稳定性 | 10 | 相同输入不应大幅改变立意和结构 |

自动继续生成的最低标准：

- 总分不低于 80。
- 不存在 `critical` 的事实错误、来源伪造、剧透越界。
- 如果只有书名且需要高质量导读，应给出“资料不足”的降级标记，不应假装是最终稿。

### 5.5 落地任务

1. 在 `content_plan.zh.txt` 增加 `hookPattern`、`riskFlags`、`sourceLedger` 和稳定结构要求。
2. 增加 `script_editor` 或扩展 `content_review.zh.txt`，独立检查张力、事实、节奏和可视化。
3. 为书名模式增加“草稿”标识，UI 和下游日志都能看见来源置信度。
4. 建立 `tests/fixtures/creative-quality/content/`，放入 5-10 个稳定回归样本。

## 6. 核心标准二：资产提取

### 6.1 目标

资产提取不是“出现过什么名字”，而是判断哪些视觉元素需要跨镜头稳定复用。

资产包括：

- 角色：人物、动物、拟人主体、重要旁观者。
- 场景：稳定空间、时代地点、反复出现的环境。
- 道具：被持有、触发剧情、承载信息或需要特写的物件。
- 符号：书封、地图、徽章、潜艇、怪物轮廓、抽象概念的可视化锚点。
- 形态版本：年龄、身份、服装、损伤、时代变化。

### 6.2 `AssetBible` 最小结构

```ts
type AssetBibleItem = {
  id: string
  kind: 'character' | 'location' | 'prop' | 'symbol'
  canonicalName: string
  aliases: string[]
  role: 'primary' | 'secondary' | 'background' | 'symbolic'
  narrativeFunction: string
  evidence: Array<{ sourceId: string; text: string; confidence: number }>
  visualInvariants: string[]
  allowedVariants: string[]
  forbiddenVariants: string[]
  firstAppearance: string
  usedByPanels: string[]
  priority: 'must_lock' | 'normal' | 'optional'
  generationNeed: 'reference_required' | 'prompt_only' | 'no_generation'
}
```

### 6.3 提取标准

- 别名必须合并到主名称，不能让“尼摩船长/船长/他”成为不同资产。
- 同一角色不同时期、身份、损伤状态要建 variant，不能覆盖基础形象。
- 道具只要推动剧情、承载信息或被镜头特写，就应进入资产库。
- 场景要记录“空间功能”，例如“压迫审判空间”“深海探索空间”，不是只记录地点名。
- 每个 `must_lock` 资产都必须能追溯到来源或剧本使用位置。

### 6.4 资产评分门禁

| 维度 | 通过标准 |
| --- | --- |
| 覆盖率 | 剧本中所有主要角色、关键场景、关键道具均已进入 `AssetBible` |
| 去重 | 别名、代称、时期变化处理正确 |
| 可画性 | 每个需生成资产都有形状、材质、颜色、关键部件或外观锚点 |
| 使用计划 | 关键资产能关联到具体 panel 或 visualUnit |
| 稳定性 | 同一资产有不变量和禁用变体，不被艺术风格覆盖 |

### 6.5 落地任务

1. 在现有 `character-profile`、`analyze-global` 和资产服务上方增加 `AssetBible` 聚合层。
2. 资产提取输入从“原文”升级为“原文 + ContentPlan + ScriptDraft + ShotPlan 草案”。
3. 增加 `asset_bible_review`，检查遗漏、重复、来源和可画性。
4. 在 `assetRefs` 持久化时记录来源：来自人工选择、自动提取、视觉计划还是修复补充。

## 7. 核心标准三：分镜规划

### 7.1 目标

分镜不是把文字切碎，而是分配镜头功能。每个镜头都应回答：

- 它承担什么叙事功能？
- 为什么需要这个景别？
- 它和前后镜头如何衔接？
- 它是否需要已锁定资产？
- 这张图是否可以单独生成？

### 7.2 两级分镜

先做全片 `ShotPlan`，再做单镜 `ShotSpec`。

`ShotPlan`：

- 全片镜头数量预算。
- 开场、铺垫、爆点、解释、呼吸、收束的比例。
- 景别循环：全景/中景/近景/特写不能无意义重复。
- 情绪曲线：压迫、悬念、释放、余韵。
- 跨 clip 连续性：角色位置、光色、场景、道具、上一镜末状态。

`ShotSpec`：

- `narrativeIntent`：镜头目的。
- `shotFunction`：`hook|setup|reaction|evidence|transition|payoff|breath|cta`。
- `primarySubject`：唯一主视觉主体。
- `visibleAssets`：必须出现的资产引用。
- `actionBeat`：单一主要视觉事件。
- `composition`：景别、角度、前中后景。
- `continuity`：承接上一镜和交给下一镜的信息。
- `singleImageFeasibility`：是否适合单图生成。

### 7.3 分镜规则

- 一个镜头只承担一个主要功能。
- 单图只能表达一个时空和一个主要视觉事件。
- 对话镜头必须清楚展示说话者；听者反应只有推动情绪时才单独成镜。
- 导读类内容不要全部人物插画，应在书封、引用卡、示意图、环境隐喻、动态文字之间分配。
- 讲解内容必须优先把抽象观点转成可见证据，例如地图、剖面、尺度对比、仪表、物理反馈。
- 除非视频模型明确需要，图片阶段不描述连续动作过程；只选择最能承载信息的一帧。

### 7.4 分镜评分门禁

| 维度 | 通过标准 |
| --- | --- |
| 镜头功能 | 每个镜头都有明确功能，不能只是换景别重复 |
| 节奏 | 镜头数量与总时长匹配，不机械按字符拆分 |
| 连续性 | 角色、场景、道具、光色、方向有承接 |
| 多样性 | 景别、主体、信息形式有合理变化 |
| 单图可执行性 | 不包含混剪、拼贴、多地点、连续动作塞入一张图 |
| 资产绑定 | 出现稳定资产时必须有 `assetRefs` |

### 7.5 落地任务

1. 强化 `visual_plan.zh.txt`：先输出全片 `ShotPlan`，再输出 `visualUnits`。
2. 强化 `agent_storyboard_plan.zh.txt`：增加 `shotFunction`、`continuity`、`singleImageFeasibility`。
3. 新增 `storyboard_review`，在生成图片前检查镜头功能、重复、连续性和单图可执行性。
4. 对 `.tmp/2.zip`、`.tmp/3.zip` 中同主题运行建立分镜稳定性回归对比。

## 8. 核心标准四：资产描述到提示词

### 8.1 目标

资产提示词要锁定“身份不变量”，而不是每次重新即兴发挥。

好的资产提示词不一定长，但必须完整覆盖：

1. 主体身份。
2. 轮廓和比例。
3. 材质和纹理。
4. 颜色和关键部件。
5. 视角和构图。
6. 背景隔离。
7. 项目风格如何作用。
8. 禁止项。

### 8.2 `AssetPromptSpec`

```ts
type AssetPromptSpec = {
  assetId: string
  assetKind: 'character' | 'location' | 'prop' | 'symbol'
  renderPurpose: 'reference_sheet' | 'single_reference' | 'variant' | 'repair'
  identityLocks: string[]
  shapeAndSilhouette: string[]
  materialAndTexture: string[]
  colorPalette: string[]
  keyParts: string[]
  viewAndComposition: string
  backgroundRule: string
  styleApplication: string
  negativeConstraints: string[]
  sourceEvidence: string[]
}
```

### 8.3 编译顺序

资产最终 prompt 按以下顺序编译：

```text
资产类型与用途
  -> 身份不变量
  -> 形体轮廓
  -> 材质纹理
  -> 颜色与关键部件
  -> 视角/构图/三视图要求
  -> 项目美术风格的有限作用范围
  -> 背景隔离
  -> 禁止项
```

禁止项必须放在末尾，避免被风格词覆盖：

```text
禁止文字、水印、徽标；禁止额外人物、脸、身体、手部；禁止已有 IP 角色；禁止复杂环境背景；只保留一个资产主体。
```

### 8.4 示例标准

不合格：

```text
尼摩船长的潜艇，电影感，细节丰富。
```

合格方向：

```text
单一资产设定图：十九世纪幻想工业风深海潜艇，长梭形金属船体，铆钉结构，暗铜与深铁灰配色，舷窗呈圆形排列，船首有坚固撞角，表面有轻微海水侵蚀和金属磨损，纯浅灰背景，三分之二侧视构图，主体完整居中；项目风格只作用于线条、材质和配色。禁止人物、脸、手、文字、水印、徽标、海底复杂背景和已有 IP 角色。
```

### 8.5 落地任务

1. 新增 `src/lib/prompt-compiler/asset-prompt-compiler.ts`。
2. 修改 `shot-ai-prompt-appearance.ts`、`shot-ai-prompt-location.ts`、`shot-ai-prompt-prop.ts` 或其上游调用，让它们先生成 `AssetPromptSpec` 再编译。
3. 为角色、场景、道具分别建立最小提示词模板。
4. 增加测试：资产隔离规则在最终 prompt 末尾，风格不能覆盖禁止项。

## 9. 核心标准五：分镜描述到提示词

### 9.1 目标

分镜提示词要从“画面意图”升级为“可执行镜头规格”。专业感来自结构完整，不来自形容词堆叠。

### 9.2 `PanelPromptSpec`

```ts
type PanelPromptSpec = {
  panelId: string
  visualType: string
  renderMode: 'generated_image' | 'text_card' | 'composite'
  aspectRatio: string
  narrativeIntent: string
  primarySubject: string
  assetRefs: Array<{ id: string; kind: string; name: string; role: string }>
  actionState: string
  environment: string
  spatialLayout: string
  composition: {
    shotType: string
    cameraAngle: string
    foreground: string
    midground: string
    background: string
  }
  lightingAndColor: string
  styleAndTexture: string
  qualityTerms: string[]
  textPolicy: 'no_text' | 'safe_area_only'
  negativeConstraints: string[]
}
```

### 9.3 图片 Prompt 编译顺序

```text
镜头类型和构图
  -> 主体和资产引用
  -> 当前动作状态
  -> 场景与空间关系
  -> 前景/中景/背景层级
  -> 光线与色彩
  -> 项目风格和质感
  -> 画质要求
  -> 无文字和禁止项
```

其中：

- `assetRefs` 是身份约束，不是装饰。
- `style` 只能作用于线条、材质、色彩和光影。
- `renderMode=text_card` 只生成无字背景和安全留白。
- `renderMode=composite` 只生成底图或单个素材，不伪造多图拼贴。

### 9.4 视频 Prompt 编译顺序

视频 prompt 与图片 prompt 分离：

```text
起始状态
  -> 主体主运动
  -> 二级动画
  -> 摄影机运动
  -> 焦点变化
  -> 环境运动
  -> 结束状态
  -> 连续性约束
```

I2V 模式不重复描述首帧已经锁定的静态外观，只描述首帧之后发生的变化。

### 9.5 为什么当前提示词看起来简单

当前项目里，UI 或数据中的 `imagePrompt` 更像“视觉意图字段”，最终模型输入还会叠加模板、结构化上下文、资产参考、风格、原文和质量约束。因此它看起来比网上长提示词简单。

但用户的感受仍然成立：如果可见的 `imagePrompt` 太粗，会带来三个问题：

1. 评审和人工编辑时无法判断画面专业度。
2. 上下游字段一旦缺失，最终 prompt 没有足够兜底。
3. 生成日志难以归因，不知道是构图、光色、主体还是风格导致失败。

落地方式不是直接把 `imagePrompt` 变成长文，而是新增 `compiledPromptPreview` 或 `PanelPromptSpec` 预览，让用户和日志看到真正的专业提示词结构。

### 9.6 落地任务

1. 新增 `src/lib/prompt-compiler/panel-image-prompt-compiler.ts`。
2. 在 `panel-image-task-handler.ts` 中保存 `PanelPromptSpec`、最终 prompt、模板版本和参考图顺序。
3. 在分镜 UI 中区分：
   - `description`：给用户看的画面说明。
   - `imagePrompt`：可编辑的视觉意图。
   - `compiledPromptPreview`：最终模型输入预览。
4. 增加 prompt completeness 测试：主体、动作、环境、构图、光色、风格、画质、约束都必须覆盖。

## 10. 核心标准六：质量评审与版本锁定

### 10.1 目标

减少两次运行差异，需要锁定三类版本：

- 内容版本：`ContentPlan`、文稿、来源账本。
- 视觉版本：`AssetBible`、`ProductionBible`、`ShotPlan`、`ShotSpec`。
- 生成版本：模型、参数、prompt、参考图、候选、修复记录。

### 10.2 质量 Review 统一字段

```ts
type QualityReview = {
  targetId: string
  targetType: 'content' | 'asset' | 'storyboard' | 'image' | 'video'
  specVersion: string
  score: number
  confidence: number
  status: 'passed' | 'repairable' | 'human_required' | 'failed'
  dimensions: Array<{ name: string; score: number; issues: string[] }>
  criticalIssues: string[]
  route: 'CONTENT_REVISE' | 'ASSET_REPAIR' | 'SHOT_REPLAN' | 'PROMPT_RECOMPILE' | 'REGENERATE' | 'HUMAN_REQUIRED'
  evidence: string[]
}
```

### 10.3 自动修复记录

每次自动修复必须记录：

```ts
type AutoRepairRecord = {
  sourceCandidateId: string
  repairCandidateIds: string[]
  scoreBefore: number
  scoreAfter: number
  accepted: boolean
  acceptedCandidateId?: string
  changedVariables: string[]
  promptPatch: {
    preserve: string[]
    add: string[]
    remove: string[]
    negative: string[]
  }
  stopReason: 'approved' | 'max_attempts' | 'human_required' | 'generation_failed'
}
```

这样才能回答“自动修复有没有起作用”和“为什么起作用”。

### 10.4 稳定性策略

- 同一项目生成下一阶段前，必须锁定上一阶段版本。
- 用户未修改时，重跑应复用已锁定的 `ContentPlan`、`AssetBible`、`ShotPlan`。
- 如果需要探索不同版本，应明确创建 A/B 分支，而不是覆盖当前项目。
- 每次生成保存 `inputHash`、`specHash`、`promptHash`、`assetVersionHash`。
- 质量评审只对当前 hash 有效，资产或 prompt 变化后旧评审失效。

## 11. 实施路线

### P0：标准和可观测性

目标：先让质量问题可见、可比、可归因。

任务：

1. 新增 `QualityContract` 类型定义草案。
2. 保存内容、资产、分镜、prompt 的版本 hash。
3. 在视觉自动修复记录中增加 `scoreBefore`、`scoreAfter`、`accepted`。
4. 建立 `.tmp/2.zip`、`.tmp/3.zip` 的回归分析脚本或手工对照表。
5. 为 `PromptCompiler` 定义单测样本，不接入生产调用。

验收：

- 任意一张最终图都能追溯到原始规格、最终 prompt、参考图、候选和修复记录。
- 能清楚解释自动修复是否改善、改善了哪个维度。

### P1：文稿和资产质量

目标：提升内容和资产稳定性，减少后续返工。

任务：

1. 强化 `content_plan.zh.txt` 和 `content_review.zh.txt`。
2. 增加 `ScriptReview`，区分“忠实转换”和“推广文稿重写”。
3. 建立 `AssetBible` 聚合层，处理别名、时期、道具、符号和使用计划。
4. 增加 `asset_bible_review`。

验收：

- 只有书名时产物标记为草稿，不伪造来源。
- 关键资产覆盖率不低于 95%。
- 同一输入重跑时，核心立意、段落结构和主要资产基本稳定。

### P2：分镜和提示词编译

目标：让分镜更像导演计划，让 prompt 更像专业生成规格。

任务：

1. 增加全片 `ShotPlan` 和 `storyboard_review`。
2. 增加 `AssetPromptSpec` 和 `PanelPromptSpec`。
3. 实现资产图 Prompt Compiler。
4. 实现分镜图 Prompt Compiler。
5. UI 和日志展示 `compiledPromptPreview`。

验收：

- 每个分镜都有 `shotFunction`、`primarySubject`、`assetRefs`、`singleImageFeasibility`。
- 最终 prompt 覆盖主体、动作、场景、构图、光色、风格、画质、约束。
- 同一资产跨图生成时外观漂移降低。

### P3：视频、Animatic 和全片反馈

目标：把图片质量提升扩展到视频和成片。

任务：

1. 视频 Prompt Compiler 接入 `ShotSpec` 和模型能力。
2. 增加 Animatic：临时 TTS + 分镜图 + 时长预演。
3. 增加 Rough Cut Review 和 Pickup List。
4. 建立指标看板：通过率、修复成功率、人工升级率、重跑次数、成本。

验收：

- 视频入口不再直接使用粗粒度 `videoPrompt`。
- 成片问题能路由到内容、资产、分镜、prompt、图片或视频生成中的具体一层。

## 12. 推荐代码边界

| 能力 | 建议位置 |
| --- | --- |
| 内容合同类型 | `src/lib/content-planning/types.ts` 或新增 `src/lib/creative-quality/contracts.ts` |
| AssetBible | `src/lib/assets/asset-bible.ts` |
| 分镜质量检查 | `src/lib/visual-planning/storyboard-review.ts` |
| 资产 Prompt Compiler | `src/lib/prompt-compiler/asset-prompt-compiler.ts` |
| 分镜图片 Prompt Compiler | `src/lib/prompt-compiler/panel-image-prompt-compiler.ts` |
| 视频 Prompt Compiler | `src/lib/prompt-compiler/panel-video-prompt-compiler.ts` |
| 质量版本 hash | `src/lib/visual-quality/version.ts` 可扩展 |
| 自动修复血缘 | `src/lib/workers/handlers/visual-auto-repair.ts` |
| 图片任务快照 | `src/lib/workers/handlers/panel-image-task-handler.ts` |
| prompt 回归测试 | `tests/unit/prompt-compiler/` |
| 质量合同测试 | `tests/unit/creative-quality/` |

## 13. 回归样本与指标

### 13.1 样本集

第一批样本：

- `.tmp/2.zip` 和 `.tmp/3.zip`：同主题不同运行结果，用于稳定性对比。
- `提示词示例.txt`：用于 prompt 结构完整性参考。
- `烘干黑龙.jpg`、`沙虫.jpg`、宇宙图参考：用于电影感和主体尺度测试。
- 自选 5 个小说/书籍输入：
  - 只有书名。
  - 书名 + 简介。
  - 原文片段。
  - 强剧情片段。
  - 导读型非剧情片段。

### 13.2 指标

| 指标 | 目标 |
| --- | --- |
| 内容评审通过率 | 不追求 100%，重点是阻断明显低质内容 |
| 关键资产覆盖率 | 95% 以上 |
| 分镜重复率 | 同一功能和景别连续重复应显著下降 |
| prompt 完整度 | 主体、动作、场景、构图、光色、风格、画质、约束覆盖率 100% |
| 图片首轮通过率 | 稳定提升，不以牺牲一致性换审美 |
| 自动修复接受率 | 有记录，可解释，成本可控 |
| 人工升级率 | 逐步下降，但关键低置信结果仍升级 |
| 同输入稳定性 | 核心立意、主要资产、镜头功能稳定，允许局部表达差异 |

## 14. 非目标

- 不一次性重写全部工作流。
- 不把所有提示词都强制变成长文。
- 不直接复制 `grok` 资料中的文风、极端表达和注入防护文本。
- 不用单一审美标准替代用户偏好。
- 不把 VLM 评分当成绝对真理；它只用于排序、发现问题和路由修复。
- 不在没有来源的情况下生成确定性书籍事实、直接引语、销量排名或作者归因。

## 15. 最小下一步

建议下一次实现从 P0 开始，保持 KISS：

1. 新增 `PromptCompiler` 的纯函数和测试，不先改数据库。
2. 给自动修复补齐前后评分和采用记录。
3. 给内容/资产/分镜增加最小 review schema。
4. 用 `.tmp/2.zip`、`.tmp/3.zip` 做一次手工基线表。
5. 再决定是否把 `compiledPromptPreview` 暴露到 UI。

这能最快验证核心假设：质量提升来自结构化合同、版本锁定和编译层，而不是来自单纯拉长提示词。

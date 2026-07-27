# 资产生成、分镜规划与分镜图片质量优化方案

- 日期：2026-07-24
- 状态：P0-P4 第一版已落地，待真实项目回归验证与第二轮效果调参
- 范围：小说推广工作流中的资产提取、资产图生成、分镜规划、分镜参考绑定、分镜图片生成与质量门禁
- 依据：`.tmp/7.zip` 运行结果、`visual-binding-plans.jsonl`、`visual-quality-reviews.jsonl`、`asset-bible.jsonl`、`storyboard-quality-reviews.jsonl`
- 关联文档：
  - `standards/design/novel-promotion-core-quality-optimization-20260723.md`
  - `standards/design/visual-asset-storyboard-production-refactor-20260724.md`
  - `standards/design/content-and-image-quality-improvement-20260722.md`

## 1. 本次结论

`.tmp/7.zip` 说明当前链路已经有明显基础能力：资产 Bible、资产图候选、分镜规划、独立绑定计划、视觉质量评审和自动修复都在运行。但最终效果仍不稳定，根因不是单个提示词不够长，而是资产、分镜、图片三层的生产合同还不够强。

核心问题可以归纳为三类：

1. 资产生成：能提取角色和场景，但对“核心可见主体”的判断不足。例如鹦鹉螺号内部舱室被建成场景，但鹦鹉螺号本体没有被建成道具、载具或核心物件资产。
2. 分镜规划：结构符合书籍导读，但镜头偏概念展示和信息卡，缺少连续画面关系、角色调度、动作推进和镜头功能变化。
3. 分镜图片生成：绑定链路生效，但缺少核心主体资产时只能靠文字生成；书封、文字、方向、跨镜头一致性等高约束问题仍不稳定。

后续优化不应只增加评测或对比机制，而应把资产、分镜、图片都改成结构化生产合同：先明确“画面中真正要稳定出现什么”，再规划“这个镜头为什么存在”，最后编译“模型应该如何生成这一帧”。

## 2. 对当前疑问的判断

### 2.1 为什么有鹦鹉螺号内部结构，却没有鹦鹉螺号道具

这是当前资产提取规则的典型缺口。

现有逻辑更容易把资产分成角色和场景。`鹦鹉螺号内部舱室_深海航行中` 被识别为一个稳定空间，因此进入 location。可是分镜中多次真正可见的主主体是“鹦鹉螺号潜水艇本体”，它不是内部舱室，也不是深海背景。

通用规则应明确：

- `X 内部` 是场景资产，只能锁定空间、光线、材质和落位。
- `X 本体` 如果会在镜头中作为主主体、反复出现、需要外观一致，就必须成为独立资产。
- 对载具、武器、书籍、地图、徽章、装置、怪物轮廓、标志性物件等，不能只因为它们不是“人物”就降级为普通提示词。

因此鹦鹉螺号不一定必须叫“道具”，但必须成为一种可绑定的核心视觉资产。工程上可以先复用现有 prop/location 承载，也可以引入 `vehicle` / `object` / `symbol` 等语义子类型。关键不是名字，而是它能被后续分镜作为 `primary_identity` 或 `prop_detail` 引用。

### 2.2 当前资产提取是否有检查机制

有检查机制，但检查维度不够覆盖这个问题。

从 `asset-bible-reviews.jsonl` 看，当前评审检查了覆盖率、去重、可追溯性、视觉清晰度、稳定性和使用计划，评分 95，但仍进入 `human_required`。它能发现阿龙纳斯缺少证据，但没有发现“分镜高频主主体缺少资产”。

缺少的是两个检查：

1. 主体覆盖检查：从文稿、视觉提示、分镜草案中抽取所有高频 `primarySubject`，反查资产库是否存在对应稳定资产。
2. 类型错配检查：如果某镜头需要的是外部载具主体，不能用“内部舱室场景”冒充满足。

### 2.3 是否需要分批生成再检查

需要，而且应该分成“资产描述检查”和“资产图片检查”两层。

建议资产链路从一次性生成改成四步：

```text
文稿/剧本
  -> 资产候选提取
  -> 资产 Bible 评审与缺口补全
  -> 资产图生成与资产图评审
  -> 资产锁定后进入分镜规划/图片生成
```

分镜规划后还要有一次反向检查：

```text
分镜规划
  -> 抽取每镜头 primarySubject / visibleAssets
  -> 反查资产库
  -> 发现核心主体缺失时，回填资产或要求重规划
```

这能避免 7.zip 中“鹦鹉螺号作为主主体反复出现，但资产库没有鹦鹉螺号本体”的问题。

### 2.4 分镜规划是否会偏离文稿剧情

会有风险。尤其在只有书名、文稿来源较弱、分镜模型被要求“画面丰富”时，模型可能加入文稿没有明确承载的视觉事件。

这类偏离分两种：

- 合理扩写：为了说明旁白，把抽象概念转成可视化隐喻。例如“超前科技”用结构图或现代潜艇对比。
- 不合理偏离：新增文稿没有的剧情事件、人物关系、结局信息、具体危机场景或过度戏剧化情节。

因此分镜必须增加 `sourceAnchor` 和 `visualLicense`：

- `sourceAnchor`：这个镜头对应哪一句旁白、哪个文稿段落、哪个来源。
- `visualLicense`：`literal`、`illustrative`、`metaphor`、`transition`、`text_card`。

如果是 `metaphor` 或 `illustrative`，必须声明它不是新增剧情，只是辅助理解。

### 2.5 一个分镜没有任何参考资产是否正常

有些情况下正常，但必须有明确原因。

正常场景：

- 文字卡、转场底图、抽象背景。
- 一次性概念镜头，不涉及后续一致性。
- 没有稳定身份要求的环境氛围图。
- 后期合成镜头的纯底图。

不正常场景：

- 镜头主主体是已知角色、载具、核心道具。
- 镜头属于连续空间或连续动作。
- 镜头需要和前后镜头保持主体外观一致。
- 镜头出现资产库里已有的角色、场景、道具，但绑定为空。

所以不是所有镜头都必须绑定资产，但每个无绑定镜头都应该输出 `noReferenceReason`，例如 `text_card`、`one_off_broll`、`abstract_background`、`asset_missing_blocked`。其中 `asset_missing_blocked` 应阻止自动生成或触发资产回填。

### 2.6 为什么这次分镜显得呆板

这次分镜更像“导读 PPT 化视觉说明”，不是连续影像设计。

它满足了信息结构：开场、设定、奇观、人文思考、阅读建议。但很多镜头只是“某个概念的图片”，缺少以下元素：

- 前后镜头之间的因果或动作承接。
- 主体在镜头中的变化。
- 角色视线、动作、反应和情绪推进。
- 景别、机位、运动方向的有意变化。
- 同一空间下的连续性。

视频本质上是一段连续帧。分镜图不应只是参考图，而应是“这段视频中某个时间点的关键帧”。每个分镜都应能回答：它承接上一镜什么，推动下一镜什么，画面中发生了什么变化。

## 3. 优化方向一：资产生成

### 3.1 目标

资产生成要从“提取名词”升级为“建立可复用视觉资产库”。资产库必须服务后续分镜和图片一致性。

目标结果：

1. 不漏掉高频核心主体。
2. 不把场景、载具、道具、符号混为一谈。
3. 每个 must-lock 资产都有来源、用途和视觉不变量。
4. 资产图能作为后续分镜参考，而不是只是一张好看的设定图。
5. 分镜规划发现新核心主体时，可以回填资产。

### 3.2 资产类型标准

建议采用两层类型：

```ts
kind: 'character' | 'location' | 'prop'
semanticType:
  | 'person'
  | 'interior_location'
  | 'exterior_location'
  | 'vehicle'
  | 'book'
  | 'weapon'
  | 'tool'
  | 'symbol'
  | 'creature'
  | 'device'
  | 'generic_object'
```

短期为了少改表，可以继续用现有 `character/location/prop`，但在资产描述 JSON 中增加 `semanticType`。例如：

- 鹦鹉螺号内部舱室：`kind=location`，`semanticType=interior_location`
- 鹦鹉螺号潜水艇本体：`kind=prop`，`semanticType=vehicle`
- 实体书/封面：`kind=prop`，`semanticType=book`

### 3.3 must-lock 规则

满足任一条件，应进入 must-lock：

- 作为多个镜头的主主体出现。
- 是作品或剧情的标志性视觉符号。
- 需要跨镜头保持外观一致。
- 被角色持有、操作、观看或特写。
- 会进入视频封面、开场钩子、收尾 CTA。
- 容易被模型生成错误或混入 IP 元素。

对 `.tmp/7.zip` 这类项目，通用判断会得出：

- 尼摩船长：must-lock 角色。
- 鹦鹉螺号潜水艇本体：must-lock 载具/核心物件。
- 鹦鹉螺号内部舱室：supporting location。
- 深海海底：supporting location。
- 实体书/书封：must-lock prop 或 composite target。

### 3.4 资产 Bible V2

每个资产应至少包含：

```ts
type AssetBibleItemV2 = {
  id: string
  kind: 'character' | 'location' | 'prop'
  semanticType: string
  canonicalName: string
  aliases: string[]
  importance: 'core' | 'recurring' | 'supporting' | 'one_off'
  usageScope: 'identity_lock' | 'environment_plate' | 'prop_detail' | 'style_only'
  narrativeFunction: string
  sourceEvidence: Array<{
    sourceId: string
    text: string
    confidence: number
  }>
  visualInvariants: string[]
  allowedVariants: string[]
  forbiddenVariants: string[]
  expectedUse: Array<{
    panelId?: string
    clipId?: string
    role: 'primary_subject' | 'visible_support' | 'background' | 'reference_only'
  }>
  generationNeed: 'required' | 'optional' | 'no_generation'
  missingRisk: 'blocking' | 'warning' | 'none'
}
```

### 3.5 资产提取流程

建议改为三次扫描：

1. 文稿扫描：从旁白、screenplay、visualHints 中提取角色、场景、道具、符号和核心主体。
2. 视觉主体扫描：从初版分镜或 visualUnits 中提取 `primarySubject`、`visibleAssets`、`referenceOnlyAssets`。
3. 缺口合并：把同名、别名、包含关系和类型错配进行合并或拆分。

合并和拆分规则：

- `X 内部` 与 `X 本体` 默认不合并。
- `X 封面` 与 `X 实体书` 默认可以关联，但要区分书本物体和封面图案。
- `现代潜水艇` 与 `鹦鹉螺号` 默认不合并，除非文稿明确要求同一对象。
- `作者` 与 `作品角色` 默认不合并。
- 抽象概念只有在会被多次视觉化时才建 symbol。

### 3.6 资产检查机制

资产 Bible 评审新增以下维度：

| 维度 | 检查内容 | 阻断条件 |
| --- | --- | --- |
| core_subject_coverage | 高频主主体是否都有资产 | 核心主主体缺资产 |
| type_correctness | 场景、载具、道具、角色是否混用 | 用 location 冒充 vehicle |
| evidence | must-lock 资产是否有来源 | 来源为空且非公知 fallback |
| usage_plan | 每个核心资产是否知道用于哪些镜头 | must-lock 没有 expectedUse |
| over_extraction | 是否提取了不会用的资产 | 大量 one_off 资产被 must-lock |
| generation_readiness | 资产描述是否足够生成参考图 | 缺少不变量、禁用项、变体 |

### 3.7 资产图生成标准

资产图不是最终分镜图。不同资产应采用不同图型：

- 角色：正面/侧面/背面或标准半身参考，重点锁定脸型、服饰、轮廓。
- 载具/道具：三视图或清晰 3/4 视角，重点锁定轮廓、材质、比例、关键部件。
- 场景：环境板，重点锁定空间、光色、材质和可落位区域。
- 书封/文字物件：只生成无字封面底图或可后期合成的干净物体，不直接生成可读文字。
- symbol：生成图标化、剪影化或抽象锚点，不强行写实。

### 3.8 资产生成落地阶段

P0：只改规则和检查，不大改数据表。

- 增加 `semanticType`、`importance`、`usageScope` 到资产描述结构。
- 资产评审增加 core subject 反查。
- 分镜规划后增加资产缺口报告。
- 如果发现核心主体缺资产，阻止自动分镜图生成或标记为 `asset_missing_blocked`。

P1：增加回填机制。

- 初版分镜生成后，自动生成 `missingAssetRequests`。
- 用户确认或自动通过后，补建核心资产。
- 资产补建完成后重新生成绑定计划。

P2：资产图质量升级。

- 按资产语义类型使用不同提示词模板。
- 资产图评审区分“好看”和“可作为参考图”。
- 对载具、书封、核心道具引入多视角或多候选锁定。

## 4. 优化方向二：分镜规划

### 4.1 目标

分镜规划要从“给每段文稿配几张图”升级为“连续影像的导演计划”。

目标结果：

1. 每个镜头严格服务文稿，不新增无依据剧情。
2. 每个镜头有明确功能，而不是只生成概念插图。
3. 镜头之间有连续关系、节奏变化和视觉递进。
4. 分镜能告诉下游图片和视频：主体是谁、动作是什么、前后如何承接。
5. 对不适合单张图承载的内容，主动拆镜或改合成。

### 4.2 当前实现判断

当前项目里实际存在两条分镜链路：

1. 书籍导读链路：主要走 `visual_plan`。它依赖 `VideoProfile`、`CreativeBrief`、`ContentPlan`、导读 `Clips`、已有资产、画幅和艺术风格，一次性生成 `directorTreatment`、`productionBible`、`shotPlan` 和 `visualUnits`，再把 `visualUnits` 落库成 storyboard panels。
2. 剧情/剧本链路：主要走 `script_to_storyboard`。它会把每个 clip 的结构化 screenplay 或原文片段交给多阶段分镜器，分为基础分镜、摄影设计、演技调度和细节补全，更接近传统“剧本拆分镜”的流程。

书籍导读里的 `clip` 不是传统电视剧剧本场次。它通常来自 `ContentPlan.segments`，本质是口播段落，包含 `narration`、`visualPurpose`、`visualHints`、`onScreenText` 和 `sourceAnchor`。所以当前导读分镜的真实路径是：

```text
导读内容计划
  -> 口播段落 clips
  -> visual_plan 生成视觉单元
  -> visualUnits 落库为分镜
```

这条链路的问题是，中间缺少一个“视听脚本”或“视觉节拍”层。系统现在基本是从口播段落直接跳到镜头规划，模型会自然选择最容易解释口播的信息画面，例如潜艇图、结构图、文字卡、书桌图。结果是信息对应基本正确，但画面容易像说明图或参考图，缺少连续视频应有的动作、承接和情绪推进。

现有专业知识主要来自提示词和轻量校验，而不是独立规则引擎。提示词已经要求 shotPlan、镜头功能、节奏曲线、连续性、单图可执行性、promptBlueprint 等字段；代码评审会检查主视觉主体、连续性说明、重复镜头、单图可行性、资产绑定和时长。但它还不能稳定判断：

- 镜头是否只是静态说明图。
- 镜头之间是否真的有动作承接。
- 是否存在更好的景别递进。
- 每段口播是否被转成了可运动、可剪辑的画面。
- 导读中的解释性画面是否过多，导致成片像 PPT。

### 4.3 目标链路：增加视听脚本层

导读不一定需要电视剧式 screenplay，但需要一个更适合导读的 `AudioVisualScript` 或 `VisualBeatPlan`。它位于内容计划和分镜规划之间，负责把“口播想说什么”转换成“画面如何连续讲出来”。

建议目标链路调整为：

```text
ContentPlan / guide segments
  -> AudioVisualScript / VisualBeatPlan
  -> ShotMap
  -> StoryboardPanels / visualUnits
  -> PanelPromptSpec
```

`VisualBeatPlan` 不直接生成图片提示词，而是定义每段口播的画面策略：

```ts
type VisualBeat = {
  id: string
  clipId: string
  narrationSlice: string
  sourceAnchor: {
    label: string
    sourceText: string
    sourceType: string
    confidence: number
  }
  beatFunction:
    | 'hook'
    | 'concept_setup'
    | 'evidence'
    | 'contrast'
    | 'wonder'
    | 'character_moment'
    | 'reading_advice'
    | 'cta'
  visualLicense: 'literal' | 'illustrative' | 'metaphor' | 'transition' | 'text_card'
  screenEvent: string
  subject: string
  actionMoment: string
  continuityIn: string
  continuityOut: string
  assetNeeds: Array<{
    name: string
    expectedKind: 'character' | 'location' | 'prop'
    role: 'primary_subject' | 'supporting_visible' | 'environment' | 'reference_only'
    mustLock: boolean
  }>
  recommendedShotCount: number
  riskFlags: string[]
}
```

这层要回答四个问题：

1. 这段口播应画成事实画面、解释性画面、隐喻画面、转场，还是文字卡。
2. 画面里真正发生什么动作或变化。
3. 画面和上一段、下一段如何衔接。
4. 哪些主体需要资产锁定，哪些只是一次性 b-roll。

### 4.4 专业知识驱动方式

优化方向不是把所有导演知识都写进一个超长 prompt，而是把专业知识拆成可验证规则。

建议形成四类规则：

| 规则层 | 职责 | 示例 |
| --- | --- | --- |
| 内容到视觉规则 | 判断口播适合哪种视觉表达 | 事实判断用 evidence，阅读建议可用 book/reader/action，不直接造剧情 |
| 镜头语法规则 | 决定景别、机位、动作和节奏 | 建立镜头后接主体动作或细节，不连续使用静态概念图 |
| 连续性规则 | 控制前后镜头的视觉承接 | 同一主体保持方向、光色、尺度；下一镜承接上一镜动作或信息 |
| 资产规则 | 判断哪些主体必须绑定资产 | 高频主主体、标志性载具、书封和核心道具必须 must-lock |

导读模式下应特别增加这些约束：

- 每个 clip 不只是“对应一张说明图”，而是先拆成一个或多个 `VisualBeat`。
- 每个 `VisualBeat` 必须有 `screenEvent`，即画面中可见的动作、变化或信息揭示。
- 纯静态图、文字卡、diagram 可以存在，但必须控制比例。
- 连续两个以上 `illustrative` 或 `text_card` 镜头时，评审应提示“过于说明化”。
- 如果内容段落是观点或建议，也要优先找可拍的动作瞬间，例如翻书、标注、舷窗外景、仪表变化、角色观看，而不是只生成概念背景。

### 4.5 分镜规划合同

每个 panel 应包含：

```ts
type StoryboardPanelV2 = {
  id: string
  clipId: string
  sourceAnchor: {
    voiceLineId?: string
    screenplayId?: string
    sourceText: string
  }
  visualLicense: 'literal' | 'illustrative' | 'metaphor' | 'transition' | 'text_card'
  shotFunction:
    | 'hook'
    | 'setup'
    | 'evidence'
    | 'contrast'
    | 'action'
    | 'reaction'
    | 'detail'
    | 'transition'
    | 'breath'
    | 'cta'
  primarySubject: string
  actionMoment: string
  emotionalBeat: string
  shotType: string
  cameraAngle: string
  cameraMove: string
  continuityGroup?: string
  previousContinuity?: string
  nextContinuity?: string
  visibleAssets: Array<{ id: string; role: string }>
  referenceOnlyAssets: Array<{ id: string; role: string }>
  renderStrategy: 'generated_image' | 'text_card' | 'composite' | 'diagram' | 'clean_plate'
  textPolicy: 'no_text' | 'overlay_later' | 'model_text_allowed'
  complexity: 'low' | 'medium' | 'high' | 'too_complex'
}
```

### 4.6 防偏离文稿规则

分镜生成必须遵守：

- 不新增文稿没有承载的剧情结果、人物身份、死亡、胜负、反转和结局。
- 不把旁白中的类比误画成真实剧情。
- 允许解释性画面，但必须标记 `visualLicense=illustrative`。
- 允许视觉隐喻，但必须标记 `visualLicense=metaphor`，且不能替代事实。
- 每个镜头必须能追溯到某段旁白或 screenplay。

评审新增：

| 维度 | 检查内容 |
| --- | --- |
| source_alignment | 镜头是否有文稿锚点，是否越界扩写 |
| visual_license | 插图、隐喻、文字卡是否明确标记 |
| shot_function | 镜头功能是否重复或缺失 |
| continuity | 前后镜头是否有视觉承接 |
| active_frame | 是否只是静态参考图，是否有动作瞬间 |
| asset_need | 主主体是否需要资产，绑定是否完整 |
| feasibility | 单张图是否承载过多信息 |

### 4.7 让分镜不呆板的规则

每个片段内应至少包含两类镜头功能，避免连续概念图：

- establishing：建立空间或主题。
- action：主体正在做一件事。
- detail：关键物件、手部、机械、书页、仪表等特写。
- reaction：人物或观众视角的反应。
- contrast：过去/现在、想象/现实、外部/内部对照。
- transition：自然转场，不承担核心叙事信息。
- text_card：仅用于强调观点，不能连续过多。

导读视频可以使用概念画面，但要有节奏比例：

- 角色/主体行动镜头不少于 35%。
- 纯文字卡不超过 20%。
- 一次性概念 b-roll 不连续超过 2 个镜头。
- 每 20-30 秒至少出现一次新的视觉动作或信息转折。
- 同一核心主体跨镜头出现时，必须属于同一个 continuityGroup。

### 4.8 连续帧设计

每个分镜图应被定义为视频关键帧，而不是独立插图。

分镜规划需要输出：

- `startState`：镜头开始时画面状态。
- `keyFrame`：当前分镜图应该定格的关键瞬间。
- `endState`：镜头结束时画面状态。
- `motionPlan`：主体运动、镜头运动、环境次级运动。
- `cutReason`：为什么从上一镜切到这一镜。

例如：

```text
上一镜：深海黑暗中远处出现银色轮廓。
本镜：潜艇船头从暗处掠过，窗光划过水体。
下一镜：切入舱内，看见舷窗和仪表。
```

这种规划比“鹦鹉螺号在深海航行”更适合生成连续视频。

### 4.9 分镜规划落地阶段

P0：暴露当前规划依据并加强结构。

- 在日志和导出包中明确标记当前分镜来自 `visual_plan` 还是 `script_to_storyboard`。
- 在 visual plan 中增加 `primarySubject`、`shotFunction`、`visualLicense`、`continuityGroup`。
- 分镜评审增加 source alignment 和 active frame 检查。
- 无参考资产的镜头必须输出 `noReferenceReason`。

P1：增加 `VisualBeatPlan`。

- 从 `ContentPlan.segments` 或 screenplay 生成 `VisualBeat`。
- 每个 VisualBeat 必须定义 `screenEvent`、`visualLicense`、`assetNeeds` 和连续性。
- 分镜规划必须基于 VisualBeat，而不是直接从口播段落跳到 visualUnit。

P2：增加全片导演审查。

- 在生成单镜头前先生成全片 shot map。
- 检查镜头功能比例、重复度、文字卡比例、连续镜头关系。
- 对呆板片段自动提出拆镜或重排建议。

P3：接入视频生成需求。

- 分镜规划输出 start/key/end 三段状态。
- 视频 prompt 由 motionPlan 编译，而不是只靠一句 videoPrompt。
- 视频生成前检查每个镜头是否具备可运动主体或可运动环境。

## 5. 优化方向三：分镜图片生成

### 5.1 目标

分镜图片生成要从“根据一句描述生成图”升级为“根据镜头合同生成关键帧”。

目标结果：

1. 有核心资产时必须用参考图锁定。
2. 无核心资产时必须说明原因，不能静默降级。
3. 复杂镜头自动拆解、合成或转人工确认。
4. 提示词专业化，但不是简单变长，而是结构化编译。
5. 视觉质检和自动修复状态必须一致、可追踪、可回归。

### 5.2 分镜图片 PromptSpec

`panel.imagePrompt` 可以继续作为界面短描述，但最终生成必须使用结构化 `PanelPromptSpec`。

```ts
type PanelPromptSpecV2 = {
  panelId: string
  primarySubject: {
    name: string
    role: string
    mustMatchAssetId?: string
  }
  scene: {
    locationAssetId?: string
    environmentDescription: string
    timeOfDay?: string
    lighting: string
  }
  actionMoment: string
  composition: {
    shotType: string
    cameraAngle: string
    subjectScale: string
    foreground: string
    midground: string
    background: string
    safeArea?: string
  }
  style: {
    artStyle: string
    palette: string[]
    lineQuality: string
    texture: string
  }
  references: VisualReference[]
  textPolicy: {
    imageText: 'forbidden' | 'allowed'
    overlayText?: string
    safeAreaRequired: boolean
  }
  negativeRules: string[]
  complexity: {
    score: number
    riskFlags: string[]
    route: 'generate' | 'split' | 'composite' | 'asset_backfill' | 'human_required'
  }
}
```

### 5.3 参考图绑定规则

参考图要有角色、权重和用途：

```ts
type VisualReference = {
  assetId: string
  renderId: string
  kind: 'character' | 'location' | 'prop' | 'style' | 'previous_frame'
  role:
    | 'primary_identity'
    | 'supporting_identity'
    | 'environment'
    | 'prop_detail'
    | 'style_only'
    | 'continuity_frame'
  usage: 'must_match' | 'adapt' | 'avoid_copy'
  weight: number
}
```

通用规则：

- 主角色镜头：主角色必须 `primary_identity`，场景可作为 `environment`。
- 核心载具镜头：载具必须 `primary_identity` 或 `prop_detail`，不能只绑定环境。
- 场景镜头：场景作为 `environment`，道具只有真实可见时才绑定。
- 文字卡：默认不绑定角色、载具和场景，除非它们真的出现在底图中。
- 书封/信息图：默认走 composite，不让图片模型直接生成可读文字。
- 连续镜头：可以增加上一镜定稿图作为 `continuity_frame`。

无参考图规则：

- `noReferenceReason=text_card`：允许。
- `noReferenceReason=abstract_transition`：允许。
- `noReferenceReason=one_off_broll`：允许，但应标记低一致性风险。
- `noReferenceReason=asset_missing_blocked`：不允许自动生成，应先回填资产。

### 5.4 复杂度门禁

以下情况不建议直接单图生成：

- 一个镜头同时要求多个主体、多个动作、多个时空。
- 同时要求准确文字、书封、人物、场景。
- 既要像参考图，又要大幅改变身份或造型。
- 要表现一个完整过程，而不是一个关键瞬间。
- 主主体方向、运动轨迹和空间关系非常关键。

处理策略：

| 问题 | 路由 |
| --- | --- |
| 核心资产缺失 | asset_backfill |
| 信息太多 | split |
| 需要准确文字 | composite |
| 主体方向强约束 | generate with pose/continuity reference，失败后 human_required |
| 书封或海报 | clean plate + overlay |
| 纯观点表达 | text_card |

### 5.5 图片质量评审

评审不能只看“好看”，必须看是否满足镜头合同。

新增或强化维度：

| 维度 | 检查内容 |
| --- | --- |
| subject_match | 主主体是否正确 |
| asset_match | 是否像绑定资产 |
| reference_role | 是否误把环境参考画成主主体 |
| continuity | 与前后镜头是否统一 |
| action_moment | 是否表现了指定关键瞬间 |
| composition | 景别、机位、安全区是否正确 |
| style_control | 是否只继承风格，不引入第三方 IP |
| text_policy | 是否无字、是否留白、是否误写文字 |
| feasibility | 是否因信息过载导致画面混乱 |

必须修复的状态问题：

- `score` 很低但 `reviewStatus=passed` 不允许出现。
- `review.status`、`decision.action`、`visualQualityState.status` 必须通过统一状态机推导。
- 自动修复后如果分数下降，应保留原始较优候选，不应把 activeCandidate 指向更差结果。

### 5.6 自动修复策略

自动修复应根据错误类型选择动作：

- `STYLE_MISMATCH`：可编辑或重生。
- `TEXT_ERROR`：书封/文字卡优先 composite，不反复让模型擦字。
- `SUBJECT_MISMATCH`：如果主主体错，优先重生；如果缺资产，先回填资产。
- `ASSET_MISMATCH`：提高参考图权重或要求人工锁定资产。
- `DIRECTION_ERROR`：增加姿态、朝向、上一帧/目标帧约束；一轮失败后进入人工确认。
- `COMPOSITION_ERROR`：可编辑。

自动修复的上限要按风险区分：

- 普通 b-roll：1 次。
- 核心主体镜头：2 次或进入人工确认。
- 书封/文字类：不超过 1 次，失败后改 composite。
- 方向/姿态强约束：生成候选多样化，而不是只改一句负面词。

### 5.7 分镜图片落地阶段

P0：修正状态和阻断规则。

- 修复低分 passed 的状态一致性问题。
- 无参考资产时输出 `noReferenceReason`。
- 核心主主体缺资产时阻止自动生成或标记人审。

P1：引入 PromptSpec 编译。

- UI 短描述和最终 compiled prompt 分离。
- 日志导出 PromptSpec、compiled prompt、参考图角色和复杂度路由。
- 对文字卡、书封、diagram 使用不同模板。

P2：强化连续性。

- 增加 previous frame / continuity group 参考。
- 核心主体镜头强制使用已锁定资产。
- 对一组连续镜头统一风格、光色、主体尺度和方向。

P3：合成化处理高风险图。

- 文字卡统一生成干净底图，准确文字由后期渲染。
- 书封、海报、资料卡改为 clean plate + overlay。
- 封面类镜头不直接让模型生成真实可读标题。

## 6. 深挖优化的可落地实现方案

本章把资产生成和分镜图片生成的专业化思路转换成工程可实施方案。目标不是一次性重写全链路，而是在现有模块上增加明确的数据结构、门禁和路由，让每一步都能被日志、测试和导出包验证。

### 6.1 资产生成：从名词提取升级为视觉设计系统

#### 6.1.1 新增资产分级

在资产 Bible 解析层增加 `assetTier`，先存入资产描述 JSON 或 quality artifact，不强制第一阶段改数据库表。

```ts
type AssetTier = 'hero' | 'supporting' | 'one_off' | 'composite'

type AssetTierDecision = {
  assetId: string
  assetTier: AssetTier
  reason: string
  mustLock: boolean
  expectedPanelRefs: string[]
  riskFlags: string[]
}
```

分级规则：

- `hero`：核心角色、核心载具、核心道具、视频封面主体、跨多个镜头复用的主视觉对象。
- `supporting`：常用环境、空间、背景道具、稳定氛围资产。
- `one_off`：只出现一次的说明性 b-roll 主体，如一次性机器人、火山、鱼群。
- `composite`：书封、文字卡、资料卡、排行榜、海报、需要准确文字的视觉对象。

落地位置建议：

- 资产提取：`src/lib/assets/asset-bible.ts`
- 资产评审：`src/lib/assets/asset-bible-review.ts`
- 测试：`tests/unit/assets/asset-bible.test.ts`、`tests/unit/assets/asset-bible-review.test.ts`

验收标准：

- `.tmp/7.zip` 同类输入中，鹦鹉螺号本体应被判定为 `hero`。
- 实体书/书封应被判定为 `composite` 或 `hero + composite`。
- 深海海底、内部舱室应为 `supporting`，不能替代鹦鹉螺号本体。

#### 6.1.2 新增资产关系图

资产库需要表达“属于、包含、关联、替代关系”，避免把内部场景当成本体资产。

```ts
type AssetRelation = {
  fromAssetId: string
  toAssetId: string
  relation:
    | 'part_of'
    | 'contains'
    | 'located_in'
    | 'operated_by'
    | 'visual_variant_of'
    | 'not_equivalent'
  reason: string
}
```

通用规则：

- `X 内部舱室` `part_of` `X 本体`，但不等价。
- `X 船长` `operated_by` 或 `associated_with` `X 载具`，但不等价。
- `现代潜水艇` 与 `鹦鹉螺号` 默认 `not_equivalent`，除非输入明确说明同一对象。
- `实体书` contains `书封底图`，准确文字由 overlay 承担。

第一阶段不需要复杂图数据库，只需要在资产 Bible artifact 中输出 `relations`，并在缺口检查时使用。

验收标准：

- 当分镜主主体是“鹦鹉螺号潜水艇本体”时，不能因为存在“鹦鹉螺号内部舱室”而通过 hero coverage。
- 当分镜是“舱内舷窗旁的尼摩船长”时，可以同时使用角色资产和内部舱室环境资产。

#### 6.1.3 新增核心主体反查

在分镜规划后增加 `AssetCoverageAudit`，从 visualUnits 或 panels 中抽取 `primarySubject`、`visibleAssets`、`imagePrompt` 主体，再反查资产库。

```ts
type AssetCoverageAuditItem = {
  panelId: string
  primarySubject: string
  matchedAssetId?: string
  expectedKind?: 'character' | 'location' | 'prop'
  coverageStatus: 'covered' | 'covered_by_wrong_type' | 'missing' | 'one_off_allowed'
  severity: 'blocking' | 'warning' | 'info'
  suggestedAction: 'continue' | 'create_asset' | 'change_binding' | 'mark_one_off'
}
```

触发阻断的情况：

- `hero` 主体缺资产。
- 主体被错误类型覆盖，例如载具主体只匹配到内部场景。
- 同一主主体在多个镜头出现但没有稳定资产。
- 书封或文字物件直接走文生图，而没有 composite 策略。

落地位置建议：

- 新增：`src/lib/assets/asset-coverage-audit.ts`
- 在 `src/lib/workers/handlers/visual-plan.ts` 生成或复用 visual plan 后执行。
- 将结果写入 quality artifact，导出到 `quality/asset-coverage-audits.jsonl`。

验收标准：

- 如果缺少鹦鹉螺号本体资产，P01/P07/P12 进入 `asset_missing_blocked` 或生成 `missingAssetRequests`。
- UI 和日志能说明“为什么不能只用内部舱室资产”。

#### 6.1.4 新增资产图型模板

资产图生成应按 `semanticType` 选择模板，而不是一套通用描述。

```ts
type AssetImageTemplateKind =
  | 'character_reference_sheet'
  | 'vehicle_turnaround'
  | 'prop_turnaround'
  | 'environment_plate'
  | 'book_clean_plate'
  | 'symbol_sheet'
```

模板选择：

- `character/person` -> `character_reference_sheet`
- `prop/vehicle` -> `vehicle_turnaround`
- `prop/book` -> `book_clean_plate`
- `location/interior_location` -> `environment_plate`
- `location/exterior_location` -> `environment_plate`
- `prop/symbol` -> `symbol_sheet`

验收标准：

- 载具类资产至少明确轮廓、头尾方向、材质、关键部件、不可变颜色。
- 场景类资产必须包含空间层次和可落位区域。
- 书封类资产不得生成可读文字，只生成干净封面或书本物体。

### 6.2 分镜图片：从描述生成升级为关键帧生产

#### 6.2.1 引入 PanelPromptSpec

保留 `panel.imagePrompt` 作为 UI 短描述，但最终图片生成使用结构化 `PanelPromptSpec` 编译。

```ts
type PanelPromptSpec = {
  panelId: string
  source: {
    clipId: string
    sourceAnchor?: string
    visualLicense: 'literal' | 'illustrative' | 'metaphor' | 'transition' | 'text_card'
  }
  subject: {
    primarySubject: string
    assetId?: string
    subjectRole: 'character' | 'location' | 'prop' | 'abstract'
    actionMoment: string
  }
  frame: {
    shotType: string
    cameraAngle: string
    composition: string
    foreground: string
    midground: string
    background: string
    safeArea: string
  }
  continuity: {
    groupId?: string
    previousPanelId?: string
    screenDirection: string
    lightingContinuity: string
    subjectScale: string
  }
  references: VisualReference[]
  textPolicy: {
    imageText: 'forbidden' | 'allowed'
    overlayText?: string
    requiresSafeArea: boolean
  }
  route: 'generate' | 'composite' | 'split' | 'asset_backfill' | 'human_required'
  negativeRules: string[]
}
```

落地位置建议：

- 新增：`src/lib/prompt-compiler/panel-prompt-spec.ts`
- 扩展：`src/lib/prompt-compiler/panel-image-prompt-compiler.ts`
- 导出：`quality/prompt-snapshots.jsonl` 中记录 `promptSpec`、`compiledPrompt`、`referenceRoles`。

验收标准：

- 用户界面短提示词可以简洁，但日志中能看到完整 `PanelPromptSpec` 和最终 compiled prompt。
- 图片生成不再只依赖 `panel.imagePrompt` 的自然语言描述。

#### 6.2.2 参考图角色和权重

现有参考绑定要升级为带角色、用途和权重的引用。

```ts
type VisualReference = {
  assetId: string
  renderId: string
  kind: 'character' | 'location' | 'prop' | 'style' | 'previous_frame'
  role:
    | 'primary_identity'
    | 'supporting_identity'
    | 'environment'
    | 'prop_detail'
    | 'style_only'
    | 'continuity_frame'
  usage: 'must_match' | 'adapt' | 'avoid_copy'
  weight: number
}
```

编译规则：

- `primary_identity`：主体必须像参考资产，外观不可漂移。
- `environment`：只参考空间、光色和材质，不能把环境参考当主体。
- `prop_detail`：锁定道具/载具轮廓、结构、材质、颜色。
- `style_only`：只使用风格，不复制参考图主体。
- `continuity_frame`：承接上一镜构图、光色或主体尺度。

落地位置建议：

- 扩展：`src/lib/visual-production/binding-plan.ts`
- 扩展：`src/lib/visual-production/references.ts`
- 测试：`tests/unit/visual-production/bindings-references.test.ts`

验收标准：

- 潜艇镜头必须有 `prop_detail` 或 `primary_identity` 的鹦鹉螺号本体参考。
- 文本卡默认不带角色和载具身份参考。
- 场景参考不会被错误编译成画面主主体。

#### 6.2.3 复杂度路由

图片生成前增加 `PanelGenerationRouter`，决定是否直接生成、拆镜、合成、补资产或人审。

```ts
type PanelGenerationRouteDecision = {
  panelId: string
  route: 'generate' | 'composite' | 'split' | 'asset_backfill' | 'human_required'
  reasons: string[]
  blockingAssetNames: string[]
  suggestedFix?: string
}
```

路由规则：

- 核心主体缺资产 -> `asset_backfill`
- 书封、文字卡、资料卡 -> `composite`
- 多主体、多动作、多时空 -> `split`
- 主体方向强约束且无参考 -> `human_required` 或补 pose/continuity reference
- 普通一次性 b-roll -> `generate`

落地位置建议：

- 新增：`src/lib/visual-production/panel-generation-router.ts`
- 在分镜图片任务提交前执行。
- 将 decision 写入 panel `photographyRules.assetBindingPlan` 或独立 quality artifact。

验收标准：

- P10 书封类镜头不再直接走普通文生图。
- 核心主体缺失时不会静默生成“看起来还行但不一致”的候选图。
- 多信息镜头会提示拆镜或合成，而不是硬塞进一个 prompt。

#### 6.2.4 连续性生成

为连续镜头增加 `continuityGroup`，图片生成时可引用同组资产和上一镜定稿图。

```ts
type ContinuityGroup = {
  id: string
  subjectAssetIds: string[]
  locationAssetId?: string
  colorGrade: string
  lightingBaseline: string
  screenDirection: string
  panels: string[]
}
```

落地策略：

- 分镜规划输出 `continuityGroup`。
- 图片生成收集同组主资产、场景资产和上一镜 confirmed image。
- 未确认上一镜时，只使用资产参考，不使用候选图作为 continuity frame。
- 视频生成阶段沿用同一 continuityGroup，避免图和视频提示词割裂。

验收标准：

- 同一主体连续镜头中，造型、颜色、主体尺度和方向更稳定。
- P01/P07/P12 这类潜艇镜头不会像三个不同潜艇。

#### 6.2.5 失败类型专业化

视觉质检和自动修复要按错误类型选择专业路由。

| 错误类型 | 处理方式 |
| --- | --- |
| 主体错误 | 如果资产存在则重生并提高参考权重；如果资产缺失则回填资产 |
| 不像参考图 | 检查 reference role，提升 `primary_identity` / `prop_detail` 权重 |
| 风格错 | 编辑或重生，强化风格隔离和 IP 禁止项 |
| 文字错 | 转 composite，不反复让模型擦字 |
| 方向错 | 增加姿态、头尾方向、上一帧或目标帧参考 |
| 信息过载 | split，不继续堆 prompt |
| 构图/安全区错 | 局部编辑或重生 |

落地位置建议：

- 扩展：`src/lib/visual-quality/repair-policy.ts`
- 扩展：`src/lib/workers/handlers/visual-auto-repair.ts`
- 修复状态：`src/lib/media/visual-quality-state.ts`

验收标准：

- `score` 很低但 `passed` 的状态矛盾被统一状态机拦截。
- 自动修复后分数下降时，active candidate 不应覆盖原始较优候选。
- 书封文字错不再反复进入普通 image edit。

### 6.3 分阶段开发任务

#### P0：低风险可见收益

目标：先让系统知道“什么时候不能直接生成”。

任务：

1. 增加资产分级和 `semanticType` 解析，先落在 JSON/artifact。
2. 增加 `AssetCoverageAudit`，从 visualUnits 反查核心主体资产。
3. 为无参考资产镜头增加 `noReferenceReason`。
4. 修复视觉质量状态一致性。
5. 日志导出新增 asset coverage、route decision 和 reference roles。

验收：

- 同类项目能明确报告“缺少鹦鹉螺号本体资产”。
- P05 低分 passed 不再出现。
- 文本卡、书封、普通 b-roll 的无参考原因可解释。

#### P1：资产库变成可复用设计系统

目标：补齐 hero asset 和 asset relation。

任务：

1. 增加 `AssetRelation` artifact。
2. 增加 `missingAssetRequests`，支持分镜后回填资产。
3. 载具、书本、场景、角色使用不同资产图模板。
4. 资产图评审增加“可作为参考图”的指标。

验收：

- 鹦鹉螺号本体可被生成为载具资产，并被后续潜艇镜头绑定。
- 内部舱室和本体不再被误判为同一资产。
- 书封类资产默认输出 clean plate。

#### P2：分镜图片进入结构化生成

目标：让图片生成依赖 `PanelPromptSpec`，而不是一句自然语言。

任务：

1. 引入 `PanelPromptSpec`。
2. 编译器输出 compiled prompt、negative rules、reference instructions。
3. 参考图增加 role、usage、weight。
4. 增加 `PanelGenerationRouter`。

验收：

- prompt snapshot 能展示短描述、PromptSpec、compiled prompt 三层。
- 核心主体参考图以 `primary_identity` 或 `prop_detail` 进入最终生成。
- 书封/文字卡能被路由到 composite。

#### P3：连续性与视频关键帧

目标：分镜图片从独立插图变成连续视频关键帧。

任务：

1. 增加 `continuityGroup`。
2. 支持 previous confirmed frame 作为 `continuity_frame`。
3. 图片 prompt 和视频 prompt 共用同一 motion/continuity contract。
4. 粗剪评审增加连续性专项。

验收：

- 同一主体跨镜头造型、方向、光色更稳定。
- 分镜图不再只是说明图，而能承接上一镜并推动下一镜。

### 6.4 优先改造顺序

建议先做资产，再做图片，不反过来。

1. `AssetCoverageAudit`：最快发现漏资产和类型错配。
2. `assetTier + semanticType`：为后续路由提供依据。
3. `PanelGenerationRouter`：先避免明显不该直接生成的图。
4. `VisualReference role/weight`：解决参考图使用不清。
5. `PanelPromptSpec`：提升提示词专业度和可追踪性。
6. `continuityGroup`：提升跨镜头一致性。

这样做的原因是：如果没有 hero asset，分镜图片阶段只能继续靠文本猜主体，PromptSpec 再专业也无法稳定锁住外观。

## 7. 推荐实施顺序

后续可以按三个方面逐项讨论和实施：

1. 资产生成优先：先解决核心主体缺失、类型错配和资产回填。否则分镜图片再怎么优化，也缺少可绑定对象。
2. 分镜规划第二：让分镜从概念图升级为连续关键帧，避免呆板和无剧情推进。
3. 分镜图片生成第三：在资产和分镜合同稳定后，再优化 PromptSpec、参考图权重、质量评审和自动修复。

每一阶段都应以小闭环验收：

- 资产阶段验收：同一项目能发现并创建核心载具、书封/书本、重要道具；没有误把内部场景当成本体资产。
- 分镜阶段验收：每个镜头有文稿锚点、镜头功能、动作瞬间和连续关系；无引用资产时有明确原因。
- 图片阶段验收：核心主体跨镜头像资产；文字/书封不乱生成；低分状态不通过；复杂镜头能自动路由到拆镜、合成或人审。

## 8. 对 `.tmp/7.zip` 的具体改进预期

如果按本方案执行，同类项目应出现以下变化：

1. 资产库会新增“鹦鹉螺号潜水艇本体”和“实体书/书封”之类核心物件资产。
2. P01、P07、P12 这类潜艇镜头会绑定同一个载具资产，而不是只绑定深海或舱室环境。
3. P10 书封镜头会走干净底图和后期文字合成，不再反复生成带 IP 或错字的封面。
4. P05 这类评审状态矛盾会被状态机拦截，不会出现低分 passed。
5. 分镜会减少“单张概念说明图”，增加动作承接、镜头推进和连续空间调度。
6. 无参考资产镜头会明确说明原因；如果原因是缺少核心资产，会先回填资产再生成图片。

## 9. P0-P4 开发执行计划

本开发计划以“快速建立结构，再逐步提高质量上限”为原则。允许必要的表结构变动，但避免一次性替换所有旧链路；旧字段继续兼容，新字段逐步成为主路径。

### 9.1 P0：数据库基础与状态修复

目标：让系统能稳定表达资产语义、分镜生成路由、参考计划和质量状态，先解决低分通过、无参考原因不明、书封/文字卡误走普通文生图等硬问题。

表结构计划：

- `NovelPromotionCharacter` / `GlobalCharacter` 增加：
  - `semanticType String?`
  - `assetTier String?`
  - `usageScope String?`
  - `assetMeta Json?`
- `NovelPromotionLocation` / `GlobalLocation` 增加：
  - `semanticType String?`
  - `assetTier String?`
  - `usageScope String?`
  - `assetMeta Json?`
- `NovelPromotionPanel` 增加：
  - `visualLicense String?`
  - `shotFunction String?`
  - `primarySubject String? @db.Text`
  - `continuityGroupId String?`
  - `generationRoute String?`
  - `noReferenceReason String?`
  - `promptSpec Json?`
  - `referencePlan Json?`
- 新增 `NovelPromotionAssetRelation`，表达 `part_of`、`not_equivalent`、`contains` 等资产关系。

代码任务：

- 统一视觉质量状态推导，禁止 `score` 很低但 `passed`。
- 自动修复后如果分数下降，不覆盖更优 active candidate。
- 导出日志增加 `generationRoute`、`noReferenceReason`、`promptSpec`、`referencePlan`。
- 现有字段兼容：旧数据没有新字段时按旧逻辑回退。

验收：

- P05 类 `score=9` 但 `passed` 不再出现。
- 无参考资产镜头能说明原因。
- 书封、文字卡、核心主体缺资产能被明确路由或标记。

### 9.2 P1：资产生成深改

目标：把资产库从“名词列表”升级为“可复用视觉设计系统”，解决核心主体漏提和类型错配。

代码任务：

- `asset-bible` 输出并解析 `semanticType`、`assetTier`、`usageScope`、`expectedUse`。
- 新增 `AssetCoverageAudit`：
  - 从 `visualUnits` / panels 抽取 `primarySubject`、`visibleAssets`、`imagePrompt` 主体。
  - 反查资产库，判断 `covered`、`missing`、`covered_by_wrong_type`、`one_off_allowed`。
  - 对 hero 主体缺失、类型错配、书封误路由给出阻断或修复建议。
- 新增 `missingAssetRequests`，为分镜规划发现的核心主体缺口生成补资产请求。
- 写入 `NovelPromotionAssetRelation` 或 artifact，先支持：
  - `part_of`
  - `contains`
  - `not_equivalent`
  - `visual_variant_of`
- 资产图生成按语义类型选择模板：
  - 角色：reference sheet
  - 载具：turnaround / 3/4 视图
  - 场景：environment plate
  - 书封：clean plate

涉及模块：

- `src/lib/assets/asset-bible.ts`
- `src/lib/assets/asset-bible-review.ts`
- `src/lib/assets/services/*`
- `src/lib/workers/handlers/visual-plan.ts`
- `src/lib/workers/handlers/asset-hub-image-task-handler.ts`

验收：

- 同类项目自动发现“鹦鹉螺号本体”是 hero vehicle。
- `鹦鹉螺号内部舱室` 不再被当成潜艇本体。
- 书封类资产默认进入 clean plate / composite 策略。
- 资产图评审能区分“好看”和“可作为参考图”。

### 9.3 P2：分镜规划深改

目标：导读分镜不再从口播段落直接跳到配图，而是先生成视听节拍，让每个镜头有动作、承接和信息推进。

代码任务：

- 新增 `VisualBeatPlan` 生成步骤。
- 每个 `VisualBeat` 输出：
  - `screenEvent`
  - `visualLicense`
  - `assetNeeds`
  - `continuityIn`
  - `continuityOut`
  - `recommendedShotCount`
- `visual_plan` 改为优先基于 `VisualBeatPlan` 生成 `visualUnits`。
- 分镜评审增加：
  - source alignment
  - active frame
  - PPT 化/说明图比例
  - 连续两个以上 text_card / illustrative 镜头提示
  - 资产支持缺失

涉及模块：

- `src/lib/visual-planning/*`
- `src/lib/workers/handlers/visual-plan.ts`
- `lib/prompts/novel-promotion/visual_plan*.txt`
- 新增 `lib/prompts/novel-promotion/visual_beat_plan*.txt`

验收：

- 分镜不只是“潜艇图/结构图/文字卡”。
- 每个镜头有可见动作瞬间和前后承接。
- 导读也能形成连续视频感。

### 9.4 P3：分镜图片生成深改

目标：分镜图片生成不再依赖一句 `imagePrompt`，而是由 `PanelPromptSpec`、参考图角色和生成路由共同驱动。

代码任务：

- 新增 `PanelPromptSpec` 编译器。
- `panel.imagePrompt` 保留为 UI 短描述，最终生成使用 compiled prompt。
- 新增 `PanelGenerationRouter`，支持：
  - `generate`
  - `composite`
  - `split`
  - `asset_backfill`
  - `human_required`
- 参考图升级为 role / usage / weight：
  - `primary_identity`
  - `environment`
  - `prop_detail`
  - `style_only`
  - `continuity_frame`
- 对书封、文字卡走 composite 或 clean plate。
- 核心主体镜头强制绑定 hero asset。

涉及模块：

- `src/lib/prompt-compiler/panel-image-prompt-compiler.ts`
- `src/lib/visual-production/binding-plan.ts`
- `src/lib/visual-production/references.ts`
- `src/lib/workers/handlers/*image-task-handler.ts`
- `src/lib/workers/handlers/visual-quality-review.ts`

验收：

- P01/P07/P12 使用同一个鹦鹉螺号本体参考。
- P10 不再普通文生图硬生成书封。
- prompt snapshot 能看到短描述、PromptSpec、compiled prompt、reference roles。

### 9.5 P4：连续性与视频联动

目标：让分镜图片成为视频关键帧，而不是孤立插图。

代码任务：

- 引入并持久化 `continuityGroupId`。
- 同组镜头共享：
  - 主体资产
  - 光色
  - 运动方向
  - 主体尺度
- 支持 previous confirmed frame 作为 `continuity_frame`。
- 视频 prompt 从 `PanelPromptSpec + motionPlan` 编译。
- 粗剪评审增加连续性专项。

涉及模块：

- `src/lib/prompt-compiler/panel-video-prompt-compiler.ts`
- `src/lib/creative-quality/rough-cut-review.ts`
- `src/lib/visual-readiness/*`
- `src/lib/workers/handlers/*video*`

验收：

- 同一主体跨镜头造型、方向、光色更稳定。
- 分镜图片和视频 prompt 不割裂。
- 成片不再像孤立图片切换。

### 9.6 推荐开发顺序

推荐实际开发顺序：

1. P0 表结构与状态修复。
2. P1 资产分级、关系、缺口审计。
3. P3 的 `PanelGenerationRouter` 最小版，先阻止明显错误生成。
4. P2 `VisualBeatPlan`，解决导读分镜呆板。
5. P3 完整 `PanelPromptSpec` 与 reference role/weight。
6. P4 连续性和视频联动。

最快可见收益来自 `P0 + P1 + PanelGenerationRouter 最小版`。这能先解决漏资产、错绑定、书封乱生成、低分通过这些硬问题，再逐步提高分镜和图片上限。

### 9.7 当前落地状态（2026-07-24）

本轮已按 P0-P4 做第一版工程落地，重点是让生成链路具备稳定的结构化生产合同，而不是只增加评测脚本。

已落地：

1. P0：新增资产语义、分镜路由、参考计划、PromptSpec、连续性字段；新增资产关系表迁移文件；低分 `passed` 会被统一降级；自动修复不会用更差结果覆盖已有更优候选。
2. P1：新增 `asset-semantics`、`asset-coverage-audit`；资产 Bible、小说分析、全局资产分析会写入 `semanticType / assetTier / usageScope / assetMeta`；资产图 prompt 会按角色、载具、场景、书封、符号等语义选择不同模板。
3. P2：新增确定性 `VisualBeatPlan` 前置层，并注入 `visual_plan` / `visual_plan_repair`；分镜持久化会写入 `visualLicense / shotFunction / primarySubject / continuityGroupId / referencePlan`。
4. P3：新增 `PanelGenerationRouter`；分镜图片生成会先产出 `generationRoute`，核心主体缺参考图时进入 `asset_backfill` 阻断，书封/文字类镜头进入 `composite`；`PanelPromptSpec` 会记录引用资产、参考计划、连续性、负向约束。
5. P4：视频 prompt 编译器开始读取分镜图片阶段的 `promptSpec / referencePlan / generationRoute / continuityGroupId`，避免图片和视频提示词割裂。
6. 诊断导出：新增 `visual.beat.plan`、`asset.coverage.audit`、`visual.generation.route` 三类 artifact 导出。

当前已验证：

- `npx prisma generate`
- `npm run typecheck`
- `npx vitest run tests/unit/assets/asset-semantics.test.ts tests/unit/assets/asset-coverage-audit.test.ts tests/unit/visual-production/panel-generation-router.test.ts tests/unit/visual-quality/review-parser.test.ts tests/unit/prompt-compiler/asset-prompt-compiler.test.ts tests/unit/prompt-compiler/panel-image-prompt-compiler.test.ts tests/unit/prompt-compiler/panel-video-prompt-compiler.test.ts`
- `npm run build`

本轮发现并修正的额外问题：

- `location` 资产描述中出现“仪表、钥匙、工具”等词时，不能优先被误判为 `tool`；现在 `location` 先判定 `interior_location / exterior_location`，避免内部空间语义污染后续绑定。
- `promptSpec / referencePlan / assetMeta` 写入 Prisma `Json` 字段前统一序列化成 `Prisma.InputJsonValue`，避免类型边界不清。

仍属于下一轮的部分：

- `previous confirmed frame` 作为 `continuity_frame` 的完整引用链路还未接入图片生成。
- `missingAssetRequests` 当前主要以 audit artifact 输出，自动创建/回填资产还需要下一轮接入 UI 与任务编排。
- 分镜评审中的“PPT 化/说明图比例、连续性专项”还需要进一步接入评分规则和 UI 展示。

### 9.8 分镜制作拆分闭环（2026-07-27）

本轮新增一个流程边界：`分镜制作` 不再作为一个同时承载镜头文本、台词节拍和图片生成的混合阶段，而拆成：

1. `分镜文稿`：只负责镜头规划、镜头描述、镜头动作、资产绑定和生成参数编辑；确认后物化 `storyboards/panels`，但不生成图片。
2. `台词与声音`：基于已确认镜头生成或编辑台词，绑定到具体镜头，配置音色，并重建 `panel_speech_plans`。
3. `分镜图片`：在台词计划就绪后生成、选择和确认分镜图片；如果镜头存在台词但镜头级计划缺失或异常，默认阻断，避免生成图片后才发现台词过长或无声音。

目标流程：

```text
成稿/剧本 -> 视觉资产 -> 分镜文稿 -> 台词与声音 -> 分镜图片 -> 视频制作 -> 成片检查
```

工程原则：

- 分镜文稿不调用图片生成任务，只保存和物化镜头合同。
- 台词计划是分镜图片前的节拍门禁，不再只在视频制作阶段兜底发现问题。
- 分镜图片阶段复用现有 panel image 候选、质检、修复和确认逻辑，不新增重复生成链路。
- 视频制作仍保留最终门禁，但不承担首次发现大问题的职责。

验收标准：

- 左侧流程导航可以区分 `分镜文稿` 与 `分镜图片`。
- `确认规划并生成分镜` 后跳到 `台词与声音`，而不是直接进入图片。
- `台词与声音` 就绪后进入 `分镜图片`。
- `分镜图片` 页面展示台词计划摘要；异常计划存在时禁止进入视频制作，并提示先回到台词阶段重建或调整。

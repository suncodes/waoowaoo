# 视频生成质量诊断与优化方案

- 状态：P0 + P1 + P2 已实现并完成聚焦回归；P3 待实施
- 适用项目：`waoowaoo`
- 更新时间：2026-07-17
- 方案范围：Creative Brief、内容类型分流、剧本与导演门禁、Animatic、图片自动质检与自修复、分镜到视频的提示词编译、跨镜头连续性、粗剪反馈、生成后质量诊断与局部重跑
- 当前代码范围：`VideoProfile`、内容规划与评审、视觉规划、分镜图片影子评审/自动修复、视频生成门禁；完整范围和未实现项见第 18 节
- 工作台 UI 重构：`standards/design/ai-creation-workspace-ui-redesign.md`

## 1. 决策摘要

当前视频效果问题不应先归结为“提示词不够长”或“模型不够好”。工程已经产生了分镜描述、摄影规则、表演指导、首帧图、首尾帧信息和模型能力参数，但这些信息没有在视频提交前经过一个统一、可审计的编译层。

本方案采用以下总原则：

1. 先建立可诊断的镜头契约，再优化具体措辞。
2. 先在现有字段上实现运行时编译，不立即重构数据库和全部上游 Agent。
3. 同一镜头必须根据 `T2V`、`I2V`、首尾帧、多参考图等模式生成不同提示词。
4. 场景级灯光和调色作为基线，单镜头只声明受控差异，避免每镜自由漂移。
5. 每次生成保存输入、模型、参数、引用、最终提示词和评分，问题只修改一个变量并局部重跑。
6. 开源项目和文章只作为结构启发，任何规则都必须在当前模型端点上通过 A/B 验证。
7. 图片质量采用“自动评估和有界自修复优先、人工异常兜底”，目标是减少人工逐张检查，而不是只增加审核步骤。
8. AI 漫剧、导读、广告、历史故事不能只作为四套提示词；应先解析为传播目标、内容领域和视觉形式，再选择内容规划器、分镜语法和质量标准。
9. 当前剧情流程作为合理 MVP 保留，按“全局决策串行锁定、镜头生产并行、全片装配复核、失败定向回退”补齐制作闭环。
10. 角色只在目标、上下文、产物、评价标准或回退位置不同时拆分，不为每个专业名称创建独立 Agent。

目标链路为：

```text
VideoProfile / CreativeBrief
    -> ContentPlan
    -> 剧本 / 旁白 -> Script Review / Fact Check
    -> DirectorTreatment / ProductionBible
    -> ShotPlan / Storyboard / Animatic
    -> 资产与首尾帧生成 -> 自动质检 -> 有界自修复 -> 必要时人工升级
    -> ShotSpec / Prompt Compiler -> 视频生成适配器
    -> Rough Cut -> 全片评审 -> 定向补镜
    -> 声音 / 音乐 / 调色 / 字幕 -> Final QC
```

## 2. 当前现状与根因判断

### 2.1 已有能力

当前工程已经具备以下上游信息：

- 剧本拆解和分镜规划。
- 镜头类型、景别、视角和运镜。
- 摄影规则，包括构图、灯光、色彩和技术说明。
- 表演指导和角色参考。
- 分镜首帧、普通图生视频和首尾帧模式。
- 视频模型能力校验，包括生成模式、时长、分辨率等字段。

分镜编排会把摄影规则和表演指导合并到分镜对象中，见 [`orchestrator.ts`](../../src/lib/novel-promotion/script-to-storyboard/orchestrator.ts)。图片生成上下文也会显式读取 `cameraMove`、`photographyRules` 和 `actingNotes`，见 [`panel-image-task-handler.ts`](../../src/lib/workers/handlers/panel-image-task-handler.ts)。

### 2.2 视频链路的关键缺口

视频 Worker 当前主要从以下字段中择一得到最终提示词：

1. 首尾帧自定义提示词。
2. 已保存的首尾帧提示词。
3. 普通自定义提示词。
4. `panel.videoPrompt`。
5. `panel.description`。

这段选择逻辑见 [`video.worker.ts`](../../src/lib/workers/video.worker.ts)。它没有在提交前统一合并以下信息：

- `photographyRules`。
- `actingNotes`。
- `cameraMove` 与景别。
- 当前镜头的起始状态和结束状态。
- 上一镜头的末帧状态与下一镜头的承接约束。
- 角色身份锚点、站位、朝向、视线和持物。
- 场景级灯光基线与项目级调色基线。
- `panel.duration` 对当前内容复杂度的影响。

模型能力校验解决的是“参数是否合法”，并没有解决“提示词应该如何按能力重写”。批量提交也会复用同一份请求体，因此不同镜头的内容复杂度、对白长度和动作数量不会自动得到不同的生成策略。

### 2.3 上游提示词的潜在副作用

当前上游规则中有三项需要在后续 A/B 中重点验证：

- 固定“每 15 个字符一个镜头”可能造成镜头过碎、节奏拖慢和成本上升。
- “每个视频必须动起来”可能为静态情绪镜头添加没有叙事意义的动作或运镜。
- 每个镜头独立生成灯光和色调，可能破坏同一场景的光位、色温和颜色连续性。

这些规则不是立即删除，而是改为可测量的实验变量。

## 3. 参考项目与文章的可复用结论

### 3.1 开源项目

| 项目 | 可复用思路 | 本项目的采用边界 |
| --- | --- | --- |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | 用阶段契约和五维镜头规格约束主体、动作、场景、空间构图、摄影机；先小样、锁 seed、再升级和延长 | 采用“镜头契约”和迭代顺序，不直接复制其长提示词和模型偏好 |
| [Pixelle-Video](https://github.com/ATH-MaaS/Pixelle-Video) | 显式管理 provider 能力、输入模态和时长范围，内容时长与旁白/音频关联 | 采用能力与时长的结构化管理，不采用其通用提示词作为标准答案 |
| [ai-fusion-video](https://github.com/Stonewuu/ai-fusion-video) | 生成前查询模型能力；区分 T2V、I2V、首尾帧和多参考图；支持 `promptOnly` | 作为 Prompt Compiler 的直接参考 |
| [moyin-creator](https://github.com/MemeCalculate/moyin-creator) | 按 Camera、Lighting、Subject、Mood、Setting/Audio、Style、Continuity 分层组装；项目级摄影档案提供默认值 | 采用分层组装和项目基线，不默认采用绝对时间码 |
| [Koma](https://github.com/M-JYuan/Koma) | 首帧是动作起手态；继承上一镜头人数、站位、朝向、视线、持物和光位；结尾稳定收势 | 采用连续性优先和稳定性优先，不照搬过长的硬约束文本 |
| [actionow](https://github.com/actionow-ai/actionow) | 设计、分镜、风格、生成职责分离；生成前检查资产、provider、参数和版本 | 采用 readiness check、资产血缘和版本记录 |
| [openOii](https://github.com/Xeron2000/openOii) | Critic 对一致性、质量、构图分项评分；ReviewAgent 将反馈路由到 plan、render、compose，并支持增量重跑 | 采用分项评分和问题路由，不把 VLM 评分当成唯一真值 |

### 3.2 VideoLens 文章

- [Seedance 提示词指南](https://videolens.cc/zh/blog/seedance-2-prompt-guide)：主体、动作、环境、光色、运镜、风格、画质、约束八要素；应同时描述空间关系和时间顺序；一镜尽量只保留一种主要运镜；优先低缓小动作。精确时间码需要按模型实测，不能跨模型默认复用。
- [电影灯光指南](https://videolens.cc/zh/blog/cinematic-lighting-guide)：适合整理为有限的灯光预设和场景级 Light Bible，而不是让每镜随机组合灯光关键词。
- [电影调色指南](https://videolens.cc/zh/blog/cinematic-color-grading-guide)：适合建立项目主 Grade 和少量叙事变体，避免连续镜头在“暖/冷/高饱和/低饱和”之间无约束切换。

## 4. 目标领域模型：ShotSpec

### 4.1 最小字段

第一阶段不要求马上新增数据库表，可以先在 Worker 内部从现有字段组装。稳定后再持久化以下结构：

```text
narrativeIntent       镜头叙事目的
subjectIdentity       角色身份锚点和不可变外观
startState            0 秒时的人数、站位、朝向、视线、持物、嘴部状态
actionBeats           1～3 个按顺序发生的动作
endState              末尾稳定状态和下一镜头交接信息
spatialContinuity     场景坐标、屏幕方向、前后镜头关系
camera                景别、角度、焦点、主要运镜和运动强度
sceneLightingBaseline 场景级光源方向、质感和色温
colorGrade            项目主调色及受控叙事偏移
dialogueAudio         台词、旁白、环境音和口型要求
constraints           禁止出现的内容和稳定性约束
durationIntent        内容所需时长及选择依据
```

### 4.2 字段责任边界

- `narrativeIntent` 由剧本和分镜规划负责。
- `subjectIdentity`、`startState`、`endState` 由角色资产、首帧和上下镜头关系负责。
- `actionBeats`、`camera` 由分镜和摄影指导负责。
- `sceneLightingBaseline`、`colorGrade` 由项目/场景摄影档案负责，单镜头只覆盖差异。
- `durationIntent` 由对白长度、动作数量、镜头目的和模型可用时长共同决定。
- `constraints` 由用户要求、模型限制和连续性检查共同产生。

这样可以避免一个自由文本字段同时承担剧情、摄影、风格、模型参数和跨镜头连续性的全部职责。

## 5. Prompt Compiler 设计

### 5.1 编译输入

```text
当前 ShotSpec
上一镜头末状态（可选）
下一镜头起始约束（可选）
项目风格、灯光和调色基线
模型能力
生成模式
时长、分辨率、比例、seed 等运行参数
参考图及其语义顺序
```

### 5.2 编译顺序

最终提示词按以下顺序组织，具体标签可按模型模板转换：

1. 镜头目的和景别。
2. 角色身份与不可变外观。
3. 起始状态。
4. 按顺序排列的 1～3 个动作节拍。
5. 结束状态和承接约束。
6. 场景、空间和环境变化。
7. 一种主要运镜及运动强度。
8. 场景灯光基线、调色和风格。
9. 对白、旁白和环境音。
10. 明确的禁止项。

### 5.3 按生成模式变化

| 模式 | 提示词重点 | 参考图策略 |
| --- | --- | --- |
| `T2V` | 完整描述静态画面、动作、环境和摄影 | 按模型能力决定是否附加参考图 |
| 普通 `I2V` | 只描述首帧之后发生的变化和运镜，避免重复静态内容 | 首帧承载静态身份和构图 |
| 首尾帧 | 明确从起始状态过渡到结束状态的动作、情绪和构图变化 | 首帧与尾帧具有明确语义，不再把它们当普通参考图 |
| 多参考图 | 说明每张图的用途和编号 | Prompt 中的图片编号必须与请求数组顺序一致 |

### 5.4 编译约束

- 一镜只设置一个主要运镜，其他运动降级为轻微辅助。
- 动作优先使用低幅度、可连续的动作；大幅位移必须有叙事依据。
- 首帧应是动作起手态，不是高潮帧或结果帧。
- 末尾保留稳定收势，不在本镜头末段提前完成下一镜头的大跳变。
- I2V 模式不重复描述首帧已经明确的静态内容。
- 角色、服装、持物和空间关系使用稳定的身份锚点，不依赖“同一个人”“继续上一镜”等模糊代词。
- 语言、时间码、镜头编号和引用格式由模型模板决定，不做全模型统一硬编码。

### 5.5 Prompt-only 与生成快照

在真正调用付费模型前，应支持只编译和预览提示词的 `promptOnly` 模式。每次实际生成至少保存：

- 原始 ShotSpec 或字段快照。
- 编译后的最终 Prompt。
- Provider、模型、生成模式和能力快照。
- 首帧、尾帧和参考资产标识及顺序。
- 时长、比例、分辨率、seed 和其他运行参数。
- 生成结果版本和重试次数。

## 6. 质量评估与问题归因

### 6.1 评分维度

生成后不使用一个笼统的“好/不好”，而是按维度记录：

1. 剧情命中。
2. 角色、服装和道具一致性。
3. 场景和空间连续性。
4. 动作完整性。
5. 运镜遵循度。
6. 灯光和调色连续性。
7. 人脸、手部和肢体稳定性。
8. 首尾帧衔接。
9. 技术质量，包括黑帧、闪烁、画面撕裂和音画问题。

VLM 评分用于排序、发现问题和自动修复路由。完成校准后，高置信度低风险结果可以自动通过；关键资产、低置信度结果和规则冲突仍升级人工。评分器不能在未校准的情况下直接替代剪辑判断和用户验收。

### 6.2 反馈路由

| 现象 | 优先检查 | 推荐动作 |
| --- | --- | --- |
| 剧情动作不对 | `narrativeIntent`、`actionBeats`、对白 | 重编译 Prompt，不先换模型 |
| 单镜头角色变脸/换装 | 首帧、身份锚点、参考图质量 | 重做首帧或减少参考图，必要时换模型 |
| 同场景光色漂移 | 场景 Light Bible、主 Grade | 调整场景基线，不给每镜继续加新灯光词 |
| 屏幕方向或站位跳变 | `startState`、`endState`、上下镜头关系 | 只重跑相邻镜头或首尾帧 |
| 动作太小或太乱 | 动作数量、动作幅度、时长 | 只调整动作预算或时长 |
| 运镜不遵循 | 运镜是否超过一种、模型能力 | 简化运镜，必要时切换支持更强的模型 |
| 单镜头正常、成片节奏差 | 镜头拆分、时长和剪辑顺序 | 回到分镜/编辑阶段，不继续堆视频 Prompt |
| 只有某模型失败 | Provider 能力、参数和输入协议 | 标记为模型适配问题，不污染通用 ShotSpec |

每次重跑只允许修改一个主要变量，避免无法判断收益来源。

## 7. 视频 Prompt Compiler 后续路线

本节是视频提示词编译能力的后续路线，不使用本轮代码实施的 P0/P1/P2 编号。当前唯一实施阶段口径见第 13 节。

### V1：运行时 Prompt Compiler

目标是在不改数据库的前提下验证核心假设。

建议代码边界：

- 新增纯函数编译模块，例如 `src/lib/video/prompt-compiler.ts`。
- 在 [`video.worker.ts`](../../src/lib/workers/video.worker.ts) 调用视频生成适配器之前编译最终 Prompt。
- 读取现有 `videoPrompt`、`description`、`cameraMove`、`photographyRules`、`actingNotes`、`duration` 及可获得的上下镜头信息。
- 根据模型能力选择 T2V、I2V、首尾帧和参考图模板。
- 增加 Prompt-only 预览和结构化日志。

V1 不做以下事情：

- 不立即重写所有上游提示词。
- 不立即新增复杂数据库表。
- 不立即更换视频模型。
- 不把所有开源项目的字段和规则全部搬入当前工程。

### V2：持久化 ShotSpec 与场景基线

当 V1 的 A/B 结果证明编译层有效后，再：

- 为分镜保存结构化 ShotSpec 或等价 JSON 版本。
- 增加项目/场景级灯光档案和主调色档案。
- 为动作数量、动作幅度和时长建立可校验规则。
- 保存 Prompt 模板版本，避免历史结果无法复现。
- 让单镜头重跑只更新当前镜头，不重新生成整集。

### V3：视频自动评审与实验血缘

- 抽取关键帧和必要的视频片段交给 VLM 评估。
- 按评分维度触发 `plan`、`render`、`compose` 等不同阶段的增量重跑。
- 保存 A/B 实验组、变量差异、成本、耗时和最终采用版本。
- 建立模型、提示词模板、参考资产和输出结果之间的血缘关系。

## 8. 最低成本验证实验

### 8.1 样本选择

选择 10 个代表性镜头，至少覆盖：

- 普通对话。
- 情绪特写。
- 单人动作。
- 多人空间关系。
- 首尾帧衔接。
- 有对白或旁白的镜头。
- 同一场景连续镜头。

### 8.2 对照组

- A 组：当前链路生成的 Prompt。
- B 组：Prompt Compiler 生成的 Prompt。
- 其他条件保持一致：模型、首帧、尾帧、参考资产、比例、分辨率、时长和运行参数。
- 模型支持 seed 时固定 seed；不支持时每组重复生成并记录波动。

### 8.3 评估方式

- 人工盲评：不展示 A/B 标签。
- VLM 分项评分：只作为辅助，不作为唯一结论。
- 每轮只修改一个变量，例如只改动作预算、只改连续性、只改灯光基线。
- 记录成本、耗时、失败率和重试次数。

### 8.4 通过条件

不预先假设某个模型或提示词一定更好，先观察：

- 剧情命中和角色一致性是否出现稳定提升。
- 动作和运镜提升是否伴随肢体稳定性下降。
- 灯光/调色连续性是否改善而没有压低镜头表现力。
- 编译 Prompt 是否能解释失败原因，而不是只改变随机结果。

只有当收益可重复、变量可归因时，才将规则推广到批量生成。

## 9. 后续问题收集格式

后续每个具体问题建议按以下格式提供，便于直接归类：

```text
问题现象：
期望结果：
实际结果：
涉及镜头编号：
生成模式：T2V / I2V / 首尾帧 / 多参考图
模型与参数：
首帧/尾帧/参考图情况：
是单镜头问题还是跨镜头问题：
是否可以提供原视频或抽帧：
```

问题进入方案后，先判断属于以下哪一层：

1. 分镜规划层。
2. 首帧/资产层。
3. Prompt Compiler 层。
4. 模型能力和参数层。
5. 跨镜头连续性层。
6. 剪辑和合成层。
7. 评估与重跑流程层。

## 10. 风险与非目标

- 不存在对所有视频模型都有效的统一提示词语法。
- 绝对时间码、九宫格参考图和超长约束文本必须通过端点实测后决定是否启用。
- VLM 评分可能误判，不能无条件自动覆盖人工选片。
- 参考图越多不一定越稳定，身份一致性优先于参考图数量。
- 本方案当前不包含视频合并导出、音频后期或 UI 播放入口改造。
- 本方案当前不要求更换模型，模型切换应作为实验变量而不是默认解决方案。

## 11. 已确认问题一：图片和首尾帧如何减少人工介入

### 11.1 当前已有的资产操作基础

当前工程并非完全没有人工调整能力，而是能力分散在不同资产和不同界面：

- 角色形象支持多张 `imageUrls`、`selectedIndex`、上一版图片和重新生成。
- 场景和道具共用 `LocationImage` 结构，支持多张候选、`isSelected` 和上一版图片；道具在数据层通过 `assetKind=prop` 区分。
- 分镜图片支持 `candidateImages`、候选选择、`imageHistory`、撤回、AI 修改和上传参考图。
- 资产合同已经区分 `canGenerate`、`canSelectRender`、`canRevertRender`、`canModifyRender` 和 `canUploadRender` 等能力。
- 首尾帧模式直接使用当前 panel 和下一 panel 的 `imageUrl` 作为首帧、尾帧来源，用户可以先修改对应图片再生成视频。

相关代码位置：

- [`prisma/schema.prisma`](../../prisma/schema.prisma) 中的 `CharacterAppearance`、`LocationImage` 和 `NovelPromotionPanel`。
- [`assets/contracts.ts`](../../src/lib/assets/contracts.ts) 中的资产能力和候选渲染摘要。
- [`ImageSection.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/ImageSection.tsx) 中的分镜候选图和撤回入口。
- [`FirstLastFramePanel.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/FirstLastFramePanel.tsx) 中的首尾帧选择和生成入口。

### 11.2 根因判断

用户提出的方向正确，而且比“增加人工审核门禁”更接近真正目标。目标不是证明人工仍然必要，而是把人工从“每张图片的固定检查者”改成“低置信度、关键异常和审美争议的处理者”。

当前工程已经具备实现该闭环的两类基础：

- 候选图、选择、重新生成、AI 修改、上传和撤回等资产操作已经存在。
- [`executeAiVisionStep`](../../src/lib/ai-runtime/client.ts) 和 [`chatCompletionWithVision`](../../src/lib/llm/vision.ts) 已经支持把图片交给多模态模型，且现有镜头变体分析和参考图描述提取已经在使用该能力。

真正缺少的是“评价目标、结构化问题、修复路由和循环控制”。不能直接简化成“VLM 看图 -> 重写整段提示词 -> 无限重生成”，原因如下：

1. VLM 如果只看到图片而看不到期望规格、参考图和镜头目的，不知道什么叫“正确”。
2. VLM 对手指、微小文字、复杂空间关系和细粒度身份一致性仍可能误判。
3. 每次重写整个提示词会丢失已经正确的角色、服装、构图和风格约束，造成修一个问题又引入新问题。
4. 有些问题应局部修图，有些应换候选，有些来自上游资产规格，全部重生成既贵又不可归因。
5. 不限制次数、成本和最低提升幅度，会形成无法收敛的自动循环。
6. 当前视觉调用并未统一校验“分析模型是否真正支持图片输入”；例如 [`vision.ts`](../../src/lib/llm/vision.ts) 中部分 provider 分支当前只传递文本，正式接入自动质检前必须增加能力检查或修正适配。

因此问题一应重新定义为“规格驱动的图片自动质检与有界自修复问题”，人工审核只是最后一级升级策略。

### 11.3 推荐的自动质检与修复状态机

所有会影响后续生成的视觉资产都应遵循同一闭环：

```text
GENERATED 生成 2～4 个候选
    |
    v
RULE_CHECK 尺寸、空图、重复、清晰度和格式检查
    |
    v
VLM_REVIEW 按资产规格、参考图和任务类型分项评价
    |                         \
    | 高分且高置信度            \ 可自动修复
    v                           v
AUTO_APPROVED              AUTO_REPAIR
    |                           |
    |                           v
    |                       REGENERATE / LOCAL_EDIT
    |                           |
    |                     最多 N 次且必须有提升
    |                           |
    |                           v
    |                     HUMAN_REQUIRED
    v
可被下游分镜 / 视频引用
```

人工不再默认查看所有结果，只处理以下情况：

- 评分接近阈值或多个评审结论冲突。
- 角色主形象、品牌核心道具、书封文字等高风险资产暂未达到自动通过条件。
- 自动修复达到最大次数、成本上限或连续两次没有明显提升。
- 问题涉及审美偏好、事实判断、版权或业务取舍，无法由客观规则决定。

### 11.4 自动评审的输入与输出

VLM 不能只接收当前图片。每次评审至少需要以下输入：

```text
assetType             character / prop / location / storyboard / first_frame / last_frame
expectedSpec          期望主体、外观、数量、动作、构图、环境和禁止项
referenceImages       角色、道具、风格或前后镜头参考图
sourcePrompt          本次实际生成提示词
lockedConstraints     已经正确且下一轮不允许漂移的约束
generationContext     模型、seed、比例、分辨率、候选编号和重试次数
currentImage          当前待评价图片
```

输出必须是可解析的结构化结果，而不是一段泛泛的自然语言建议：

```text
scores                语义命中、身份一致、解剖、结构、构图、风格、连续性、技术质量
issues[]              code、severity、confidence、evidence、repairTarget
decision              pass / select_other / local_edit / regenerate / revise_spec / human
promptPatch           只描述本轮需要新增、弱化或删除的约束
overallConfidence     对本次判断的置信度
```

不同资产使用不同评分重点：

- 角色：身份、年龄性别、五官、发型、服装、肢体和多视图一致性。
- 道具：形状、结构、材质、比例、可交互性、文字和标识。
- 场景：空间布局、透视、出入口、光位、时代属性和风格。
- 分镜图：剧情命中、出场对象、动作起手态、构图、景别和前后镜头连续性。
- 首尾帧：除单图质量外，还必须评价两帧之间的状态转移是否可生成。

### 11.5 修复路由与 Prompt Patch

自动评审发现问题后，应选择成本最低且最有针对性的修复方式：

| 问题类型 | 优先动作 |
| --- | --- |
| 已有候选中存在合格图 | 自动选择更高分候选，不重新生成 |
| 局部手部、文字、道具细节错误 | 局部编辑或局部重绘 |
| 主体缺失、数量错误、构图或动作不符 | 保留锁定约束后重新生成 |
| 角色或道具身份整体漂移 | 回到参考资产和身份锚点，不继续堆负面词 |
| 场景空间或镜头目的本身矛盾 | 修订 `expectedSpec` 或分镜，不在图片层死循环 |
| 低置信度、审美冲突或事实风险 | 升级人工 |

`promptPatch` 只修本轮问题，不重写整段 Prompt：

```text
preserve              必须保持的人物、服装、构图、风格和已正确细节
addConstraints        本轮需要补强的正向约束
removeOrWeaken        容易造成冲突或已经证伪的约束
negativeConstraints   本轮明确禁止的失败模式
editInstruction       局部修图指令；仅在适合局部编辑时输出
```

每一轮都要比较修复前后分项分数。默认最多自动修复 2 次；没有达到最低提升幅度时立即停止，不允许无限重试。

### 11.6 首尾帧的特殊规则

首尾帧不是两个普通图片候选的简单拼接，而是一个视频过渡契约：

- 首帧必须是动作起手态和稳定构图，不应是高潮或结果帧。
- 尾帧必须能作为下一镜头的承接状态。
- 首帧或尾帧任何一张未达到自动通过或人工确认条件，不提交首尾帧视频。
- 任一帧替换后，旧视频标记为过期，不允许继续作为最终结果使用。
- 评审必须同时输入两帧、对应 `startState`、`endState` 和动作节拍，不能把两张图分开独立打分后简单求平均。
- 成对评价身份、服装、光位、镜头轴线、主体位置、持物状态、动作可达性和尾帧承接关系。

### 11.7 如何证明人工参与真的减少

自动化是否有效不能只看 VLM 自评分，应使用一批经过人工标注的样本校准并持续记录：

- `autoPassPrecision`：自动通过的图片中，人工抽检真正合格的比例。
- `humanEscalationRate`：最终需要人工处理的比例。
- `autoRepairSuccessRate`：自动修复后达到合格标准的比例。
- `averageAttempts`：每个合格资产的平均生成和修复次数。
- `costPerApprovedAsset`：每个最终采用资产的模型成本。
- `falsePassRate`：错误结果被自动放行的比例，这是首要风险指标。

第一阶段以“影子评审”运行：VLM 给出结果但不自动放行，用真实人工结论校准阈值。达到目标精度后，先放开低风险资产和高置信度候选的自动通过，再逐步覆盖关键资产。

### 11.8 基于当前工程的最小落地

为控制改动范围，第一阶段可以复用现有候选、修改和历史能力，不立即建设完整资产管理后台：

1. 新增统一的 `ImageQualityReviewResult` Schema 和质量代码表。
2. 在角色、道具、场景和分镜图片生成完成后触发独立评审任务，复用 `executeAiVisionStep`。
3. 增加视觉模型能力校验，确保图片确实发送给支持视觉输入的 provider。
4. 先对现有候选自动排序，再接入 `promptPatch` 和现有 AI 修改/重新生成能力。
5. 保存原 Prompt、补丁、评审结果、模型、候选、重试次数和最终采用版本。
6. 资产被替换时，自动把依赖它的首尾帧和视频标记为 `STALE`。
7. UI 默认只展示自动处理后的最佳结果；只有升级人工时才展开问题证据、候选和修复历史。

## 12. 已确认问题二：专有视频场景与书籍导读适配

增加专有场景的方向正确，但“AI 漫剧、导读视频、广告、历史故事”不是同一层级的分类：

| 用户看到的标签 | 本质维度 | 说明 |
| --- | --- | --- |
| AI 漫剧 | 视觉形式 / 制作形式 | 同一个故事可以做成漫剧、电影感视频或纪录片形式 |
| 导读视频 | 传播目标 + 信息结构 | 核心是解释、概括或推荐一本书 |
| 广告 | 说服目标 | 核心是让目标受众理解价值并采取行动 |
| 历史故事 | 内容领域 | 可以做成叙事、知识讲解、漫剧或纪录片 |

因此不能用一个互斥的 `videoType` 枚举把四者平铺，否则很快会遇到“历史 AI 漫剧”“漫剧式书籍导读”“纪录片式品牌广告”等组合需求。

### 12.1 当前链路能做到什么

当前入口接受任意文本，若没有显式传入内容，还会回退使用 episode 的 `novelText`；故事转剧本流程会并行分析角色、场景、道具，切分片段，再把片段转换为 screenplay。相关实现见 [`story-to-script.ts`](../../src/lib/workers/handlers/story-to-script.ts) 和 [`story-to-script/orchestrator.ts`](../../src/lib/novel-promotion/story-to-script/orchestrator.ts)。

当前 screenplay 结构已经支持：

- 场景描述。
- 动作。
- 角色对话。
- `voiceover` 画外音/旁白。

因此，以下类型可以复用现有链路：

| 内容类型 | 当前适配度 | 判断 |
| --- | --- | --- |
| 小说剧情摘要、片段预告 | 较高 | 现有角色、场景、动作、对白和分镜链路基本匹配 |
| 小说类读书导读 | 中等 | 可以生成剧情介绍和旁白，但缺少明确的导读结构与防剧透控制 |
| 非虚构书籍、知识类导读 | 较低 | 当前流程会强行寻找角色、场景和动作，不适合观点、论据、方法和章节总结 |
| 书籍推荐/营销视频 | 中等偏低 | 缺少目标受众、卖点、证据、CTA 和版式规划字段 |

### 12.2 当前不完全适配的原因

现有提示词和数据模型明显偏向“影视短剧”：

- 故事扩写提示词要求完整的开头、发展、结尾、角色动机和自然对白，并限定为 1～2 分钟影视短片，见 [`ai_story_expand.zh.txt`](../../lib/prompts/novel-promotion/ai_story_expand.zh.txt)。
- 剧本转换提示词以场景、动作、对白和角色资产为中心，虽然支持 `voiceover`，但主要职责是忠实转换原文，见 [`screenplay_conversion.zh.txt`](../../lib/prompts/novel-promotion/screenplay_conversion.zh.txt)。
- 片段切分按动作、对话、情绪和场景元素计数，默认目标是后续拆成电影镜头，见 [`agent_clip.zh.txt`](../../lib/prompts/novel-promotion/agent_clip.zh.txt)。
- 分镜细化规则要求每个视频有动作和运镜，不适合每句话都是观点解释、书摘或图表的导读视频。

这会导致两个典型问题：

1. 把“观点、论据、案例”错误转换成虚构人物和场景。
2. 把一段应该由旁白、书封、章节卡和图表完成的内容，强行拆成大量人物动作镜头。

### 12.3 视频类型的本质：传播目标与信息结构

不同视频最上游的区别不是剧本格式或分镜模板，而是“希望观众发生什么变化，以及内容按什么逻辑组织”：

- 叙事型：让观众经历人物、冲突、变化和结果。
- 解释型：让观众理解概念、观点、因果、方法或一本书。
- 说服型：让观众相信某个价值主张并产生行动。

剧本和分镜都重要，但它们是这个上游选择的下游结果：

```text
传播目标 + 信息结构
    -> 输入 Brief
    -> 内容规划器
    -> 剧本 / 旁白 Schema
    -> 视觉单元与分镜语法
    -> 资产类型
    -> 节奏、声音和字幕策略
    -> 质量评价标准
```

只修改剧本 Prompt 会让后续分镜继续按影视短剧方式拆解；只修改分镜 Prompt 又无法修复上游内容结构错误。因此分流必须发生在内容规划之前。

### 12.4 推荐的 `VideoProfile` 模型

使用三个正交核心维度描述视频，再叠加受众和平台约束：

```text
contentGoal          narrative / explain / persuade
domain               fiction / book / history / product
visualFormat         ai_comic / cinematic / explainer / documentary / motion_graphics

audience             目标受众
platform             发布平台和画幅
durationTarget       目标时长
tone                 语气和叙述者风格
sourcePolicy         事实依据、引用范围和可追溯性要求
spoilerPolicy        剧透策略，可选
brandPolicy          品牌、产品和合规约束，可选
```

前端仍然可以提供用户易懂的场景预设，但预设只负责生成 `VideoProfile`：

| 场景预设 | `contentGoal` | `domain` | `visualFormat` |
| --- | --- | --- | --- |
| AI 漫剧 | `narrative` | `fiction` | `ai_comic` |
| 书籍导读 | `explain` | `book` | `explainer` 或 `cinematic` |
| 书籍推荐 | `persuade` | `book` | `explainer` 或 `motion_graphics` |
| 产品广告 | `persuade` | `product` | `cinematic` 或 `motion_graphics` |
| 历史故事 | `narrative` 或 `explain` | `history` | `documentary`、`cinematic` 或 `ai_comic` |

这样既能提供“专有场景”的使用体验，也不会为每个组合复制一整套代码和流程。

### 12.5 书籍导读的目标中间产物

书籍导读不应直接从原文跳到“影视剧本”，建议增加两个中间层：

#### A. 导读大纲 `GuideOutline`

```text
hook                开场问题或核心冲突
bookPositioning     这本书解决什么问题
keyPoints           2～4 个核心观点/情节节点
evidence            原文依据、案例或可引用片段
spoilerLevel        每个观点的剧透等级
takeaway            观众看完应记住什么
cta                 结尾行动
```

#### B. 旁白与视觉计划 `GuideSegment`

```text
segmentIndex        片段序号
narration           最终旁白文本
sourceAnchor        对应章节、页码或原文锚点
visualPurpose       该画面服务于哪个观点
visualType          书封、章节卡、角色/场景、插画、图表、引用卡、动态文字
assetRefs           使用的资产
onScreenText        屏幕文字
duration            旁白和画面时长
```

这样才能做到“先确定要讲什么，再决定画面怎么表达”，而不是让分镜 Agent 自己猜测导读目标。

### 12.6 导读视频的视觉策略

书籍导读不应要求每个旁白句子都有角色动作。可使用以下视觉类型组合：

- 书封和书名/作者信息。
- 章节标题卡和主题分段。
- 角色或场景插画，用于小说情节导读。
- 概念图、流程图、关系图，用于非虚构书籍。
- 经过审核的短引文卡，带章节或页码来源。
- 关键词、数字和结论的动态排版。
- 少量环境视频或抽象动效，作为旁白承载画面。

现有语音和 `voiceover` 能力可以复用，但分镜数据需要增加 `visualType`、`sourceAnchor` 和 `onScreenText` 等字段；否则下游仍会把导读内容误判为传统剧情镜头。

### 12.7 导读视频的内容质量门禁

导读内容应优先通过来源约束和自动检查减少人工，而不是让用户逐段重读：

1. 大纲中的每个观点必须带 `sourceAnchor`，没有来源的事实性结论不能自动通过。
2. 旁白生成后自动检查观点是否被原文支持、是否存在虚构引文、是否超过剧透策略。
3. 视觉计划自动检查每个画面是否服务当前观点，避免无关人物动作和纯装饰镜头。
4. 书封、引用卡和图表检查文字正确性、来源和版权策略。
5. 只有来源冲突、模型低置信度、关键引用和最终发布抽检需要人工确认。

### 12.8 不同 Profile 改变的是整条链路

| Profile | 内容规划 | 剧本/旁白 | 视觉语法 | 主要资产 | 核心评价标准 |
| --- | --- | --- | --- | --- | --- |
| AI 漫剧 | 钩子、冲突、升级、反转、悬念 | 动作、对白、内心旁白 | 表情、反应镜头、对话节奏、有限运镜 | 角色、服装、场景、关键道具 | 人物一致、叙事连贯、对白节奏、情绪命中 |
| 书籍导读 | 定位、核心观点、证据、收获 | 以旁白为主，引用可追溯 | 书封、章节卡、图表、插画、动态文字 | 书封、引用、概念图、少量场景插画 | 内容准确、来源可信、清晰度、剧透控制 |
| 广告 | 受众痛点、价值、证据、演示、CTA | 卖点文案、演示说明、品牌语言 | 产品特写、使用场景、对比、品牌收束 | 产品、Logo、包装、品牌色和人物场景 | 卖点命中、产品真实性、品牌一致、合规和转化意图 |
| 历史故事 | 时间线、人物、因果、证据、影响 | 叙事旁白、史料引用、必要对白 | 地图、时间轴、史料、时代还原、人物场景 | 历史人物、服饰、建筑、地图、文献 | 史实准确、时代一致、因果清晰、来源可信 |

推荐的运行时结构是：

```text
场景预设
    -> ProfileResolver
    -> ContentPlanner（按目标和领域）
    -> VisualPlanner（按视觉形式）
    -> 通用资产生成 / Prompt Compiler / 模型适配 / TTS / 合成
    -> ProfileQualityRubric（按 Profile 评分）
```

共用能力继续复用，只替换真正不同的策略。第一阶段只实现当前最需要的 `fiction + narrative` 和 `book + explain`，广告与历史沿用同一扩展点后续接入，避免一次性建设过多模式。

## 13. 最终实施阶段口径

为避免功能清单与阶段编号混用，代码实施统一采用以下口径。P0、P1、P2 已落地；P3 是下一阶段，不属于本轮完成范围。

### 13.1 P0：基础契约、持久化与任务骨架

1. 定义可复用的 `VideoProfile`、`CreativeBrief`、`ContentPlan`、`DirectorTreatment`、`ProductionBible`、`ShotSpec`、`ImageQualityReviewResult` 和 `VisualQualityState`。
2. 首批支持 `ai_comic` 与 `book_guide` 两个预设，以及 `shadow`、`auto` 两种图片质量策略。
3. 增加 Prisma JSON 字段和迁移，保存项目 Profile、内容规划、视觉规划和 Panel 质量状态。
4. 建立四类独立任务、API、队列、计费、可观测性和 Artifact 记录边界。
5. 使用 `versionHash` 绑定目标规格与候选版本，旧评审不得覆盖新候选。

### 13.2 P1：内容规划与专有场景分流

1. 在原有剧情流程前增加 `CONTENT_PLAN_RUN`，先生成 Creative Brief 和剧情/导读 ContentPlan，再由独立内容评审门禁检查结构、时长、来源和剧透策略。
2. 内容评审阻断时保存 Brief、Plan、Review 和 Artifact，但不覆盖现有导读 clips。
3. `book_guide` 使用 `GuideOutline`、`GuideSegment`、来源锚点、视觉目的和旁白结构，不再强行转换成传统人物剧情剧本。
4. 增加 `VISUAL_PLAN_RUN` 生成 `DirectorTreatment`、`ProductionBible`、全片计划和 `ShotSpec`。
5. 导读路径直接持久化 storyboard、panel 和旁白匹配；剧情路径保留现有 story-to-script 与 script-to-storyboard，并把视觉规划作为全片约束前置。

### 13.3 P2：分镜图片自动质检与有界修复

1. Panel 图片生成完成后自动运行可读性、尺寸、比例、重复候选等确定性检查，再调用支持图片输入的 VLM 做规格评审。
2. 自动模式按评分和置信度选择候选；未通过时生成结构化 Prompt Patch，在编辑或重生成之间路由，最多自动修复 2 次。
3. 影子模式只记录评审结果，不阻断现有流程；自动模式只有 `approved` 可以进入视频生成，异常转为 `human_required`。
4. 用户手动选择候选图视为人工批准，更新质量状态并解除视频门禁。
5. 单镜头、首尾帧和批量视频提交同时在前端和服务端检查 visual readiness，避免绕过 UI。
6. 分镜卡和视频卡显示统一质量状态徽标。

### 13.4 P3：全片制作闭环，待实施

1. 分镜到视频的 Prompt Compiler、模型模板和 prompt-only 预览。
2. Storyboard + 临时 TTS 的 Animatic 及高成本生成前门禁。
3. 首尾帧成对 VLM 评审、视频抽帧/片段评审和跨镜头连续性自动检查。
4. Rough Cut 全片评审、Pickup List、定向补镜和 Final QC。
5. 真实样本校准、指标看板、A/B 实验与逐类资产放量。

### 13.5 不建议的处理方式

- 只把候选数量从 1 提高到 4，然后让用户无限挑选。
- 只增加人工审核状态，却不增加自动评价和修复能力。
- 让 VLM 只看当前图片，不提供目标规格、参考图和锁定约束。
- 每轮让模型重写全部提示词，或不设成本和次数上限地循环重生成。
- 让用户每次都从一段自由文本重新描述“哪里不合理”。
- 把非虚构导读强行转换成拥有角色和场景的传统剧本。
- 为 AI 漫剧、导读、广告和历史故事分别复制四套端到端流程。
- 只在 UI 或最终 Prompt 中增加场景标签，而不更换内容规划和视觉语法。
- 在未确认首尾帧的情况下先生成视频，再用视频结果反推图片问题。
- 继续强化“每个镜头都必须运动”的单一规则。

## 14. 实现架构与功能拆分

### 14.1 总体实现决策

实现不应把所有能力继续堆进现有剧本和图片 Worker，而应拆成两条可以独立上线、独立评估、最终通过稳定数据契约汇合的主线：

```text
主线 A：VideoProfile -> 内容规划 -> 剧本/旁白 -> 视觉规划
主线 B：图片候选 -> 自动评审 -> 自动修复 -> 正式采用
```

两条主线在 `ShotSpec`、资产规格和 `ProductionBible` 处汇合：

- 主线 A 决定“生成什么、为什么这样表达、哪些内容必须锁定”。
- 主线 B 决定“生成结果是否满足规格、应该怎样定向修复、是否需要人工处理”。
- 现有图片、视频、TTS、口型、存储、任务和计费能力继续作为基础设施复用。
- 现有剧情 `story-to-script` 和 `script-to-storyboard` orchestrator 作为兼容适配器保留，不进行一次性重写。

核心原则是把领域决策从 Prisma、BullMQ、具体 provider 和 UI 状态中抽离。领域模块只接收结构化输入并返回结构化结果，任务编排和持久化由外层适配器负责。

### 14.2 推荐模块边界

建议新增以下目录。目录名表达职责，不要求第一阶段一次性创建全部实现：

```text
src/lib/video-profile/
src/lib/content-planning/
src/lib/visual-planning/
src/lib/visual-quality/
src/lib/quality-workflow/
src/lib/visual-readiness/
```

| 模块 | 单一职责 | 主要输入 | 主要输出 | 不应依赖 |
| --- | --- | --- | --- | --- |
| `video-profile` | 解析场景预设、校验 Profile、生成内容与质量策略键 | 用户选择、平台、时长、受众 | `VideoProfile`、策略键 | Prisma、队列、模型 provider |
| `content-planning` | 按传播目标和内容领域建立信息结构 | Profile、原文、来源策略 | `CreativeBrief`、`ContentPlan`、`GuideOutline` 或剧情规划 | 图片/视频模型、UI |
| `visual-planning` | 把已锁定内容转换成导演阐述、视觉单元和镜头规格 | 内容计划、剧本/旁白、资产摘要 | `DirectorTreatment`、`ProductionBible`、`ShotPlan`、`ShotSpec` | 具体生成 provider |
| `visual-quality` | 定义图片目标规格、评分、问题代码、修复决策 | 目标规格、参考图、候选图、风险策略 | `ImageQualityReviewResult`、`RepairDecision`、`PromptPatch` | Prisma、BullMQ、UI |
| `quality-workflow` | 编排生成、评审、修复、重试、成本上限和人工升级 | 质量策略、领域服务端口、版本信息 | 质量 Run 状态、最终采用候选、异常任务 | 具体业务页面 |
| `visual-readiness` | 根据最新产物和版本判断下游能否继续 | 业务资产、质量 Artifact、依赖版本 | 阶段门禁结果、阻塞原因 | React、provider |

`Prompt Compiler` 属于 `visual-planning` 的下游能力，负责把 `ShotSpec + ProductionBible + 模型能力` 编译为模型输入。它不负责判断内容方向，也不负责评价生成图片。

### 14.3 最小可复用接口

模块复用的关键不是把所有功能抽象成通用框架，而是稳定少量输入输出接口：

```ts
interface ProfileResolver {
  resolve(input: ProfilePresetInput): VideoProfile
}

interface ContentPlanner {
  supports(profile: VideoProfile): boolean
  plan(input: ContentPlanningInput): Promise<ContentPlanResult>
}

interface VisualPlanner {
  plan(input: VisualPlanningInput): Promise<VisualPlanResult>
}

interface VisualQualityReviewer {
  review(input: VisualQualityReviewInput): Promise<ImageQualityReviewResult>
}

interface VisualRepairPlanner {
  decide(input: RepairPlanningInput): RepairDecision
}
```

具体 LLM/VLM 调用通过外层端口注入，例如 `TextGenerationPort`、`VisionReviewPort`、`ImageGenerationPort` 和 `ArtifactRepository`。这样可以做到：

- 更换模型时不修改 Profile、评分和修复状态机。
- 在单元测试中使用固定响应验证路由和阈值。
- 书籍导读与剧情改编复用相同的视觉质量闭环。
- 未来增加广告或历史 Profile 时，只增加规划策略和评分规则，不复制端到端流程。

不建议第一阶段建设通用 Agent 框架、微服务或动态插件系统。当前需要的是明确契约和薄适配层，而不是更大的运行时抽象。

### 14.4 新增任务与编排边界

建议新增四类任务：

| 任务 | 队列 | 职责 | 计费类型 |
| --- | --- | --- | --- |
| `CONTENT_PLAN_RUN` | `text` | 生成内容 Brief、内容计划、导读大纲或剧情规划 | LLM 文本 |
| `VISUAL_PLAN_RUN` | `text` | 生成导演阐述、Production Bible、视觉单元和 ShotSpec | LLM 文本 |
| `VISUAL_QUALITY_REVIEW` | `text` | 使用视觉理解模型评审一个版本的候选图片 | 多模态 LLM/VLM |
| `VISUAL_AUTO_REPAIR` | `image` | 根据结构化修复决策执行局部编辑或重生成 | 图片 |

评审和修复必须是不同 Task。原因不是代码风格，而是两者具有不同模型、队列、失败策略和计费单位；若合并到现有 Image Task 中，无法准确冻结和结算成本，也无法独立重试评审。

推荐的单资产质量 Run：

```text
prepare_target_spec
    -> generate_candidates
    -> rule_check
    -> visual_review
    -> select_best_candidate
       -> auto_approve -> commit_asset
       -> repair_plan -> repair_1 -> review_1
                              -> repair_2 -> review_2
                              -> commit_asset / human_required
```

编排时需要满足以下约束：

1. 每个资产或镜头使用独立 `qualityRunId`，不要让多个质量子任务直接共享当前自动创建的任务 `runId`。否则某个子任务完成时可能提前把整个质量流程标记为完成。
2. `VISUAL_QUALITY_REVIEW` 只产生评价 Artifact，不直接改正式资产。
3. `VISUAL_AUTO_REPAIR` 只执行已批准的 `RepairDecision`，不重新自由分析问题。
4. 每轮修复都带 `attempt`、预算和最大次数，默认最多 2 轮。
5. 正式自动模式延迟写入 `imageUrl`，只有候选通过后才提交；影子评审阶段可维持当前先写首张图的行为，避免改变用户流程。
6. 使用候选内容、目标规格、参考图和 Prompt 共同计算 `versionHash`。评审结果仅对相同版本有效，版本变化后自动视为过期。

### 14.5 数据持久化策略

稳定业务意图与运行过程应分开保存。

建议新增的稳定业务字段：

```text
NovelPromotionProject.videoProfile        Json?

NovelPromotionEpisode.contentBrief        Json?
NovelPromotionEpisode.contentPlan         Json?

NovelPromotionPanel.visualType             String?
NovelPromotionPanel.renderMode             String?
NovelPromotionPanel.onScreenText           String?
NovelPromotionPanel.sourceAnchor           Json?
```

字段含义：

- `videoProfile` 是项目级传播目标、领域、视觉形式和平台约束。
- `contentBrief` 保存一次制作的目标、受众、时长和内容边界。
- `contentPlan` 保存已锁定的信息结构；剧情和导读可以使用不同 Schema。
- Panel 字段允许下游区分角色动作镜头、书封、引用卡、图表、动态文字和环境承载镜头。

以下运行数据优先复用 `GraphRun`、`GraphStepAttempt` 和 `GraphArtifact`，第一阶段不新增专用质量表：

- `DirectorTreatment`、`ProductionBible`、`ShotPlan` 的版本。
- 候选生成输入、模型、Prompt 和参考图摘要。
- VLM 评分、问题代码、证据、置信度和 `versionHash`。
- 每轮 `PromptPatch`、修复方式、成本和最终采用结果。
- Animatic、粗剪评审和补镜清单。

只有当查询量、保留周期或报表需求证明通用 Artifact 不够时，再将稳定结构提升为专用表，避免过早扩展 Prisma 模型。

不建议在 Panel 上同时维护多个可互相冲突的 `qualityStatus`、`reviewStatus` 和 `repairStatus`。`visual-readiness` 应从“当前资产版本 + 最新有效 Artifact”计算门禁状态，避免形成多个事实源。

视觉模型能力也需要显式进入模型能力契约，例如：

```ts
interface LLMCapabilities {
  reasoningEffortOptions?: string[]
  visionInput?: boolean
  fieldI18n?: CapabilityFieldI18nMap
}
```

提交视觉评审任务前必须校验 `visionInput`，不能仅凭 provider 名称猜测是否支持图片输入。

### 14.6 需要实现的具体功能

#### A. 内容规划主线

1. 场景预设与 `VideoProfile` 解析。
2. `CreativeBrief` 编辑、校验和版本化。
3. `ContentPlanner` 路由，第一阶段支持 `fiction + narrative` 与 `book + explain`。
4. 书籍导读的 `GuideOutline`、`GuideSegment`、来源锚点和剧透策略。
5. 剧本/旁白质量门禁，包括结构、时长、重复、事实支持和 Profile 匹配度。
6. `DirectorTreatment` 和 `ProductionBible`，统一全片视听方向、资产锁定项和连续性规则。
7. 从内容单元到 `ShotSpec` 的视觉计划，兼容现有 storyboard orchestrator。

#### B. 图片质量主线

1. 从角色、场景、道具或镜头数据建立 `ImageTargetSpec`。
2. 分辨率、比例、空图、重复图等确定性规则检查。
3. VLM 规格评审，而不是无目标地询问“图片好不好”。
4. 多候选排序和高置信度自动采用。
5. 结构化 `PromptPatch`，只修改失败维度并锁定正确内容。
6. 在“选已有候选、局部编辑、重生成、人工升级”之间进行修复路由。
7. 首尾帧成对连续性检查，包括人物、服装、道具、空间、构图和动作可达性。
8. 有界重试、成本预算、版本失效和完整生成血缘。
9. 影子评审、人工抽检、异常处理和指标统计。

#### C. 制作流程补全功能

1. 全片级镜头计划和跨 clip 连续性检查。
2. 使用静态分镜、临时 TTS 和预计时长生成低成本 Animatic。
3. Animatic 门禁通过后再批量进入高成本图片和视频生成。
4. 单镜头候选审片和自动修复，等价于数字制作中的 dailies。
5. 粗剪后的节奏、信息密度、重复镜头和声音覆盖评审。
6. 生成定向补镜清单，只回退到相关内容、资产或镜头，不整批重跑。
7. 声音、音乐、字幕、统一调色和最终交付 QC。

### 14.7 实现后的端到端流程

通用主流程：

```text
用户输入 + 场景预设
    -> VideoProfile / CreativeBrief
    -> ContentPlanner
    -> Scriptwriter / Narration Writer
    -> Script Editor / Fact Checker 门禁
    -> DirectorTreatment + ProductionBible
    -> 资产需求计划 + 全片 ShotPlan
    -> Storyboard + Animatic
    -> Animatic 门禁
    -> 关键资产和镜头批量生成
    -> 图片/首尾帧/视频质量闭环
    -> Rough Cut
    -> 全片评审 + 定向补镜
    -> Fine Cut + 声音 + 音乐 + 调色 + 字幕
    -> Final QC + 导出
```

剧情改编路径：

```text
fiction + narrative
    -> 剧情 ContentPlan
    -> 现有 story-to-script orchestrator 兼容适配
    -> 剧本编辑门禁
    -> Treatment / ProductionBible
    -> 现有 script-to-storyboard orchestrator 兼容适配
    -> 全片连续性校正和 Animatic
```

书籍导读路径：

```text
book + explain
    -> 来源整理和 GuideOutline
    -> GuideSegment（旁白 + sourceAnchor + visualPurpose）
    -> 内容准确性与剧透门禁
    -> VisualPlanner 生成书封/引用卡/图表/插画/动态文字等视觉单元
    -> ShotSpec / Animatic
```

两条路径从 `ShotSpec` 以后复用同一套资产生成、图片质量、视频生成、配音、合成和交付能力。

### 14.8 兼容、测试与上线策略

兼容策略：

- 未设置 `VideoProfile` 的旧项目默认解析为 `narrative + fiction + ai_comic/cinematic`，继续走现有流程。
- 新模块通过适配器读取现有角色、场景、道具、clip 和 panel 数据，不要求立即迁移所有历史记录。
- 第一阶段的质量评审只写 Artifact 和指标，不改变正式图片选择。
- 自动采用功能按资产类型和风险等级逐步开放，不使用全局开关一次性放量。

测试重点：

1. Profile 解析、策略路由和 Schema 校验的纯单元测试。
2. 书籍导读来源锚点、事实支持和剧透规则测试。
3. 图片问题代码到修复方式的决策表测试。
4. `versionHash` 变化后旧评审失效的测试。
5. 生成、评审、修复分别失败时的任务重试和计费测试。
6. 同一资产并发修复时只允许一个版本提交的幂等性测试。
7. 旧剧情项目不设置 Profile 时的回归测试。

上线是否有效应由以下指标判断：

- 自动通过准确率，而不是单纯自动通过率。
- 人工升级率和人工平均处理时长。
- 自动修复成功率与每次成功修复成本。
- 最终采用率、重生成次数和端到端完成时长。
- 剧本门禁一次通过率、Animatic 后补镜率和粗剪后大范围返工率。
- 不同 Profile 下的内容准确性、叙事连贯性和观众目标命中率。

## 15. 对照真实视频制作流程的评估

### 15.1 总体判断

当前流程是一个合理的“剧情文本到单镜头视频”MVP，主骨架没有走错，但还不能视为完整、稳定的视频制作流程。

它已经覆盖故事理解、剧本转换、分镜规划、摄影规则、表演指导、资产生成、单镜头视频、配音、口型和合并等环节。问题主要不在于缺少更多生成模型，而在于以下三个制作层级没有闭环：

1. **全片级决策不足**：缺少 Creative Brief、导演阐述、统一节奏和跨 clip 连续性统筹。
2. **进入高成本生成过早**：没有 Animatic 等低成本预演门禁，内容和节奏问题容易在图片或视频阶段才暴露。
3. **后期反馈不能定向回流**：候选审片、粗剪评审和补镜清单不完整，失败后主要依赖人工判断应该重跑哪一步。

因此，正确方向是保留当前剧情生产骨架，在它前面补“策划和全片设计”，在中间补“预演和质量门禁”，在后面补“剪辑反馈和最终 QC”。

### 15.2 与常见真实制作阶段的映射

| 真实制作阶段 | 当前能力 | 判断 | 主要缺口 |
| --- | --- | --- | --- |
| 项目定义 / Creative Brief | 用户输入故事、部分风格和模型设置 | 缺失 | 目标受众、平台、时长、传播目的、内容边界没有成为结构化上游约束 |
| 调研与内容策划 | 能分析小说角色、场景和道具 | 剧情部分具备 | 非虚构来源、核心观点、事实依据、剧透和合规策略不足 |
| 剧本创作 | clip 切分后并行转换 screenplay | 基本具备 | 缺少全片结构编辑、时长校准、重复检查和独立剧本编辑门禁 |
| 导演阐述 / Production Bible | 有艺术风格、摄影规则和表演指导 | 部分具备 | 缺少全片统一的节奏、镜头语言、光色、声音、连续性和禁用项 |
| 资产规划与 Look Development | 有角色、场景、道具库和参考图 | 基本具备 | 资产分析发生较早；需求、造型和最终内容未完全锁定，且缺少自动质量闭环 |
| Shot List / Storyboard | 分镜规划、摄影规则、表演指导和细化 | 当前较强 | 以 clip 为单位并行，缺少全片镜头配额、转场、节奏和跨 clip 连续性检查 |
| Animatic / Previsualization | 无正式阶段 | 缺失 | 未在昂贵生成前验证时长、旁白覆盖、信息密度和镜头节奏 |
| 镜头生产 | 单镜头图片、首尾帧视频和普通图生视频 | 具备 | 生成器缺少基于规格的自动审片、自动修复和候选提交门禁 |
| Dailies / 候选审片 | 支持多候选和人工选择 | 部分具备 | 没有独立 Critic、质量证据、问题归因和定向修复闭环 |
| Rough Cut / Fine Cut | 有视频合并和编辑基础 | 部分具备 | 缺少全片级节奏评审、补镜列表和从时间线回流到镜头任务的机制 |
| 声音与交付 | 有配音、口型和合并能力 | 部分具备 | 声音设计、音乐策略、响度、统一调色、字幕检查和最终技术 QC 不完整 |

### 15.3 当前流程中应该保留的部分

以下结构是合理的，不建议为了“模拟真实剧组”而重写：

- 将故事到剧本、剧本到分镜、资产、图片、视频和声音分成不同阶段。
- 角色、场景、道具分析并行，以及镜头级生成并行。
- 摄影规则与表演指导分别处理，再合并回分镜。
- 使用任务队列、失败重试、阶段产物和局部重跑承载长流程。
- 使用参考图和资产库增强人物、场景和道具一致性。

真正需要调整的是并行发生的位置：

```text
全局决策：串行锁定
镜头级生产：并行执行
全片装配与评审：再次串行汇总
失败修复：按依赖定向回退
```

当前按 clip 并行生成剧本和分镜能够提高速度，但在并行前应先锁定全片内容计划和导演策略，在并行后应增加一次跨 clip 汇总审查。否则每个片段局部合理，组合后仍可能节奏重复、信息断裂、人物状态跳变或镜头语言不统一。

### 15.4 是否需要继续拆步骤

需要拆，但应优先拆“决策目标和产物不同”的步骤，而不是把每一个 Prompt 都包装成新阶段。

必须新增或显式化的步骤：

1. `CreativeBrief / VideoProfile`：在所有内容生成之前确定目标。
2. `ContentPlan`：先锁定信息结构，再生成剧本或旁白。
3. `Script Review`：由独立评价标准检查内容，而不是让作者自评。
4. `DirectorTreatment / ProductionBible`：把全片视听规则前置并锁定。
5. `Global ShotPlan / Continuity Review`：补足 clip 之间的镜头统筹。
6. `Animatic`：在高成本图片和视频生成前验证时长与节奏。
7. `Dailies Review`：每批候选生成后自动评审和定向修复。
8. `Rough Cut Review`：从全片时间线生成补镜和修改清单。
9. `Final QC`：统一检查内容、声音、字幕、色彩和技术交付要求。

不需要为了形式单独拆出的步骤：

- 不需要为每一种视频类型复制完整工作流。
- 不需要为每一个评分维度启动一个 Agent。
- 不需要把摄影、灯光、色彩全部变成互相独立的自由生成角色；它们应共同受 `DirectorTreatment` 约束。
- 不需要在第一阶段引入完整非线编、专业调色台或重型视觉检测服务。

## 16. 推荐的目标流程、角色和质量门禁

### 16.1 推荐目标流程

推荐将系统组织为八个制作阶段：

| 阶段 | 核心产物 | 主责任角色 | 质量门禁 |
| --- | --- | --- | --- |
| 1. 项目定义 | `VideoProfile`、`CreativeBrief` | Producer / Brief Planner | 目标、受众、平台、时长和边界完整 |
| 2. 内容规划 | `ContentPlan`、来源账本、`GuideOutline` | Content Planner / Researcher | 信息结构合理，事实和引用有来源 |
| 3. 剧本与编辑 | screenplay、旁白稿、`GuideSegment` | Scriptwriter + Script Editor / Fact Checker | 结构、时长、准确性、剧透和 Profile 匹配通过 |
| 4. 导演与美术统筹 | `DirectorTreatment`、`ProductionBible`、资产需求 | Director + Production Designer | 全片风格、节奏、连续性和锁定项明确 |
| 5. 分镜与预演 | `ShotPlan`、`ShotSpec`、Storyboard、Animatic | Storyboard Director + Continuity Supervisor | 时长、转场、镜头配额、连续性和预算通过 |
| 6. 资产与镜头生产 | 角色/场景/道具、首尾帧、镜头视频 | Generation Supervisor | 自动质量评审通过，异常已升级或修复 |
| 7. 剪辑与补镜 | Rough Cut、Fine Cut、Pickup List | Editor | 全片节奏、信息密度、重复和情绪曲线通过 |
| 8. 后期与交付 | 声音、音乐、调色、字幕、母版 | Post Supervisor | 内容、响度、字幕、色彩、规格和合规 QC 通过 |

其中资产规划与资产生成需要分开：剧本锁定后先确定资产需求和关键 Look，Animatic 通过后再批量生成高成本资产与镜头。这样既能让分镜有稳定视觉参照，也能避免内容未定时提前生成大量无用资产。

### 16.2 推荐角色边界

这里的“角色”首先是职责、输入输出 Schema 和评价标准，不等于必须使用不同模型，也不等于每个角色都要作为长期自治 Agent 运行。

| 角色边界 | 是否建议独立 | 原因 | 最小实现方式 |
| --- | --- | --- | --- |
| Producer / Brief Planner 与 Content Planner | 产物分开，初期可同一服务 | 前者定义目标，后者设计内容结构 | 两个 Schema、两次校验，可共享一次模型会话 |
| Scriptwriter 与 Script Editor | 建议独立 | 创作与挑错目标冲突，作者自评容易保留原有偏差 | 生成调用后增加独立评审/修订调用 |
| Fact Checker | 按 Profile 启用 | 书籍、历史和广告需要，纯虚构可弱化 | 基于 `sourceAnchor` 的规则与 LLM 校验 |
| Director 与 Storyboard Director | 建议独立阶段 | 导演负责全片策略，分镜负责镜头级执行 | 先生成 Treatment，再让分镜严格引用它 |
| Production Designer | 初期可并入 Director | 两者都参与视觉世界和资产锁定，MVP 无需独立 Agent | 独立 `ProductionBible` 产物即可 |
| Continuity Supervisor | 建议独立检查 | 需要跨 clip、跨镜头比较，局部分镜生成器看不到全局问题 | 分镜完成后的全片规则/VLM 检查 |
| Generator 与 Quality Critic | 必须独立职责 | 生成器倾向证明结果合理，Critic 需要按规格找错和给证据 | 不同 Prompt、不同 Task、共享结构化规格 |
| Editor 与镜头生成器 | 建议独立阶段 | 编辑从时间线判断节奏和缺镜，单镜头生成器没有全片上下文 | Animatic/Rough Cut 分析后输出 Pickup List |
| Sound Designer、Colorist、Post Supervisor | 初期可合并 | 第一阶段重点是闭合流程，不必模拟完整后期团队 | 一个后期计划和一个 Final QC 阶段 |

### 16.3 角色拆分的判定规则

只有满足以下任一条件时，才值得拆成独立步骤或角色：

1. 决策目标不同，例如“创造内容”和“发现问题”。
2. 输入上下文范围不同，例如单镜头生成与全片连续性检查。
3. 输出 Schema 不同，例如剧本与补镜清单。
4. 质量标准不同，例如叙事张力与事实准确性。
5. 失败后的回退位置不同，例如内容错误应回到 ContentPlan，手部错误只需修图片。
6. 模型、队列、计费或重试策略不同。

若只是语气、人格描述或同一产物的轻微视角变化，不应单独增加 Agent。可将多个专业视角合并为一次结构化评审，降低延迟、成本和编排复杂度。

### 16.4 推荐编排方式

最终编排不是一条只向前运行的流水线，而是“全局锁定、局部并行、全片复核、定向回退”的有向流程：

```text
Profile / Brief
    -> ContentPlan
    -> Script / Narration
    -> Script Gate
    -> Treatment / ProductionBible
    -> Global ShotPlan
    -> Storyboard + Temporary Voice
    -> Animatic Gate
    -> [资产与镜头并行生成 + 单项质量闭环]
    -> Rough Cut
    -> Global Edit Review
       -> Pickup List -> 定向回到内容 / 资产 / ShotSpec / 视频生成
       -> Fine Cut
    -> Post
    -> Final QC
```

门禁不应只有“通过/失败”，还应返回明确路由：

```text
CONTENT_REVISE       -> ContentPlan / Script
SOURCE_VERIFY        -> Research / Fact Check
TREATMENT_REVISE     -> DirectorTreatment
SHOT_REPLAN          -> ShotPlan / ShotSpec
ASSET_REPAIR         -> 图片质量闭环
VIDEO_REGENERATE     -> 单镜头视频
PICKUP_REQUIRED      -> 补镜任务
POST_FIX             -> 声音 / 字幕 / 调色 / 合成
HUMAN_REQUIRED       -> 人工异常处理
```

### 16.5 最小落地顺序

不建议一次性实现完整数字制片系统，按返工成本从高到低补齐：

#### 第一阶段：修正上游方向

1. 引入 `VideoProfile` 和 `CreativeBrief`。
2. 增加 `ContentPlan` 与独立 Script Review。
3. 为书籍导读落地 `GuideOutline`、`GuideSegment` 和来源门禁。
4. 增加最小 `DirectorTreatment / ProductionBible`。
5. 在现有分镜结束后增加跨 clip 连续性检查。

#### 第二阶段：减少昂贵返工

1. 建立 Storyboard + 临时 TTS 的 Animatic。
2. 图片质量先以影子模式评审，再开放高置信度自动采用。
3. 接入 Prompt Patch、局部编辑和最多 2 轮自动修复。
4. 正式自动模式延迟提交图片，并用 `visual-readiness` 控制视频入口。

#### 第三阶段：闭合全片反馈

1. 增加 Rough Cut 全片评审和 Pickup List。
2. 按失败维度定向重跑内容、资产、镜头或视频。
3. 补充音乐、声音设计、统一调色、字幕和 Final QC。
4. 根据真实指标决定是否拆出更专业的独立角色或服务。

## 17. 结论

用户对图片问题的修正是正确的：应使用图片理解模型做规格驱动的自动质检，再通过候选选择、局部修图或结构化 Prompt Patch 自动修复。人工仍然存在，但职责应从“逐张审核”转为“校准规则、抽检和处理异常”。关键约束是视觉模型能力校验、结构化输出、锁定已正确内容、有界重试和完整生成血缘。

用户对专有场景的方向也正确，但分类方式需要调整。不同视频的本质区别首先是传播目标和信息结构，其次才表现为不同的剧本、分镜、资产、节奏和评价标准。AI 漫剧是视觉形式，导读和广告偏传播目标，历史故事是内容领域，应该通过可组合的 `VideoProfile` 统一表达。

当前工程可以较好支持剧情改编和小说情节型导读，但不能稳定满足非虚构导读、知识总结和书籍推荐。最小正确落点是在内容规划前引入 `VideoProfile`，为书籍导读增加 `GuideOutline`、`GuideSegment` 和来源约束，然后复用现有旁白、资产、Prompt Compiler 和生成能力。

当前视频生成流程的主方向是合理的，尤其是故事、剧本、分镜、资产和单镜头生成的分层，可以继续保留。但它更接近“AI 镜头生产流水线”，而不是完整的视频制作流程。要稳定提升成片质量，需要补齐 Brief、内容规划、剧本编辑、导演阐述、全片连续性、Animatic、候选审片、粗剪反馈和最终 QC。

角色需要有选择地拆分。最值得独立的是 Writer 与 Editor、Director 与 Storyboard、Generator 与 Critic、单镜头生产与全片 Editor，以及书籍/历史场景中的 Fact Checker。拆分的依据应是目标、上下文、产物、质量标准和回退位置不同，而不是为每个专业名称创建一个 Agent。

## 18. P0 + P1 + P2 实施结果

### 18.1 已实现模块

| 能力 | 实现位置 | 当前结果 |
| --- | --- | --- |
| 场景与质量策略 | `src/lib/video-profile/` | 支持 `ai_comic`、`book_guide`、`shadow`、`auto`，旧项目默认兼容 AI 漫剧影子评审 |
| 内容规划 | `src/lib/content-planning/`、`content-plan` Worker | 生成 Creative Brief、剧情/导读 ContentPlan 和独立 ContentReview |
| 视觉规划 | `src/lib/visual-planning/`、`visual-plan` Worker | 生成 Treatment、Production Bible、ShotPlan、VisualUnit 和 ShotSpec |
| 图片质量领域 | `src/lib/visual-quality/` | 统一目标规格、问题代码、VLM 结果解析、Prompt Patch、修复决策、技术检查和视觉能力校验 |
| 质量状态机 | `src/lib/quality-workflow/` | 支持 pending、reviewing、shadow_completed、repairing、approved、human_required、failed |
| 下游门禁 | `src/lib/visual-readiness/` | 旧数据和影子模式兼容放行；自动模式仅 approved 放行 |
| 任务编排 | 四个新增 Worker 和三个 API | 内容规划、视觉规划、视觉评审和图片修复使用独立任务、队列、计费和重试边界 |
| UI | 配置入口、分镜卡、视频卡 | 可选择 Profile 和质量模式，展示质量状态，并在视频生成前提示阻断原因 |
| 持久化 | Prisma Schema、迁移、GraphArtifact | 保存稳定业务结果、当前 Panel 质量状态和每轮评审/修复证据 |

### 18.2 实际运行流程

AI 漫剧路径：

```text
用户输入 + ai_comic Profile
    -> CONTENT_PLAN_RUN
    -> Content Review 门禁
    -> 现有 story-to-script
    -> VISUAL_PLAN_RUN，锁定 Treatment / Production Bible
    -> 现有 script-to-storyboard
    -> Panel 图片候选生成
    -> 技术检查 + VLM 评审
    -> shadow 记录结果，或 auto 自动采用/最多两轮修复/人工升级
    -> visual-readiness
    -> 单镜头、首尾帧或批量视频生成
```

历史剧集若已有 clips 但没有新 `ContentPlan`，确认资产时会跳过 `VISUAL_PLAN_RUN`，直接沿用原 script-to-storyboard 链路，避免新门禁阻断旧项目。

书籍导读路径：

```text
用户输入 + book_guide Profile
    -> CONTENT_PLAN_RUN
    -> GuideOutline / GuideSegment / sourceAnchor / Content Review
    -> 评审通过后替换导读 clips；阻断时仅保存证据
    -> VISUAL_PLAN_RUN
    -> 直接生成导读 storyboard、panel 和旁白匹配
    -> 复用同一图片质量闭环和视频门禁
```

图片自动模式状态流：

```text
pending -> reviewing
    -> approved
    -> repairing -> VISUAL_AUTO_REPAIR -> reviewing
    -> human_required
    -> failed
```

影子模式以 `shadow_completed` 结束，不修改已采用图片，也不阻断视频。自动模式生成新候选时延迟覆盖正式 `imageUrl`；只有自动通过或用户手动选择后才更新正式图片。首尾帧关联 Panel 当前优先使用影子评审，避免自动替换破坏已有配对关系。

### 18.3 门禁语义

| 状态 | 视频是否可继续 | 说明 |
| --- | --- | --- |
| 无质量状态 | 是 | 兼容历史项目 |
| `shadow` 任意状态 | 是 | 只采集证据；评审失败也不阻断 |
| `auto + approved` | 是 | 自动评审或人工选图已批准 |
| `auto + pending/reviewing/repairing` | 否 | 等待评审或修复完成 |
| `auto + human_required/failed` | 否 | 需要人工选图、重新生成或修正模型配置 |

门禁同时覆盖前端单镜头提交、首尾帧两端图片、批量生成入口和服务端 `generate-video` API。服务端使用 409 `VISUAL_QUALITY_NOT_READY` 返回具体 Panel、状态和原因。

### 18.4 验证结果

本轮已完成以下验证：

- `npx prisma generate`。
- `npm run typecheck`。
- 本次相关 TypeScript/JavaScript 文件的针对性 ESLint。
- 11 个聚焦测试文件、129 个用例。
- `npm run test:behavior:api`。
- 新增中英文 Prompt 构建、capability catalog、任务类型覆盖、行为覆盖、任务加载、提交补偿和 requirements matrix。
- `git diff --check`，仅出现仓库现有 CRLF 转换提示。

仓库级全量守卫仍存在与本次实现无关的既有问题，包括 legacy Prompt 国际化/占位符、缺少 `DATABASE_URL` 的严格模型配置校验、既有文件规模超限、Seedance pricing 能力声明、部分 dev/merge routes 登记，以及旧单元测试 Mock/断言问题。本轮未扩大范围修复这些问题。

### 18.5 当前限制与下一步

- 自动质量闭环当前接入的是分镜 Panel 图片；角色、场景、道具仍需按同一领域接口继续接入。
- `frame_pair` 数据契约已预留，但首尾帧成对 VLM 评审尚未实现；当前只检查两端 Panel readiness。
- 自动编辑复用现有图片生成/参考图能力，尚未建设区域蒙版级 inpainting。
- 导读是首个专有内容路径；广告、历史和更多视觉形式尚未实现。
- 内容规划当前最多向单次 LLM 调用传入原文前 60,000 个字符；完整长篇书籍需要后续增加分块摘要、来源索引和分层汇总，当前更适合书稿摘要、章节内容或已整理材料。
- 剧情路径的 VisualPlan 当前持久化 Treatment/Bible 和 Artifact，镜头仍由现有 script-to-storyboard 生成；导读路径才直接落地 VisualUnit。
- Prompt Compiler、Animatic、视频级评审、Rough Cut、Pickup List、Final QC 和质量指标看板归入 P3。

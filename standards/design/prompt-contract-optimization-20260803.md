# 资产、分镜、视频提示词合同优化方案

- 日期：2026-08-03
- 状态：第一阶段已实现并通过定向单元测试；待真实生成样本回归
- 范围：小说推广工作流的资产图、分镜关键帧图、视频生成提示词
- 非范围：ZIP 媒体导出命名、模型选型、故事/剧本生成、图片生成接口本身

## 1. 结论

提示词质量问题的根因不是提示词太短，也不是缺少更多 JSON，而是当前编译器把原始叙事描述按标点切分后，重复填入多个视觉字段。它会造成三类问题：

1. 角色、道具的视觉不变量被剧情关系、行为和背景信息挤占。
2. 同一段信息在“轮廓、材质、颜色、关键部件”中重复出现，增加 token 而不增加约束力。
3. 分镜与视频各自拼接信息，无法稳定继承同一主体、构图和连续性合同。

目标架构如下：

```text
原始字段 / 原文 / 已有结构化资料
  -> PromptEvidence（最小、可追溯证据）
  -> AI PromptFactGraph（只提取事实，不写最终提示词）
  -> 规则校验（证据、类别、冲突、数量）
  -> AI JSON Patch 修复（仅在校验失败时，最多一次）
  -> VisualContract（资产 / 分镜 / 视频）
  -> 确定性模板编译（最终文本提示词）
```

AI 负责理解、归类、补全和发现冲突；程序负责白名单校验、去重、限长、版本化和最终编译。最终提交给图像或视频模型的内容只能是简洁的自然语言合同，不能携带源 JSON、数据库 ID、内部字段名或调试数据。

## 2. 设计原则

### 2.1 不采用一个大模型调用

不把全部资产、全部镜头和视频提示词放入一次大调用。大调用难以追溯单个事实、失败重试粒度粗、上下文膨胀，并会让局部修改意外改变其他资产。

采用按生产单元的短调用：

| 单元 | AI 调用 | 输入 | 输出 | 失败降级 |
| --- | --- | --- | --- | --- |
| 资产 | 每个资产一次提取 | 资产名称、原始描述、已有视觉 profile、语义类型 | `AssetFactGraph` | 使用已验证的结构化 profile 和原始描述兜底 |
| 分镜 | 每个镜头一次提取或复用规划阶段的结构化结果 | 镜头描述、绑定资产、前后镜连续性、文字策略 | `PanelFactGraph` | 使用已有分镜字段和绑定计划 |
| 视频 | 默认不再做独立改写 | 已校验的 `PanelVisualContract`、时长、音频能力 | `VideoMotionContract` | 只保留单动作和镜头运动 |
| 修复 | 仅校验失败时一次 | 原 FactGraph、校验错误、允许证据 | RFC 6902 风格 JSON Patch | 丢弃不合法事实，使用保守合同 |

视频不重复调用 LLM 改写画面语义，避免分镜图与视频提示词漂移。只有用户主动编辑视频语义或分镜合同不可恢复时，才允许走独立的受约束提取调用。

### 2.2 证据优先，不让 AI 造事实

每个可见事实必须包含：

```ts
type PromptFact = {
  id: string
  category: PromptFactCategory
  value: string
  evidenceRefs: string[]
  confidence: number
  origin: 'source' | 'design_assumption' | 'unknown'
}
```

其中 `source` 必须指向原始描述或已验证 profile 的 `PromptEvidence`；AI 提取结果本身不是证据来源，只能回指其输入证据。`design_assumption` 只能出现在构图、光线和镜头运动等创作层，不能覆盖角色身份、道具结构和剧情事实；`unknown` 不进入最终提示词。

### 2.3 最终提示词由代码编译

AI 输出是中间结构，绝不直接作为最终 prompt。编译器只接受已经通过校验的合同，并按固定优先级输出：

```text
任务与画幅 -> 主体身份/视觉锁 -> 唯一动作或状态 -> 构图/镜头 -> 场景与光色
-> 风格 -> 连续性 -> 文字策略 -> 必要负面约束
```

同一事实只能出现一次；无证据、低置信度、重复或越界字段在编译前被删除。

## 3. 通用数据合同

### 3.1 PromptEvidence

所有 AI 调用只接收最小证据集，而不是全量业务 JSON：

```ts
type PromptEvidence = {
  id: string
  source: 'asset_description' | 'profile_data' | 'panel' | 'binding_plan' | 'continuity' | 'user_edit'
  text: string
  priority: 'required' | 'supporting'
}
```

构建证据时移除数据库主键、URL、模型配置、任务状态、完整关联对象、日志和内部标签。`assetName` 仅用于内部标识；除非是明确可画出的文字资产，否则不能要求模型把它渲染成文字。

### 3.2 PromptFactGraph

```ts
type PromptFactGraph = {
  schemaVersion: 1
  subject: PromptFact[]
  visual: PromptFact[]
  composition: PromptFact[]
  motion: PromptFact[]
  continuity: PromptFact[]
  textPolicy: PromptFact[]
  exclusions: PromptFact[]
}
```

解析器必须接受纯 JSON 或 JSON fenced code block；随后验证数组长度、值长度、类别白名单、`evidenceRefs`、`confidence` 范围和事实去重。不得用正则从自然语言中猜测“颜色、材质、轮廓”等视觉类别；正则仅用于 JSON 外壳清理和安全限制。原始 JSON、UUID 和无来源的提取结果不得作为兜底事实进入最终渲染提示词。

### 3.3 校验与修复

校验规则分为确定性规则和模型辅助规则：

1. 确定性规则：引用证据存在、同一类别去重、单字段长度、总量、`source` 事实不可无证据、资产不允许把剧情事件归入视觉锁。
2. 模型辅助规则：发现互斥颜色、角色身份冲突、无关叙事占比过高、镜头动作过多等语义问题。
3. 修复只接受 JSON Patch，允许 `add`、`replace`、`remove` 三类操作；Patch 应再次通过完整校验。
4. 修复失败或模型不可用时，保留强证据事实并降级，不阻塞用户已经可用的生成任务。

每次生成快照持久化 `PromptEvidence`、已验证的合同、校验结果和最终 `compiledPrompt`，用于导出审计和质量回归；展示层默认只展示最终 prompt 与必要的来源摘要。

## 4. 资产提示词方案

### 4.1 AssetVisualContract

资产合同只描述“这个资产长什么样”，不描述它在故事里与谁发生什么事。

```ts
type AssetVisualContract = {
  identityLocks: PromptFact[]
  silhouetteLocks: PromptFact[]
  costumeOrMaterialLocks: PromptFact[]
  colorLocks: PromptFact[]
  keyPartLocks: PromptFact[]
  renderPurpose: 'reference_sheet' | 'single_reference' | 'variant' | 'repair'
  templateKind: AssetImageTemplateKind
  viewAndComposition: string
  backgroundRule: string
  styleApplication: string
  exclusions: PromptFact[]
}
```

优先读取已有 AI 生成的结构化 profile（例如 `identity_locks`、`silhouette_locks`、`costume_locks`、`color_locks`、`primary_identifier`），再把原始描述作为证据补充。不能再将同一段 `description` 同时复制到轮廓、材质、颜色和关键部件。

资产类别限制：

- 角色：身份、年龄段/体型、脸部和发型、服装、主色、标志性配件；关系、台词、剧情动作不得占用视觉锁。
- 道具/载具：整体轮廓、比例、材质、主色、功能性关键部件；持有人或发生地点仅作弱证据。
- 场景：空间边界、锚点物、材质、光色、可用落位；非明确要求时不生成角色或群像。

输出配额建议：身份 1-3 条、轮廓 1-3 条、服装/材质 1-4 条、颜色 1-3 条、关键部件 1-4 条。超额时按 `required > confidence > 证据优先级` 截断。

### 4.2 资产编译模板

```text
资产类型与生成目的
身份不变量
视觉锁（轮廓、材质/服装、颜色、关键部件）
视角与构图、背景规则
项目风格
必要禁止项
```

角色 `reference_sheet` 明确允许同一主体的多视图；质检合同必须携带 `renderPurpose/templateKind`，避免把角色设定图误判为拼贴。场景和单对象资产继续禁止多格或分屏。

## 5. 分镜关键帧提示词方案

### 5.1 PanelVisualContract

分镜保留现有 `render_brief` 的简洁输出，但其输入改为统一合同：

```ts
type PanelVisualContract = {
  primarySubject: PromptFact[]
  supportingSubjects: PromptFact[]
  visibleAssetLocks: PromptFact[]
  actionOrState: PromptFact[]
  composition: PromptFact[]
  settingAndLight: PromptFact[]
  continuity: PromptFact[]
  textPolicy: PromptFact[]
  exclusions: PromptFact[]
}
```

规则：

1. 一个关键帧只保留一个主动作或一个稳定状态，复杂多阶段动作必须拆镜。
2. 已绑定角色、道具、场景优先以引用锁表示，不把资产原始长描述重新粘贴到每个镜头。
3. `sourceAnchor` 只用于审计，不进入最终图像 prompt；`visualLicense` 为 `metaphor` 时必须显式避免被解释为新增剧情。
4. 文字策略单独编译：默认无文字；需要文字时输出安全区和后期叠字意图，而非让图像模型生成长文案。

### 5.2 分镜编译模板

```text
关键帧目标与景别
主主体及已绑定资产身份
单一动作/状态
构图、镜头方向、主体位置
场景、光线、色彩
连续性和文字策略
精简禁止项
```

现有 `render_brief` 继续作为最终外部格式，删除其中与已绑定资产、文字策略或负面约束重复的字段。

## 6. 视频提示词方案

### 6.1 VideoMotionContract

视频合同从已验证的 `PanelVisualContract` 派生，不重新复制整段分镜描述：

```ts
type VideoMotionContract = {
  inheritedVisual: Pick<PanelVisualContract, 'primarySubject' | 'visibleAssetLocks' | 'composition' | 'settingAndLight' | 'continuity'>
  primaryMotion: PromptFact[]
  cameraMotion: PromptFact[]
  startState: PromptFact[]
  endState: PromptFact[]
  audio: PromptFact[]
  exclusions: PromptFact[]
}
```

规则：

1. 仅增加“一个主体动作 + 一个镜头运动 + 起止状态”，不重述人物外观、场景素材或整段剧情。
2. 前后状态必须可从同一关键帧自然过渡；无法表达的多动作需求回退为拆镜建议。
3. 只有底层模型明确支持原生音频且用户开启音频时，才注入台词、环境声或音效；否则相关内容不进入视频模型提示词。
4. 台词保持原文，长度受模型能力限制；画面文字仍遵循分镜文字策略。

### 6.2 视频编译模板

```text
继承的主体与场景锁
起始画面
唯一主动作
镜头运动
结束画面
必要连续性与负面约束
（可选）原生音频
```

## 7. 第一阶段落地范围与验收

第一阶段实现以下内容：

1. 新增可追溯 `PromptFact`、资产视觉合同和确定性校验模块。
2. 资产编译器优先消费结构化视觉锁，原始描述只作受控兜底，删除按标点把全文复制到多个字段的行为。
3. 资产生成与视觉质检传递 `renderPurpose/templateKind`，正确评估设定图的多视图。
4. 分镜编译器把 `render_brief` 的输入统一为 `PanelVisualContract`，视频提示词从同一合同派生。
5. 快照记录合同和最终 prompt，不向下游渲染 prompt 注入 JSON。

验收标准：

- 角色结构化 profile 中的脸型、发型、服装、主色、标志性部件都能进入各自对应的视觉锁，剧情关系不再挤占这些字段。
- 同一事实不在最终提示词重复出现，且最终 prompt 中不包含 JSON、UUID、数据库字段名或完整业务对象。
- 角色 `reference_sheet` 的多视图不会被质检为拼贴；场景和普通道具仍会拦截多格图。
- 视频提示词可追溯到分镜合同，且仅在原生音频启用时包含音频指令。
- LLM 提取或修复不可用时，任务可使用已验证结构化字段或最小原始描述完成生成。

## 8. 后续迭代

第一阶段不迁移历史资产、不增加数据库字段、不改变用户编辑接口。稳定后可将已验证 `PromptFactGraph` 缓存到资产/分镜版本中，按输入哈希复用，避免重复 LLM 调用；并基于导出快照建立“事实覆盖率、重复率、无证据率、生成通过率”的离线回归集。

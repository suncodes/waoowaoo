# 视觉资产、分镜与视频生产链路重构方案

- 日期：2026-07-24
- 范围：小说推广工作流中的视觉资产、资产图、分镜图、视觉质检、自动修复、视频生成、进度展示
- 结论：建议把重构作为下一阶段主线，但采用分层迁移，不做一次性大爆炸重写

## 1. 背景判断

最近的问题不是单个 bug，而是视觉生产链路的职责边界已经变得不清晰。当前代码已经具备很多能力：资产库、分镜规划、参考图、提示词快照、视觉质检、自动修复、视频生成、统一任务表和前端状态展示。但这些能力分散在多个模块中，数据含义互相重叠，导致小修容易牵出连锁问题。

从当前代码看，主要链路分散在：

- 资产读写与任务提交：`src/lib/assets/services/*`、`src/lib/assets/mappers.ts`
- 资产图与分镜图生成：`src/lib/workers/handlers/*image-task-handler.ts`
- 分镜规划：`src/lib/visual-planning/*`、`src/lib/workers/handlers/visual-plan*.ts`
- 参考图绑定：`src/lib/creation-workspace/visual-anchors.ts`、`src/lib/workers/handlers/image-task-handler-shared.ts`
- 视觉质量与修复：`src/lib/quality-workflow/*`、`src/lib/visual-quality/*`、`src/lib/workers/handlers/visual-quality-review.ts`、`src/lib/workers/handlers/visual-auto-repair.ts`
- 进度与 UI 状态：`src/lib/task/*`、`src/lib/visual-workflow/status.ts`、studio/storyboard/video stage 组件
- 视频生成：`src/app/api/novel-promotion/[projectId]/generate-video/route.ts`、`src/lib/workers/video.worker.ts`

这说明问题不适合继续靠局部补丁解决。否则每次修复都可能碰到 targetId、candidateImages、visualQualityState、assetRefs、referenceImages、imageUrl/videoUrl 之间的隐式关系。

## 2. 当前核心问题

### 2.1 资产实体和渲染实体混用

角色资产的业务实体是 `NovelPromotionCharacter`，但真正生成图片的目标是 `CharacterAppearance`。场景和道具又共用 `NovelPromotionLocation` / `LocationImage`，通过 `assetKind` 区分。

目前任务里有时传资产 id，有时传 appearance/image id，`submitProjectAssetGenerateTask()` 里需要做兼容恢复。这解释了为什么之前出现过 `Character appearance not found` 一类问题。根因不是单次参数错，而是缺少一个统一的 Visual Target Resolver。

当前应明确三层：

- AssetIdentity：稳定资产身份，如角色、场景、道具。
- AssetVariant：角色外观、场景视角、道具设计版本。
- AssetRender：某个 variant 的一张候选图、修复图或定稿图。

任务、进度、质检、选图必须绑定到 AssetRender 或 AssetVariant，不能有时绑定 AssetIdentity，有时绑定 Render。

### 2.2 资产绑定语义不够强

当前分镜资产绑定主要通过 `assetRefs`、`characters/location/props`、`sourceAnchor.visualAssetIds` 和文本命中共同发挥作用。问题是这些字段没有明确主次：

- `assetRefs` 既表示画面中真正出现的资产，又被当成参考图收集来源。
- `sourceAnchor.visualAssetIds` 也会进入参考图收集。
- `characters/location/props` 是从 `assetRefs` 派生的旧字段，但仍影响提示词上下文。
- `collectPanelReferenceImages()` 会把多路来源合并为无权重的 `referenceImages`。

这会导致主主体和参考图不一致。例如分镜主体是阅读女生，却带入尼摩船长参考图；主体是书封，却带入角色和潜水艇参考图。模型会被错误参考图干扰。

### 2.3 分镜规划评审偏形式化

`reviewVisualPlanStoryboard()` 能检查字段存在、连续镜头重复、是否有 `visibleAssets` 和 `assetRefs` 同步，但还不能判断：

- `primarySubject` 是否真的应该绑定这些资产。
- 资产是否只是旁白里提到，而不是当前画面可见主体。
- 书封、文字卡、信息卡是否应该走合成，而不是文生图。
- 全片视觉导演语言是否统一。

所以 storyboard review 可以 100 分，但最终分镜图仍然可能错绑、不统一、不够精致。

### 2.4 文生图链路重复且职责混杂

角色图、场景/道具图、分镜图都有自己的 worker handler。它们都在做类似事情：

1. 解析目标。
2. 组装上下文。
3. 编译 prompt。
4. 收集参考图。
5. 调模型生成候选。
6. 上传媒体。
7. 写回 DB。
8. 创建 prompt snapshot。
9. 触发视觉质检。

但每条链路细节不同，导致行为不一致。比如候选图写入、选中图、previousImage、质量状态、repair lineage 的处理分散在不同文件里。

这部分应该抽成统一的 `VisualImageGenerationService`，不同业务只提供 target resolver、prompt spec builder、reference resolver、persistence adapter。

### 2.5 进度展示已有基础，但缺少统一投影

`TaskTargetState` 是好的基础，`visual-workflow/status.ts` 也已经在尝试统一图片生成、质检、修复状态。但目前：

- 资产层又定义了 `AssetTaskState`。
- 分镜层直接读 `imageTaskState`、`candidateImages`、`visualQualityState`。
- 视频层单独用 `evaluateVisualReadiness()` 和 `hasUnconfirmedVisualCandidates()` 判断能否生成。
- 前端有多个局部投影函数。

结果是同一个事实可能在 UI 中被不同模块解释成不同状态。需要一个跨资产、分镜、视频的 `VisualProductionProjection`。

### 2.6 图片文字策略冲突

当前分镜图片模板要求无字底图，但视觉质检将 `onScreenText` 当成 `requiredText`，自动修复又会要求把文字补进图里。这会破坏底图/合成职责分离，也会增加 `TEXT_ERROR`。

应将文字分为：

- ImageTextPolicy：图片模型是否允许生成文字。
- OverlayTextSpec：后续合成层渲染的准确文字。
- ReviewTextPolicy：质检检查留白、安全区和不得乱写字，而不是要求图片内出现准确文字。

### 2.7 视频生产依赖视觉状态，但状态来源不统一

视频生成前会检查 `visualQualityState` 和候选确认状态。这个方向是对的，但 readiness 目前只服务视频 API 和部分前端逻辑，没有与资产、分镜图状态投影完全统一。

视频生产应该依赖统一的视觉产物锁定状态：

- image missing：不能生成视频。
- image candidates exist but no human lock：不能生成视频。
- auto approved but not human confirmed：默认不能生成，除非项目策略允许自动锁定。
- human confirmed / shadow confirmed：可以生成视频。

## 3. 本质提升方向

### 3.1 资产质量提升

资产库不能只解决“有哪些角色/场景/道具”，还要解决“哪些资产必须稳定、哪些只在某些镜头作为背景参考”。建议资产 Bible 增加更强的使用语义：

- `importance`: core / recurring / supporting / one_off
- `usageScope`: identity_lock / environment_plate / prop_detail / style_reference
- `mustAppearInPanels`: 具体分镜或 visualUnit id
- `forbiddenUse`: 禁止被哪些镜头误用
- `appearanceVariants`: 日常、潜水服、回忆、抽象符号等变体
- `promptLocks`: 身份、轮廓、材质、颜色、禁用变体

资产图生成要从“单张漂亮图”升级为“可被后续分镜引用的参考资产”。验收不只是图好看，还要能回答：

- 这个图是否能作为身份参考？
- 是否有明显稳定锚点？
- 是否会误导分镜生成？
- 是否和项目视觉导演语言一致？

### 3.2 分镜质量提升

分镜规划需要从“切镜头”升级为“视觉导演计划”。每个分镜至少要明确：

- `shotFunction`: hook / setup / evidence / payoff / breath / cta
- `primarySubject`: 唯一主视觉主体
- `visibleAssets`: 画面中真正可见的资产
- `referenceOnlyAssets`: 只用于风格、材质、场景氛围，不应画成主体的资产
- `compositionIntent`: 信息展示、情绪推进、动作承接、证据展示
- `renderStrategy`: generated_image / text_card / composite / overlay
- `continuityGroup`: 同一空间、同一角色、同一光色组

评审也要从字段检查升级为语义检查：

- 主体与资产绑定是否一致。
- 是否把旁白里提到的资产误认为画面可见资产。
- 是否有无关角色或道具进入 `assetRefs`。
- 画面类型是否适合文生图，还是应该交给合成。
- 连续镜头的色温、构图密度、主体尺度是否稳定。

### 3.3 参考图绑定提升

参考图应有角色和权重，而不是字符串数组：

```ts
type VisualReference = {
  assetId: string
  renderId: string
  kind: 'character' | 'location' | 'prop' | 'style' | 'previous_frame'
  role: 'primary_identity' | 'supporting_identity' | 'environment' | 'prop_detail' | 'style_only'
  usage: 'must_match' | 'adapt' | 'avoid_copy'
  weight: number
}
```

生成提示词时必须把参考图语义写进 prompt：

- primary identity：主体必须像它。
- supporting identity：出现时保持一致，但不能抢主主体。
- environment：只参考空间与光色，不直接贴图。
- style_only：只取线条、材质、色彩，不引入参考图主体。

同时限制每个分镜的参考图数量。一般规则：

- 角色主镜头：1 个主角色 + 1 个场景，最多 2-3 张。
- 场景主镜头：1 个场景 + 必要道具，最多 2 张。
- 书封/信息卡：默认不带角色参考，除非角色真的出现在画面。
- 纯转场/文字卡：不带身份参考，只带风格基准。

### 3.4 Prompt 提升

不要追求单纯变长。项目需要的是结构化、可回归、可解释的 prompt。

推荐分三层：

- Display Prompt：界面上给用户看的短描述，可编辑。
- PromptSpec：结构化生成合同，包含主体、参考、构图、光色、文字策略、禁用项。
- Compiled Prompt：最终给模型的完整指令，由 compiler 生成，不直接手写。

当前 `panel.imagePrompt` 更像 Display Prompt，不应让用户误以为它就是最终提示词。UI 和日志应展示 `compiledPromptPreview` 或 PromptSpec 摘要。

### 3.5 视频制作提升

视频不是单独的后置步骤，它依赖已锁定的视觉产物。建议把视频生产输入固定为：

- locked panel image
- panel video prompt spec
- motion plan
- optional last frame
- voice alignment
- duration budget

视频生成前只检查统一的 `VisualProductionReadiness`，不在 API、前端、worker 多处重复判断。

## 4. 目标架构

建议新增一个核心模块，先不急着改表：

```text
src/lib/visual-production/
  targets.ts              统一解析资产/分镜/视频生产目标
  bindings.ts             统一解析 visible/reference-only 资产绑定
  references.ts           生成带角色和权重的 VisualReference
  image-service.ts        文生图统一编排
  review-service.ts       视觉质检统一状态机
  progress.ts             统一进度和 UI 状态投影
  readiness.ts            图片、视频生产就绪判断
  repositories.ts         Prisma 适配层接口
```

核心边界：

```text
API Route
  -> submit typed visual task
Worker Handler
  -> VisualProductionService
    -> TargetResolver
    -> PromptSpecBuilder
    -> ReferenceResolver
    -> ImageGeneratorPort
    -> CandidateRepository
    -> QualityScheduler
UI
  -> VisualProductionProjection
```

旧 handler 不立刻删除，而是逐步改成薄适配器。

## 5. 分阶段落地

### P0：稳定边界，先止血

目标：减少 bug，提升分镜图参考一致性，不做数据库大迁移。

1. 增加 `VisualTargetResolver`
   - 明确 `AssetIdentityId`、`VariantId`、`RenderId`。
   - 角色生成统一解析到 `CharacterAppearance`。
   - 场景/道具生成统一解析到 `LocationImage`。
   - 禁止 worker 内部再猜 targetId。

2. 增加 `VisualBindingResolver`
   - 从 visualUnit 的 `shotSpec` 生成权威绑定。
   - 区分 `visibleAssets` 和 `referenceOnlyAssets`。
   - `characters/location/props/sourceAnchor.visualAssetIds` 只作为兼容输出，不再作为权威输入。
   - 引入主主体校验：primarySubject 不匹配的资产不能作为 primary reference。

3. 统一 `VisualReference`
   - 替代裸 `referenceImages: string[]` 的上游语义。
   - 编译到模型请求前再降级为 URL 数组。
   - 日志和导出记录每张参考图的 role/usage/weight。

4. 修正文字策略
   - `onScreenText` 不再进入图片内 requiredText。
   - 质检改为检查无字底图、安全留白、是否乱写字。
   - 自动修复不得要求把 onScreenText 画进图。

5. 抽出统一进度投影
   - 以 `TaskTargetState + VisualQualityState + CandidateState + LockedMedia` 为输入。
   - 资产、分镜、视频共用同一个 presentation resolver。

6. 增加回归测试
   - 角色 id 传入时能稳定解析 appearance。
   - 主体为书封时不会注入角色参考图。
   - 主体为阅读女生时不会误用尼摩船长。
   - onScreenText 不会要求图片内出现文字。
   - 视频生成只接受 locked image。

P0 可以和下一轮质量提升一起做，因为它直接影响“资产更稳、分镜更精致、提示词更专业”。但要控制范围：只做核心服务抽取和旧逻辑接入，不改库表、不重写 UI。

### P1：统一文生图编排

目标：消除角色图、场景图、道具图、分镜图 handler 的重复逻辑。

抽出统一流程：

```ts
type VisualImageRequest = {
  target: VisualProductionTarget
  renderPurpose: 'asset_reference' | 'panel_base' | 'panel_repair'
  promptSpec: AssetPromptSpec | PanelPromptSpec
  references: VisualReference[]
  candidatePolicy: CandidatePolicy
  qualityPolicy: QualityPolicy
}
```

统一处理：

- prompt snapshot
- reference snapshot
- candidate generation
- media upload
- candidate group
- quality review task
- state transition

原有 handler 只保留：

- 读取 task payload。
- 调用 service。
- 返回结果。

### P2：规范数据模型

目标：降低历史字段负担。只有 P0/P1 稳定后才做。

可以考虑新增表或 JSON 字段：

- `VisualAssetBinding`
  - panelId / visualUnitId
  - assetId
  - assetKind
  - role
  - usage
  - source

- `VisualRender`
  - ownerType: asset_variant / panel
  - ownerId
  - mediaId / url
  - origin: initial / repair / upload / selected
  - versionHash
  - qualityState

- `PanelVisualSpec`
  - panelId
  - promptSpec
  - referenceSpec
  - textPolicy
  - renderStrategy

迁移原则：

- 先双写，再切读。
- 导出日志同时输出新旧字段，便于回归。
- 稳定后再移除旧字段依赖。

### P3：合成与视频生产闭环

目标：让 `text_card`、`composite` 真正分流，不再都压给单张文生图。

1. text_card
   - 图片模型只生成无字背景。
   - onScreenText 由合成器渲染。
   - 质检检查留白与背景干净度。

2. composite
   - 单独生成底图或前景素材。
   - 后续合成器负责图层拼接。
   - 禁止让模型伪造多图拼贴。

3. video
   - video prompt compiler 使用 locked image、motion plan、duration、voice alignment。
   - first-last-frame 只接受两个 locked panels。
   - rough cut review 的问题回写到 panel/video task。

## 6. 是否本次一起重构

建议：本次应该一起启动重构，但不要做全量重写。

原因：

- 资产和分镜质量问题的根因，已经和代码结构耦合在一起。只改 prompt 或评审，很容易继续出现错绑、状态不一致和修复方向错误。
- 但完整重构包含数据模型、前端状态、worker、API、导出日志、视频生成，风险过大，不适合和质量 prompt 改动混成一个不可控大修改。

推荐本次范围：

- 做 P0 全部。
- 做 P1 的骨架和分镜图/资产图最小接入。
- 不做 P2 数据库迁移。
- 不重写前端，只把前端状态输入切到统一 projection。
- 不改视频生成模型逻辑，只改 readiness 和状态来源。

这样既能解决最痛的问题，又能避免一次性推倒。

## 7. 验收标准

### 代码维护性

- 资产目标解析只有一个入口。
- 分镜参考图绑定只有一个入口。
- 文生图编排只有一个主服务。
- 前端资产、分镜、视频状态使用同一套 projection。
- worker handler 不再各自实现候选图、质检、修复状态写入。

### 生成质量

- 分镜主主体和 primary reference 一致。
- 书封、信息卡、文字卡不会误带角色参考图。
- 资产参考图有角色、用途和权重。
- onScreenText 不再被画进底图。
- 分镜图的视觉评审不再被 TEXT_ERROR 大量干扰。
- 自动修复不再因为错误目标越修越偏。

### 导出日志

导出包中应新增或完善：

- `visual-bindings.jsonl`
- `visual-references.jsonl`
- `visual-production-states.jsonl`
- prompt snapshot 中记录 `displayPrompt`、`promptSpec`、`compiledPrompt`。
- 每个 reference image 记录 assetId、role、usage、weight、mediaUrl。
- rough cut review 能追溯到具体 panel、locked image、video task。

## 8. 推荐实施顺序

1. 先修正文字策略冲突。
2. 抽 `VisualTargetResolver`，覆盖角色 appearance 和 location image 的历史兼容。
3. 抽 `VisualBindingResolver`，让 `shotSpec` 成为权威来源。
4. 抽 `VisualReferenceResolver`，给参考图加 role/weight。
5. 将 panel image handler 接入新 resolver。
6. 将 character/location/prop image handler 接入新 target resolver。
7. 统一 `VisualProductionProjection`，替换 studio/storyboard/video 中的局部状态判断。
8. 增加语义级 storyboard review。
9. 再考虑数据模型规范化。

## 9. 预期收益

- Bug 修复成本降低：targetId、候选图、质检状态不再分散猜测。
- 分镜图稳定性提升：参考图从“无语义 URL 数组”变成“有角色和权重的生产输入”。
- 自动修复更可靠：修复目标来自统一 spec，不再和无字底图策略冲突。
- UI 进度更清楚：资产、分镜、视频都按同一状态机展示。
- 后续质量提升有抓手：文稿、资产、分镜、prompt、视频都能通过日志和状态追踪闭环验证。


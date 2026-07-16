# 视频播放与合并导出统一方案

- 状态：已实现
- 适用项目：`waoowaoo`
- 更新时间：2026-07-16
- 方案范围：首尾帧播放入口修复、视频连续播放、单视频合并导出

## 1. 决策摘要

本方案把两个问题合并处理：

1. 首尾帧模式生成后没有明显播放入口。
2. 多镜头视频目前只能下载 zip，不能形成单个可播放/可下载的视频。

最终口径如下：

- `zip` 继续保留，作为“多个独立视频文件”的原始批量下载能力。
- “合并播放”与“合并下载”必须拆成两个不同能力。
- 合并播放 = 前端连续播放，不做转码，不生成新文件。
- 合并下载 = 后端异步生成单个 `mp4`，再提供下载或播放。
- 首尾帧视频的归属不变，仍然属于首帧 panel；播放入口必须落在首帧卡片上，而不是尾帧卡片上。

这意味着：

- `zip` 不是合并视频。
- 首尾帧播放 bug 不是合并导出问题。
- 多镜头合并导出不是首尾帧模式的特例。

## 2. 现状判断

### 2.1 首尾帧播放问题是真问题

当前首尾帧生成链路会把结果写回首帧 panel：

- [`generate-video/route.ts`](../../src/app/api/novel-promotion/[projectId]/generate-video/route.ts)
- [`video.worker.ts`](../../src/lib/workers/video.worker.ts)

前端刷新链路也会把 `videoUrl` 和 `videoGenerationMode` 带回页面：

- [`useSSE.ts`](../../src/lib/query/hooks/useSSE.ts)
- [`useVideoPanelsProjection.ts`](../../src/lib/novel-promotion/stages/video-stage-runtime/useVideoPanelsProjection.ts)
- [`storyboards/route.ts`](../../src/app/api/novel-promotion/[projectId]/storyboards/route.ts)

但当前 UI 只在首帧卡片顶部满足条件时才提供播放遮罩：

- [`videoPanelRuntimeCore.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/videoPanelRuntimeCore.tsx)
- [`VideoPanelCardHeader.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardHeader.tsx)

首尾帧生成区域本身没有播放入口：

- [`VideoPanelCardBody.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardBody.tsx)

所以用户感知上会认为“首尾帧模式不能播放”。

### 2.2 合并下载当前只是 zip

当前“下载全部视频”实现是：

- 前端：[`useVideoDownloadAll.ts`](../../src/lib/novel-promotion/stages/video-stage-runtime/useVideoDownloadAll.ts)
- 后端：[`download-videos/route.ts`](../../src/app/api/novel-promotion/[projectId]/download-videos/route.ts)

它的行为是：

- 按分镜顺序收集视频
- 选择原始视频或口型同步视频
- 逐个拉取后打包成 zip

这不是合并成一个视频。

### 2.3 现有视频编辑器只能作为参考，不作为最终依赖

仓库里存在视频编辑器骨架：

- [`features/video-editor`](../../src/features/video-editor)

但它的导出链路并没有形成稳定的生产闭环，因此不建议把“合并导出”直接绑定到这条未闭环链路上。

## 3. 最终产品口径

| 场景 | 用户看到的能力 | 技术含义 |
|---|---|---|
| 普通单镜头视频 | 卡片顶部可直接播放 | 单个 `videoUrl` 播放 |
| 首尾帧视频 | 首帧卡片可播放，尾帧给出归属提示 | 结果仍写回首帧 panel |
| 合并播放 | 一个连续播放器，按镜头顺序串播 | 前端逻辑拼接，不生成文件 |
| 合并下载 | 一个单独的 `mp4` 文件 | 后端异步渲染导出 |
| 批量下载 | zip 包 | 保留原始多文件下载 |

统一原则：

- 播放优先于导出。
- 预览优先于物理合并。
- 物理合并必须是显式动作，不影响现有 zip。

## 4. 推荐落地方案

### 4.1 第一阶段：修复首尾帧播放入口

最小修复范围：

- 在首帧卡片的首尾帧生成区域增加“播放视频”入口。
- 首帧顶部继续保留现有播放遮罩。
- 尾帧卡片增加文案提示：视频结果在上一镜头播放。

这样可以消除“生成成功但找不到播放按钮”的问题。

### 4.2 第二阶段：增加合并播放

合并播放建议做成前端连续播放，不做转码。

推荐行为：

- 读取当前 episode / project 下的视频列表
- 按与 `download-videos` 一致的顺序播放
- 每个镜头播放结束后自动切到下一个
- 默认沿用当前的原始/口型同步选择策略
- 播放器保留两个视频槽位，活动槽位负责展示，另一槽位使用 `preload="auto"` 提前加载下一镜头
- 播放画布使用项目视频比例和固定最小高度，切换时只交换槽位，不卸载整个播放容器
- 视频代理透传浏览器的 `Range` 请求，并返回 `206`、`Content-Range` 和 `Accept-Ranges`，降低下一镜头的首帧等待

这一步不需要 ffmpeg，也不需要新存储字段。

### 4.3 第三阶段：增加合并导出

合并导出必须异步化。

推荐行为：

- 新增单独的合并任务类型
- worker 下载各镜头视频到临时目录
- 统一分辨率、fps、编码格式
- 使用 `ffmpeg` 拼接并输出单个 `mp4`
- 上传到对象存储
- 返回 `outputUrl`，可下载也可播放

不建议：

- 在 Next API route 里同步合并大视频
- 直接把 zip 改成 mp4
- 用前端浏览器拼接后再强行导出

## 5. 具体技术口径

### 5.1 首尾帧结果归属

首尾帧生成结果仍只属于首帧 panel。

原因：

- 生成任务是以首帧 panel 为 target。
- 当前保存逻辑只更新首帧 panel 的 `videoUrl`。
- 这样可以避免重复保存和双向状态冲突。

### 5.2 合并顺序

合并播放和合并导出都应沿用当前视频下载顺序：

- 先按 storyboard 顺序
- 再按 panelIndex 顺序
- 每个 panel 按当前用户偏好的视频源选择原始视频或口型同步视频

如果以后用户在 UI 上单独切换某个镜头的播放源，合并能力也应复用同一套偏好，不重新定义一套规则。

### 5.3 缺失镜头策略

建议默认采用严格模式：

- 任一镜头缺视频，合并导出直接失败并提示缺失项
- 合并播放可提供“仅播放已完成镜头”的降级模式，但默认不自动跳过

原因：

- 跳过缺失镜头会改变叙事节奏
- 合并导出是用户显式要一个单文件结果，不能静默缺帧

### 5.4 存储与数据

合并导出产物建议使用独立的 episode 级结果字段保存：

- `mergeStatus`
- `mergeOutputUrl`
- `mergeTaskId`
- `mergeErrorMessage`

当前实现先通过任务结果返回 `outputUrl` / `downloadUrl`，未额外写入 episode 级持久化字段；如果后续需要“刷新后可直接恢复导出状态”，再补这组字段即可。

### 5.5 部署要求

合并导出需要：

- `ffmpeg`
- 临时目录
- 任务超时控制
- 清理策略
- 输出文件大小限制

如果这些条件不满足，只保留 zip 和合并播放，不开放合并导出。

当前 `Dockerfile` 运行镜像已安装 `ffmpeg`，Alpine 包会同时提供 `ffprobe`；本地非 Docker 启动时仍需要开发机自行安装 `ffmpeg/ffprobe` 并确保命令在 `PATH` 中。

## 6. 代码落点建议

### 首尾帧播放修复

- [`VideoPanelCardBody.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardBody.tsx)
- [`VideoPanelCardHeader.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardHeader.tsx)
- [`videoPanelRuntimeCore.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/videoPanelRuntimeCore.tsx)

### 合并播放

- [`VideoToolbar.tsx`](../../src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/VideoToolbar.tsx)
- [`MergedVideoPlaylistModal.tsx`](../../src/lib/novel-promotion/stages/video-stage-runtime/MergedVideoPlaylistModal.tsx)
- [`video-proxy/route.ts`](../../src/app/api/novel-promotion/[projectId]/video-proxy/route.ts)

### 合并导出

- 复用 `download-videos` 的视频顺序和源选择规则
- 新增独立导出任务
- worker 侧增加视频拼接实现

## 7. 验收标准

1. 首尾帧生成完成后，用户能从首帧卡片直接播放。
2. 尾帧卡片不再让用户误以为它应该承载播放入口。
3. 合并播放能按镜头顺序连续播放，下一镜头加载期间播放画布不缩小或消失。
4. 合并导出能生成单个 `mp4`。
5. `zip` 下载行为不变。
6. 合并导出和首尾帧播放都不影响现有单镜头播放。
7. 失败时有明确错误信息，不做静默降级。

## 8. 结论

最终方案口径是：

- 首尾帧播放问题：修 UI 入口，不改数据归属。
- 多镜头视频需求：先做合并播放，再做异步合并导出。
- `zip` 保留为原始批量下载，不改语义。
- 合并导出只作为显式增强能力，不覆盖现有下载逻辑。

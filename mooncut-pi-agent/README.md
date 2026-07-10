# MoonCut Pi Video Editor

一个基于 `earendil-works/pi` SDK 的完整口播剪辑智能体。它接受真实视频，自动完成视觉分析、字幕、跟脸、语义分镜、Remotion 渲染和成片验证，并通过 HTTP 返回任务状态与产物。

## 已接入的制作链路

```text
外部客户端
  → 上传源视频 / 创建异步任务
  → Pi + GLM-5.2 规划并调用专用工具
  → MiniMax-M3（失败回退 MiMo-v2.5）分析六宫格画面
  → 可选：真实 Playwright 官网浏览 / 可信 X 原帖截图
  → Hybrid Subtitle / 已校正字幕哈希复用
  → MoonCut YOLO 人脸跟踪
  → mooncut.edit.v1 语义分镜 Spec
  → AgentTalkingHeadVideo / Remotion
  → ffprobe + 成片六宫格验收
  → MP4、Spec、字幕、跟脸、日志与 QA 产物
```

智能体使用固定的 [SPEC.md](./SPEC.md)，只开放八个受控工具（含只读 Skill、真实网页和可信 X 证据能力），不给模型任意 shell 权限。Pi 依赖固定为 `0.80.6`，官方仓库的只读审查副本位于 `../external/pi`，没有修改上游代码。

内嵌 Pi 会实际发现并按需读取三个项目 Skill：

- `mooncut-editor`：完整口播制作流程；
- `browser-evidence`：在真实 Playwright 浏览器中打开官网，保存长截图、页面快照和证据 JSON；
- `x-post-evidence`：从可信账号白名单搜索或打开 X 原帖，保存未经改造的原生帖子截图和 trust evidence。

浏览与 X 不是“提示词能力”：它们分别绑定 `capture_web_page` 和 `capture_x_post` 专用工具。产物会进入 `evidenceAssets`，由 Remotion 的 `evidence` beat 在原生 Safari 场景中直接显示。不会把拟真 X 卡片当成来源证据。

## 安装与启动

要求：Node.js 22.19+、FFmpeg、已安装依赖的 `../remotion-studio`，以及可选的 `../face-tracker/.venv`。

```bash
cd mooncut-pi-agent
npm install --ignore-scripts
cp .env.example .env
```

在 `.env` 中设置本地网关密钥：

```dotenv
MOONCUT_GATEWAY_BASE_URL=http://localhost:8080/v1
MOONCUT_GATEWAY_API_KEY=your-key
MOONCUT_PLANNER_MODEL=glm-5.2
MOONCUT_VISION_MODELS=minimax-m3,mimo-v2.5
```

启动外部接口：

```bash
npm run serve
```

默认监听 `http://127.0.0.1:4317`。

## HTTP 调用

### 1. 上传视频

请求体是原始二进制，不需要 multipart：

```bash
curl --data-binary @talking-head.mp4 \
  'http://127.0.0.1:4317/v1/assets?filename=talking-head.mp4'
```

返回：

```json
{"assetId":"...","filename":"talking-head.mp4","bytes":123456}
```

### 2. 创建剪辑任务

```bash
curl -X POST http://127.0.0.1:4317/v1/edit-jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "assetId":"上一步的 assetId",
    "title":"产品发布口播",
    "prompt":"重点突出发布信息，并安排一次全屏啪一下文字"
  }'
```

也可以在同一台机器上直接传绝对路径：

```json
{"inputPath":"/absolute/path/talking-head.mp4","prompt":"按默认规范剪辑"}
```

### 3. 查询状态

```bash
curl http://127.0.0.1:4317/v1/edit-jobs/JOB_ID
```

进度阶段依次为 `inspecting-source`、`transcribing`、`tracking-speaker`、`planning-edit`、`rendering`、`verifying`、`completed`。

### 4. 下载产物

```bash
curl -o final.mp4 \
  http://127.0.0.1:4317/v1/edit-jobs/JOB_ID/artifacts/video

curl -o edit-spec.json \
  http://127.0.0.1:4317/v1/edit-jobs/JOB_ID/artifacts/editSpec
```

可用产物包括 `video`、`editSpec`、`subtitles`、`faceTrack`、`sourceInspection`、`sourceContactSheet`、`finalContactSheet`、`verification`、`renderProps`、`renderLog`、`piEvents` 和 `agentSummary`。

完整接口契约见 [openapi.yaml](./openapi.yaml)。

## 命令行单任务

```bash
npm run edit -- /absolute/path/talking-head.mp4 '按默认原生 macOS 规范剪辑'
```

列出本地网关模型和当前路由：

```bash
npm run models
```

## 默认视觉规范

- Sonoma 壁纸是全局桌面背景。
- 浏览器、编辑器、信息页和人物小窗统一使用原生 macOS 窗口骨架。
- 真视频、手机、海报和全屏重点文字可不套窗口。
- 官方网页和 X 原帖优先使用真实浏览器截图；网页长图在 Safari 窗口内做帧驱动滚动。
- 重点文字使用短促的全屏聚焦、冲击环和低强度白闪；`impactAtMs` 会对齐逐词字幕中的口播关键词，形成真正同步的“文字铺满后啪一下”。
- 每 8 秒最多一个全屏冲击，避免口播被特效淹没。
- 字幕按真实时间段显示，关键词使用当前场景强调色。

## 降级策略

- `minimax-m3` 视觉请求失败时自动回退 `mimo-v2.5`。
- 命中已知源视频 SHA-256 时复用仓库内已校正字幕。
- 字幕服务不可用时继续做视觉剪辑，但不会臆造逐句字幕。
- 跟脸不可用时使用稳定居中裁切，仍继续渲染。
- 所有任务串行渲染，避免多条 1080p Remotion 任务同时抢占内存。

## 验证

```bash
npm run typecheck
npm test
```

每个成功任务还会自动验证编码、分辨率、时长和音频，并生成最终六宫格联系表。

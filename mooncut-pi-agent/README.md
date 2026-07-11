# MoonCut Pi Video Editor

一个完整口播剪辑智能体。它接受真实视频，自动完成视觉分析、字幕、跟脸、语义分镜、Remotion 渲染和成片验证，并通过 HTTP 返回任务状态与产物。

规划器可切换（同一套任务 API 与工具）：

| `MOONCUT_AGENT_EXECUTION_MODE` | 说明 |
|---|---|
| `reliable`（默认） | 确定性流水线，生产默认 |
| `pi` | Pi coding-agent + MoonCut tools（实验） |
| `grok` | **Grok Build 非交互式 Agent** + 同一套 MoonCut tools（Pi 替代路径） |

Grok 模式说明见 [docs/GROK_AGENT.md](./docs/GROK_AGENT.md)。一键本地剪辑：

```bash
MOONCUT_AGENT_EXECUTION_MODE=grok npm run edit -- /path/to/video.mp4 "按 SPEC 完整剪辑"
# 或
npm run edit:grok -- /path/to/video.mp4 "按 SPEC 完整剪辑"
```

## 已接入的制作链路

```text
外部客户端
  → 上传源视频 / 创建异步任务
  → 规划器（reliable / Pi / Grok）调用同一套专用工具
  → MiniMax-M3（失败回退 MiMo-v2.5）分析六宫格画面
  → 保守视觉调度：默认 0 张，确有抽象示例素材缺口时生成 1–2 张
  → 可选：真实 Playwright 官网浏览 / 可信 X 原帖截图
  → Hybrid Subtitle（MiMo 文本 + 声学时间轴）
  → MoonCut YOLO 人脸跟踪
  → mooncut.edit.v1 语义分镜 Spec
  → AgentTalkingHeadVideo / Remotion
  → ffprobe + 成片六宫格验收
  → MP4、Spec、字幕、跟脸、日志与 QA 产物
  → 用户主动选择后写入 SQLite 社区，并通过 Range 接口播放
```

智能体使用固定的 [SPEC.md](./SPEC.md) 与受控工具（含按需示例图调度、只读 Skill、真实网页和可信 X 证据能力）。Pi 模式依赖固定为 `0.80.6`；Grok 模式通过本机 `grok` CLI 编排，工具实现与 reliable/Pi 共享。

内嵌 Pi 会实际发现并按需读取三个项目 Skill：

- `mooncut-editor`：完整口播制作流程；
- `browser-evidence`：在真实 Playwright 浏览器中打开官网，保存长截图、页面快照和证据 JSON；
- `x-post-evidence`：从可信账号白名单搜索或打开 X 原帖，保存未经改造的原生帖子截图和 trust evidence。

浏览与 X 不是“提示词能力”：它们分别绑定 `capture_web_page` 和 `capture_x_post` 专用工具。产物会进入 `evidenceAssets`，由 Remotion 的 `evidence` beat 在原生 Safari 场景中直接显示。不会把拟真 X 卡片当成来源证据。

生图也不是无约束能力：`schedule_generated_visuals` 在转写后独立判断素材缺口，默认返回 0 张，单任务硬上限为 2 张。只有抽象或假设示例可以生成；真实人物、新闻、产品事实、数据、界面与官方声明必须使用真实素材或文字表达。生成结果使用独立 `generatedVisuals` / `illustration` 数据类型，画面永久显示“AI 生成示例 · 非事实证据”，不能混入 `evidenceAssets`。

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

# 可选：OpenAI-compatible POST /images/generations
MOONCUT_IMAGE_BASE_URL=https://image-provider.example/v1
MOONCUT_IMAGE_API_KEY=your-image-api-key
MOONCUT_IMAGE_MODEL=your-image-model
MOONCUT_IMAGE_MAX_IMAGES=2

# 规划器：reliable | pi | grok
# MOONCUT_AGENT_EXECUTION_MODE=grok
# MOONCUT_GROK_MODEL=grok-4.5
# MOONCUT_GROK_REASONING_EFFORT=max
```

启动外部接口：

```bash
npm run serve
```

默认监听 `http://127.0.0.1:4317`。

账户、会话和社区发布记录默认保存在 `./data/mooncut.sqlite`，可通过 `MOONCUT_DATABASE_PATH` 调整。用户只需邮箱和至少 8 位密码即可注册，不做邮箱验证；密码使用带随机盐的 scrypt 哈希保存，浏览器会话使用 HttpOnly Cookie。SQLite 只记录用户主动发布的质检通过成片；历史任务不会自动公开。

Web 端会自动完成注册、登录和 Cookie 会话管理。HTTP 客户端也可以保存 Cookie：

```bash
curl -c mooncut.cookies -X POST http://127.0.0.1:4317/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"creator@example.com","password":"change-me-123"}'

curl -b mooncut.cookies http://127.0.0.1:4317/v1/models
```

生产环境启用 HTTPS 时设置 `MOONCUT_COOKIE_SECURE=true`。配置了 `MOONCUT_API_KEY` 的可信服务仍可用 Bearer Key 调用所有接口；浏览器用户只能访问归属于自己的素材、任务、产物与邮件操作。

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
    "prompt":"重点突出发布信息，并安排一次全屏啪一下文字",
    "imageGeneration":"auto"
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

进度阶段依次为 `inspecting-source`、`transcribing`、`scheduling-visuals`、`tracking-speaker`、`planning-edit`、`rendering`、`verifying`、`completed`。

### 4. 下载产物

```bash
curl -o final.mp4 \
  http://127.0.0.1:4317/v1/edit-jobs/JOB_ID/artifacts/video

curl -o edit-spec.json \
  http://127.0.0.1:4317/v1/edit-jobs/JOB_ID/artifacts/editSpec
```

可用产物包括 `video`、`editSpec`、`subtitles`、`faceTrack`、`sourceInspection`、`sourceContactSheet`、`finalContactSheet`、`verification`、`renderProps`、`renderLog`、`piEvents`、`agentSummary` 和 `imageGeneration`；若确实生成了示例图，还会有 `generated-*` 与 `generated-meta-*` 产物。

### 5. 人工字幕修复与版本历史

对一个已完成任务提交 `POST /v1/edit-jobs/{jobId}/subtitle-repairs`，请求体为 `instruction` 和可选的 `atMs`、`replacementText`。修复 Agent 只读取该版本的带时间戳字幕，输出逐段 `before → after` 清单，再继承原分镜/跟脸配置完成重渲染与 QA。每次修复都是一个新的任务，原成片不被覆盖；使用 `GET /v1/edit-jobs/{jobId}/subtitle-repairs` 可获得同一根版本下的全部修订任务。修订任务额外有 `subtitleRepair` 产物，记录人工反馈、模型与实际应用的字幕变更。

完整接口契约见 [openapi.yaml](./openapi.yaml)。

### 5. 社区浏览与发布

```bash
curl http://127.0.0.1:4317/v1/community/posts

curl -X POST http://127.0.0.1:4317/v1/community/posts \
  -H 'Content-Type: application/json' \
  -d '{"jobId":"已完成任务ID","authorName":"创作者","title":"我的口播","caption":"想分享的一句话"}'
```

同一任务重复发布会返回已有帖子，不会产生重复记录。只有 `quality.ok=true` 且成片文件仍存在的任务能够发布；视频地址支持 HTTP Range。

### 6. 实时运行队列

登录后的 Web 端包含独立“队列”页面，每 3 秒读取一次 `/v1/render-queue`，展示运行中、排队中、今日完成、阶段进度和最近动态。共享队列仅使用系统生成的友好匿名名称（例如“星火 · 知识表达 · 10:19”），不会返回用户邮箱、原始文件名或任务哈希；当前用户自己的任务会额外显示“我的任务”。

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
- AI 示例图只用于难找素材的抽象举例，默认不用、通常 1 张、最多 2 张，并在成片中明确披露其生成属性。
- 重点文字使用短促的全屏聚焦、冲击环和低强度白闪；`impactAtMs` 会对齐逐词字幕中的口播关键词，形成真正同步的“文字铺满后啪一下”。
- 每 8 秒最多一个全屏冲击，避免口播被特效淹没。
- 字幕按真实时间段显示，关键词使用当前场景强调色。

## 降级策略

- `minimax-m3` 视觉请求失败时自动回退 `mimo-v2.5`。
- 多个 impact/evidence 视觉门禁并行执行；单模型请求默认 120 秒超时，避免坏网关无限挂起。
- 视觉模型结构化输出协议失败会原地重试 `verify_render`，不会误触发一次昂贵的重新渲染。
- `MOONCUT_ALLOW_KNOWN_SUBTITLE_FIXTURES=true` 时，开发环境可复用仓库内的已校正字幕；线上默认关闭，所有上传都会走 Hybrid Subtitle。
- 线上设置 `MOONCUT_REQUIRE_SUBTITLE_SERVICE=true`：字幕服务不可用或识别失败会明确失败，不会静默降级为较低准确度的本地识别。
- 线上默认 `MOONCUT_AGENT_EXECUTION_MODE=reliable`：画面分析、可选视觉调度和质检仍使用模型，但探测、字幕、人脸、完整分镜、渲染和验证不会依赖会话式 Agent 恰好继续调用工具。需要实验开放式 Pi 策略时才设为 `pi`。
- 默认服务器成片规格为 `1920×1080 @ 30fps`；它可通过 `MOONCUT_RENDER_WIDTH`、`MOONCUT_RENDER_HEIGHT`、`MOONCUT_RENDER_FPS` 调整。低规格输出必须由部署显式指定。
- 跟脸不可用时使用稳定居中裁切，仍继续渲染。
- 所有任务串行渲染，避免多条全高清 Remotion 任务同时抢占内存。
- 每条排队/运行任务记录本机 `ownerPid`；另一个服务实例启动时不会把仍由活进程处理的任务误判成中断。

## 验证

```bash
npm run typecheck
npm test
```

每个成功任务还会自动验证编码、分辨率、时长和音频，并生成最终六宫格联系表。

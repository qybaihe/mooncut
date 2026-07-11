# MoonCut 剪辑 API 接入文档

## 服务信息

- API Base URL：`https://42.194.219.172`
- 在线快速文档：`https://42.194.219.172/docs`
- OpenAPI：`https://42.194.219.172/openapi.yaml`
- 协议：HTTPS（私有 CA，客户端需信任随交付包提供的 `mooncut-ca.crt`）
- 鉴权：`Authorization: Bearer <MOONCUT_API_KEY>`
- 单文件上限：1 GiB
- 任务模型：异步；提交后轮询状态，成功后下载 MP4
- 默认保留：成片、上传素材和任务日志保留 7 天

API Key 和 CA 证书不进入 Git。部署后客户端凭据保存在本机 `~/.config/mooncut/server-client.env`，CA 位于 `~/.config/mooncut/mooncut-ca.crt`。

## 最简调用

### 1. 上传并创建任务

请求体直接是视频二进制，不使用 multipart：

```bash
source ~/.config/mooncut/server-client.env

curl --cacert "$MOONCUT_CA_CERT" \
  -H "Authorization: Bearer $MOONCUT_API_KEY" \
  -H "Content-Type: video/mp4" \
  --url-query "filename=talking-head.mp4" \
  --url-query "prompt=按默认原生 macOS 规范剪辑，重点突出产品发布" \
  --data-binary @talking-head.mp4 \
  "$MOONCUT_API_BASE/v1/edits"
```

响应：

```json
{
  "id": "JOB_ID",
  "status": "queued",
  "assetId": "ASSET_ID",
  "statusUrl": "https://42.194.219.172/v1/edit-jobs/JOB_ID",
  "videoUrl": "https://42.194.219.172/v1/edit-jobs/JOB_ID/artifacts/video"
}
```

也可以增加 `notificationEmail=user@example.com`。邮件必须经过 `mail/prepare` 与 `confirm` 两步确认，API 不会静默对外发送。

邮件属于可插拔通知层，可通过 `GET /v1/mail/status` 检查。当前服务器未安装 Agent Mail CLI 时会返回 `authorized=false` 而不是影响剪辑任务；后续邮件线程可以安装 CLI，或设置 `MOONCUT_MAIL_TRANSPORT=webhook` 及 webhook 凭据后重启服务，无需修改剪辑 API。

可增加 `imageGeneration=auto`（默认）或 `imageGeneration=off`。`auto` 不是强制生图：调度器默认 0 张，只在难找素材的抽象示例确有价值时生成，单任务最多 2 张。

### 2. 查询进度

```bash
curl --cacert "$MOONCUT_CA_CERT" \
  -H "Authorization: Bearer $MOONCUT_API_KEY" \
  "$MOONCUT_API_BASE/v1/edit-jobs/JOB_ID"
```

主要状态：

| `status` | 含义 |
|---|---|
| `queued` | 已进入串行队列 |
| `running` | Agent 正在执行 |
| `completed` | 成片及 QA 已完成 |
| `failed` | 任务失败，`error` 给出安全化摘要 |

`stage` 会依次出现：`inspecting-source`、`transcribing`、`scheduling-visuals`、可选的 `researching-x` / `browsing-web`、`tracking-speaker`、`planning-edit`、`rendering`、`visual-quality-review`、`verified`、`completed`。

## 人工字幕修订

完成成片后，可以把人工反馈交给字幕修复 Agent。该接口不会覆盖原任务：它只继承已有的源素材、分镜和人物轨迹，先返回可审计的字幕改动记录，再渲染并质检一条新的版本任务。

```bash
curl --cacert "$MOONCUT_CA_CERT" \
  -H "Authorization: Bearer $MOONCUT_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "instruction":"12 秒处把 MoonCut 识别成了梦卡，请修正。",
    "atMs":12000,
    "replacementText":"MoonCut"
  }' \
  "$MOONCUT_API_BASE/v1/edit-jobs/JOB_ID/subtitle-repairs"
```

`instruction` 为必填（2–2000 字符），`atMs` 和 `replacementText` 可选。完成后查询新任务；其 `subtitleRepair.analysis.changes` 会列出每一处的原文、修正文本、时间段与原因。获取整个版本链：`GET /v1/edit-jobs/JOB_ID/subtitle-repairs`。

## 能力市场（Pi Capability Market）

能力市场让已登录用户为**自己的 Pi**安装已审核、带版本与权限的能力。安装不会在服务器运行时下载第三方代码，也不会把 shell 权限交给模型；系统只会解析 MoonCut 已部署的、签名的 release。

- `GET /v1/capabilities?query=`：公开浏览能力目录；若携带登录 Cookie，卡片会附带当前用户的安装状态。
- `GET /v1/capabilities/{slug}`：查看一个能力的 release、权限、适用任务和工具说明。
- `POST /v1/capabilities/{slug}/install`：把当前 release 安装到当前用户的默认 Pi profile。
- `GET /v1/me/capability-installations`：获取当前用户的真实安装状态。
- `PATCH /v1/me/capability-installations/{id}`：JSON `{"status":"enabled"}` 或 `{"status":"disabled"}`。
- `POST /v1/me/capability-installations/{id}/reconfirm`：release 增加权限后，由用户重新确认才可启用。
- `DELETE /v1/me/capability-installations/{id}`：卸载；历史调用审计和已完成任务快照仍会保留。
- `POST /v1/me/capability-installations/{id}/preflight`：无副作用地检查已部署 CLI 及其官方来源访问链路；不生成 artifact、不写入调用审计。
- `POST /v1/me/capability-installations/{id}/invoke`：由用户明确发起一次受控能力调用。
- `GET /v1/capability-invocations?installationId=`：查看当前用户自己的调用记录与来源。

首个官方 release 是 `fifa-official-highlights`。它只暴露两种受控工具：`fifa_find_highlights`（只读查询）和 `fifa_match_context`（可选中文赛况）。所有 CLI 参数由宿主用 argv 数组白名单构造；不允许 `--download`、`--open`、任意输出路径或 shell 拼接。

生成截图属于写入任务产物，必须由用户在明确提示后传递 `confirmedArtifact: true`：

```bash
curl --cookie mooncut-session.txt \
  -H 'Content-Type: application/json' \
  -d '{
    "tool":"fifa_match_context",
    "input":{"matchId":"M95","includeChineseContext":true,"screenshotView":"ratings"},
    "confirmedArtifact":true
  }' \
  "$MOONCUT_API_BASE/v1/me/capability-installations/INSTALLATION_ID/invoke"
```

响应中的 artifact 是一个当前用户可访问的 HTTP URL；绝不包含服务器路径。若没有明确确认，带 `screenshotView` 的调用返回 `ARTIFACT_CONFIRMATION_REQUIRED`。Pi 会话可使用已选定能力的只读工具，但不能自行越过此确认门。

创建 JSON 编辑任务时可传递 `capabilityInstallIds`（最多 4 个），系统会把 package/release/hash 写进 job snapshot。任务开始时仍会检查该安装是否保持启用，以保证禁用或卸载立即生效。可选的 `capabilityRequests` 只接受已被选中的 installation，且当前 V1 最多一个用户确认的预处理请求。

管理发布接口仅接受服务 API key：

- `POST /v1/admin/capability-packages`
- `POST /v1/admin/capability-packages/{packageId}/releases`
- `POST /v1/admin/capability-releases/{releaseId}/yank`

release 由 canonical manifest 的 SHA-256 和服务端签名保护；同一 package/version 不可覆盖。当前可上架的形式是经过审核的 `hosted-cli` 适配器和 `skill-only` 工作流；第三方可执行代码及未审核的 HTTP 适配器不会被市场接受。

## 创作案例（原 Community）

- `GET /v1/community/posts?limit=12`：浏览用户主动发布的作品；可使用返回的 `nextCursor` 翻页。
- `POST /v1/community/posts`：传入 `jobId` 以及可选的 `authorName`、`title`、`caption`，发布质检通过的完成任务。
- `GET /v1/community/posts/{postId}/video`：支持 HTTP Range 的成片播放地址。
- `GET /v1/community/posts/{postId}/poster`：预览图。

社区记录使用 SQLite，默认文件为 `data/mooncut.sqlite`。同一任务发布是幂等的；历史任务不会自动公开。

成功响应中的 `result.artifacts` 已经是可直接请求的 HTTPS URL，不包含服务器内部文件路径。

### 3. 下载视频

```bash
curl --cacert "$MOONCUT_CA_CERT" \
  -H "Authorization: Bearer $MOONCUT_API_KEY" \
  -o final.mp4 \
  "$MOONCUT_API_BASE/v1/edit-jobs/JOB_ID/artifacts/video"
```

其他常用产物：`editSpec`、`subtitles`、`faceTrack`、`sourceContactSheet`、`finalContactSheet`、`verification`、`qualityReview`、`agentSummary`。人工字幕修订任务还会提供 `subtitleRepair`，其中含反馈与 Agent 的改动清单。

## 两阶段调用

需要复用同一个素材时，可以先上传：

```bash
curl --cacert "$MOONCUT_CA_CERT" \
  -H "Authorization: Bearer $MOONCUT_API_KEY" \
  -H "Content-Type: video/mp4" \
  --data-binary @talking-head.mp4 \
  "$MOONCUT_API_BASE/v1/assets?filename=talking-head.mp4"
```

再创建任务：

```bash
curl --cacert "$MOONCUT_CA_CERT" \
  -H "Authorization: Bearer $MOONCUT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"assetId":"ASSET_ID","prompt":"按默认规范剪辑"}' \
  "$MOONCUT_API_BASE/v1/edit-jobs"
```

服务器禁止外部调用者提交 `inputPath`，避免读取服务器任意本地文件。

## JavaScript 示例

```js
const video = await Bun.file("talking-head.mp4").arrayBuffer();
const create = await fetch(
  `${base}/v1/edits?filename=talking-head.mp4&prompt=${encodeURIComponent(prompt)}`,
  {
    method: "POST",
    headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "video/mp4"},
    body: video,
  },
);
const job = await create.json();

while (true) {
  const status = await fetch(job.statusUrl, {
    headers: {Authorization: `Bearer ${apiKey}`},
  }).then((response) => response.json());
  if (status.status === "completed") break;
  if (status.status === "failed") throw new Error(status.error);
  await Bun.sleep(5000);
}
```

浏览器、iOS 和 Android 客户端应把私有 CA 证书加入应用信任配置；不要通过关闭 TLS 校验来接入生产服务。

## 错误码

| HTTP | 含义 |
|---|---|
| `400` | 参数或空视频错误 |
| `401` | API Key 缺失或无效 |
| `403` | Origin 不允许或使用了禁用的 `inputPath` |
| `413` | 视频超过上传限制 |
| `415` | 不支持的文件扩展名 |
| `429` | 提交过快或任务队列已满 |
| `500` | 内部错误；响应中的 `requestId` 用于查日志 |

## 安全约束

- API Key 只存放在服务器 `EnvironmentFile` 和客户端 `0600` 凭据文件中。
- Nginx 仅把请求转发到监听 `127.0.0.1` 的 Agent；模型网关密钥不会返回客户端。
- HTTPS 证书包含服务器 IP SAN；客户端必须使用交付的 CA 验证证书。
- 所有 `/v1/*` 接口均要求 Bearer Key；只有 `/healthz`、`/docs` 和 `/openapi.yaml` 公开。
- Nginx 对提交接口限速，Agent 对排队数量设硬上限，并且 Remotion 固定单并发。
- 任务状态不会暴露 `inputPath`、`ownerPid`、内部产物路径或异常堆栈。
- X 原帖只接受可信账号与官方域名校验；网页证据拒绝挑战页和错误页。

## 运维

```bash
sudo systemctl status mooncut-agent
sudo journalctl -u mooncut-agent -f
sudo systemctl restart mooncut-agent
sudo nginx -t
```

应用目录：`/opt/mooncut`。运行环境：`/etc/mooncut/mooncut.env`。客户端 API Key 不应写入应用仓库。

服务器无法直接访问 Hugging Face 时，使用 `deploy/sync-whisper-model.sh` 从本机缓存同步 Faster Whisper 权重；运行时固定从 `/opt/mooncut/models/faster-whisper-small` 离线加载，不依赖外网下载模型。

字幕主链由 systemd 管理的 `hybrid-subtitle-service` 提供：MiMo 负责文本准确度，本地 Faster Whisper 负责词级时间轴；部署脚本为 `deploy/install-subtitle-service.sh`。如果以后补充 Deepgram Key，只需把 `TIMESTAMP_PROVIDER` 改为 `auto`，服务会自动恢复 MiMo + Deepgram 的完整混合时间轴。Agent 对字幕任务的默认等待时间为 45 分钟，可覆盖长视频分段转写。线上还设置 `MOONCUT_REQUIRE_SUBTITLE_SERVICE=true` 与 `MOONCUT_ALLOW_KNOWN_SUBTITLE_FIXTURES=false`，因此不会因演示素材命中缓存而绕过 ASR，也不会静默降级为本地 Whisper 文本。

成片时长严格来自上传视频的探测结果，编辑分镜会覆盖从 0 到源视频末尾的完整时间轴，成片校验允许误差仅 1.2 秒。服务器的长视频渲染超时设为 2 小时（`MOONCUT_RENDER_TIMEOUT_MS=7200000`），避免口播被之前的 45 分钟进程上限截断。

当前服务器的默认交付规格为 **1280×720、24fps**（`MOONCUT_RENDER_WIDTH/HEIGHT/FPS`），保持 16:9 和完整源时长。需要 1080p 时可在独立的高内存渲染节点覆盖为 `1920/1080/30`，避免小型 API 节点产生严重 swap。

生产环境的 `MOONCUT_AGENT_EXECUTION_MODE=reliable` 把不可省略的剪辑阶段固定为可恢复的工作流，避免 Pi 会话式规划器在某个工具返回后停止推进任务；AI 画面分析、可选视觉调度和最终质检仍保留。需要测试开放式策略时可显式切换为 `pi`。

Remocn、Remotion Bits 和 Onda 保持在 Remotion 工程的 `extensions/remotion-community` 隔离目录；使用 `deploy/sync-remotion-extensions.sh` 同步到服务器，安装脚本会在启用服务前验证 Agent 实际引用的组件源码存在。

服务器上的 X/网页取证浏览器通过宿主机 Singbox 的私有 SOCKS 端点 `127.0.0.1:7897` 出网；该端口不对公网开放。

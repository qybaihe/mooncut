# AI 口播自动配乐服务（云雾 API）

这是一个可独立部署的 Node.js 服务，把「口播文案 + 视频时长」转换为适合对白下垫的原创纯音乐。它不依赖 Express 或数据库，适合先作为微服务接入已有剪辑系统。

处理流程：

1. 使用云雾的 OpenAI 兼容接口分析口播文案，得到情绪、BPM、乐器、风格和负面提示词；分析接口不可用时自动使用本地规则。
2. 调用云雾 Suno `/suno/submit/music` 创建纯音乐任务。
3. 轮询 `/suno/fetch/{task_id}`，兼容常见的多种返回结构。
4. 下载第一个候选音轨，通过 FFmpeg 循环/裁剪到视频时长，并应用默认 `-18 dB` 音量及淡入淡出。
5. 返回可被现有剪辑系统下载的 MP3 地址，同时保留第二个候选音轨信息。

## 快速启动

要求：Node.js 20+；如需精确时长处理，还需要 FFmpeg。使用 Docker 时 FFmpeg 已经内置。

```bash
cp .env.example .env
# 编辑未跟踪的 .env，至少填写 YUNWU_API_KEY 和 32 位以上随机 SERVICE_API_KEY
docker compose up -d --build
curl http://localhost:8787/health
```

不使用 Docker：

```bash
npm start
```

服务不需要 `npm install`，因为只使用 Node.js 内置模块。

## API

### 1. 预览配乐方案（可选）

```bash
curl -X POST http://localhost:8787/api/v1/bgm/plan \
  -H "Authorization: Bearer change-this-in-production" \
  -H "Content-Type: application/json" \
  -d '{
    "script": "今天我们介绍一款能自动剪辑口播视频的 AI 产品……",
    "durationSeconds": 75,
    "title": "AI 剪辑产品介绍",
    "styleHint": "modern technology",
    "moodHint": "confident and warm"
  }'
```

### 2. 创建配乐任务

```bash
curl -X POST http://localhost:8787/api/v1/bgm/jobs \
  -H "Authorization: Bearer change-this-in-production" \
  -H "Content-Type: application/json" \
  -d '{
    "script": "今天我们介绍一款能自动剪辑口播视频的 AI 产品……",
    "durationSeconds": 75,
    "title": "AI 剪辑产品介绍",
    "volumeDb": -18,
    "metadata": {"projectId": "project-123"}
  }'
```

接口立即返回 `202`：

```json
{
  "jobId": "...",
  "status": "QUEUED",
  "statusUrl": "/api/v1/bgm/jobs/..."
}
```

### 3. 查询任务

```bash
curl http://localhost:8787/api/v1/bgm/jobs/JOB_ID \
  -H "Authorization: Bearer change-this-in-production"
```

成功时核心字段如下：

```json
{
  "status": "SUCCEEDED",
  "result": {
    "audioUrl": "http://localhost:8787/api/v1/bgm/files/JOB_ID/bgm.mp3?token=一次性随机下载令牌",
    "providerAudioUrl": "https://cdn1.suno.ai/...mp3",
    "processed": true,
    "durationSeconds": 75,
    "volumeDb": -18
  }
}
```

状态依次为 `QUEUED → ANALYZING → SUBMITTING → GENERATING → PROCESSING → SUCCEEDED`，失败状态为 `FAILED`。

## 接入已有剪辑系统

把该服务放在「口播音频/字幕已经生成」之后、「最终 FFmpeg 合成」之前：

```text
口播文案 → TTS/录音 → 画面与字幕剪辑
    └→ POST /api/v1/bgm/jobs → 轮询任务 → 下载 bgm.mp3
                                      ↓
                         人声 + bgm.mp3 + 画面 → 最终导出
```

Node.js 调用示例：

```js
const baseUrl = "http://bgm-service:8787";
const headers = {
  Authorization: `Bearer ${process.env.BGM_SERVICE_API_KEY}`,
  "Content-Type": "application/json",
};

const created = await fetch(`${baseUrl}/api/v1/bgm/jobs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    script: project.voiceoverScript,
    durationSeconds: project.timelineDuration,
    title: project.title,
    metadata: { projectId: project.id },
  }),
}).then((r) => r.json());

let job;
do {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  job = await fetch(`${baseUrl}/api/v1/bgm/jobs/${created.jobId}`, { headers }).then((r) => r.json());
} while (!["SUCCEEDED", "FAILED"].includes(job.status));

if (job.status === "FAILED") throw new Error(job.error.message);
project.backgroundMusicUrl = job.result.audioUrl;
```

`audioUrl` 自带该任务的随机下载令牌，因此 FFmpeg 可以直接读取；任务查询接口本身仍必须使用 `SERVICE_API_KEY`。如果现有系统已经负责音频混合，可以直接使用返回的 `bgm.mp3`。如果需要自己混合人声，推荐使用 sidechain ducking，让口播出现时配乐自动降低：

```bash
ffmpeg -i voice.wav -i bgm.mp3 -filter_complex \
  "[1:a][0:a]sidechaincompress=threshold=0.04:ratio=10:attack=20:release=350[ducked];[0:a][ducked]amix=inputs=2:duration=first" \
  -c:a aac mixed.m4a
```

然后把 `mixed.m4a` 与无声画面复用：

```bash
ffmpeg -i silent-video.mp4 -i mixed.m4a -map 0:v -map 1:a -c:v copy -c:a aac -shortest final.mp4
```

## 云雾接口差异处理

默认实现采用云雾文档体系中常见的任务接口：

- 提交：`POST https://api.yunwu.ai/suno/submit/music`
- 查询：`GET https://api.yunwu.ai/suno/fetch/{task_id}`
- 鉴权：`Authorization: Bearer <API_KEY>`
- 默认模型：`chirp-v5`

云雾控制台可能按渠道调整域名、路径或可用模型。若你的控制台文档不同，只需修改：

```dotenv
YUNWU_BASE_URL=https://控制台给出的域名
YUNWU_SUNO_SUBMIT_PATH=/控制台给出的提交路径
YUNWU_SUNO_FETCH_PATH=/控制台给出的查询路径/{task_id}
YUNWU_SUNO_MODEL=控制台中可用的模型名
```

当前客户端兼容以下常见提交返回：`data: "task-id"`、`data.task_id`、`task_id`、`taskId`；也兼容 `data[].audio_url`、`tracks[].audio_url` 等查询结构。

## 生产注意事项

- `YUNWU_API_KEY` 永远只存后端环境变量，不要下发给浏览器或客户端 App。
- `SERVICE_API_KEY` 是启动必填项，缺失时服务会拒绝启动；它和 `YUNWU_API_KEY` 只能保存在服务端环境变量或未跟踪的 `.env` 中。
- Docker Compose 默认只绑定 `127.0.0.1:8787`。如需外部访问，使用带鉴权的反向代理或私网服务发现，不要直接把端口公开到互联网。
- 任务当前持久化到 `data/jobs.json`。单机足够；多实例部署时应替换为 Redis/PostgreSQL 队列。
- 默认只选第一个 Suno 候选音轨，第二个候选保留在 `result.alternatives`，可在业务 UI 中提供换一首功能。
- 上线商用前，请在云雾/Suno 当前套餐条款中确认生成音乐的商用授权、归属和使用限制。

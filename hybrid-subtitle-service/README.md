# Hybrid Subtitle API

一个可独立部署的异步字幕服务：MiMo 负责更准确的转写文本，Deepgram Nova-3 负责声学时间戳，服务再将两者对齐成逐字、分词和字幕段三层时间轴。

## 能力

- 上传 FFmpeg 可读取的音频或视频
- 自动转成 16 kHz、单声道 WAV
- 按静音切分长音频，并在切口两侧保留上下文
- MiMo 与 Deepgram 按片段并行识别
- 将 MiMo 文本投影到 Deepgram 时间戳
- 术语表增强，例如 `Codex,Codec,Remotion,ASR,TTS`
- 输出完整 JSON、SRT、WebVTT
- 异步任务查询、结果下载和可选服务 API Key 鉴权

## 本地启动

依赖 Python 3.12+ 和 FFmpeg。

```bash
cp .env.example .env
# 在 .env 中设置 MIMO_API_KEY、DEEPGRAM_API_KEY、SERVICE_API_KEY

uv sync --extra dev
set -a && source .env && set +a
uv run uvicorn hybrid_subtitle.app:app --host 0.0.0.0 --port 8000 --workers 1
```

接口文档：<http://127.0.0.1:8000/docs>

健康检查：

```bash
curl http://127.0.0.1:8000/healthz
```

## 创建字幕任务

`glossary` 与 `formats` 同时支持逗号分隔字符串和 JSON 字符串数组。

```bash
curl -X POST http://127.0.0.1:8000/v1/subtitle-jobs \
  -H "X-API-Key: $SERVICE_API_KEY" \
  -F "file=@./talking-head.mp4" \
  -F 'language=zh-CN' \
  -F 'glossary=["Codex","Codec","Remotion","ASR","TTS"]' \
  -F 'formats=json,srt,vtt'
```

服务立即返回 `202`：

```json
{
  "id": "e2b5...",
  "status": "queued",
  "status_url": "/v1/subtitle-jobs/e2b5..."
}
```

查询状态与下载结果：

```bash
curl -H "X-API-Key: $SERVICE_API_KEY" \
  http://127.0.0.1:8000/v1/subtitle-jobs/JOB_ID

curl -H "X-API-Key: $SERVICE_API_KEY" \
  http://127.0.0.1:8000/v1/subtitle-jobs/JOB_ID/result

curl -H "X-API-Key: $SERVICE_API_KEY" \
  -OJ http://127.0.0.1:8000/v1/subtitle-jobs/JOB_ID/artifacts/srt
```

也可以使用 `Authorization: Bearer $SERVICE_API_KEY`。

## JSON 时间轴

结果保留三个粒度：

```json
{
  "transcript": "讲到 Codec 的时候，需要自动弹出页面。",
  "segments": [
    {"index": 1, "text": "讲到 Codec 的时候，", "start_ms": 3120, "end_ms": 4800}
  ],
  "words": [
    {"text": "Codec", "start_ms": 3520, "end_ms": 4080, "confidence": 0.91}
  ],
  "characters": [
    {
      "text": "C",
      "original_index": 3,
      "start_ms": 3520,
      "end_ms": 3632,
      "confidence": 0.91,
      "source": "deepgram"
    }
  ],
  "alignment": {
    "exact_ratio": 0.96,
    "mapped_ratio": 0.99,
    "average_confidence": 0.91,
    "uncertain_ranges": []
  }
}
```

`source=interpolated` 表示 MiMo 中存在、但 Deepgram 中没有直接声学锚点的字符。调用方可以使用 `alignment.uncertain_ranges` 做人工复核或自动重试。

## Docker

```bash
cp .env.example .env
# 填写 .env
docker compose up --build -d
```

任务文件保存在 `./data/jobs`。当前后台队列运行在 API 进程内，因此必须使用一个 Uvicorn worker。服务重启时，未完成任务会被标记为失败；需要横向扩容时，可将 `JobManager` 换成 Redis/Celery 或云队列，ASR 和对齐层无需变化。

## 关键配置

| 环境变量 | 默认值 | 说明 |
|---|---:|---|
| `MAX_UPLOAD_MB` | `1024` | 上传上限 |
| `CHUNK_SECONDS` | `45` | 单个识别片段最大时长 |
| `CHUNK_OVERLAP_SECONDS` | `0.8` | 切片上下文重叠 |
| `CHUNK_CONCURRENCY` | `2` | 每个任务同时处理的片段数 |
| `JOB_CONCURRENCY` | `2` | 同时处理的长视频任务数 |
| `DEEPGRAM_MIP_OPT_OUT` | `false` | 是否退出 Deepgram 模型改进计划；可能影响计费 |
| `CORS_ORIGINS` | 空 | 允许的浏览器来源，逗号分隔 |

不要将真实供应商 Key 或 `SERVICE_API_KEY` 提交到仓库。对公网部署时必须设置 `SERVICE_API_KEY`，并建议在 HTTPS 反向代理后运行。

## 测试

```bash
uv run pytest
```

import fs from "node:fs";
import path from "node:path";

function loadDotEnv(filePath = path.resolve(".env")) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function integer(name, fallback, min = 0) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function requiredSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 必须通过未提交的环境变量或 .env 配置，服务拒绝以无鉴权模式启动`);
  }
  return value;
}

export function loadConfig() {
  loadDotEnv();
  const dataDir = path.resolve(process.env.DATA_DIR || "./data");
  return {
    host: process.env.HOST || "0.0.0.0",
    port: integer("PORT", 8787, 1),
    serviceApiKey: requiredSecret("SERVICE_API_KEY"),
    publicBaseUrl: trimSlash(process.env.PUBLIC_BASE_URL || ""),
    dataDir,
    audioDir: path.join(dataDir, "audio"),
    jobsFile: path.join(dataDir, "jobs.json"),
    yunwu: {
      apiKey: process.env.YUNWU_API_KEY || "",
      baseUrl: trimSlash(process.env.YUNWU_BASE_URL || "https://api.yunwu.ai"),
      submitPath: process.env.YUNWU_SUNO_SUBMIT_PATH || "/suno/submit/music",
      fetchPath: process.env.YUNWU_SUNO_FETCH_PATH || "/suno/fetch/{task_id}",
      model: process.env.YUNWU_SUNO_MODEL || "chirp-v5",
      analysisEnabled: bool("YUNWU_ANALYSIS_ENABLED", true),
      analysisPath: process.env.YUNWU_ANALYSIS_PATH || "/v1/chat/completions",
      analysisModel: process.env.YUNWU_ANALYSIS_MODEL || "gpt-4o-mini",
    },
    pollIntervalMs: integer("POLL_INTERVAL_MS", 5000, 500),
    generationTimeoutMs: integer("GENERATION_TIMEOUT_MS", 600000, 10000),
    maxConcurrentJobs: integer("MAX_CONCURRENT_JOBS", 2, 1),
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    bgmVolumeDb: number("BGM_VOLUME_DB", -18),
    fadeSeconds: Math.max(0, number("FADE_SECONDS", 1.5)),
    audioProcessingRequired: bool("AUDIO_PROCESSING_REQUIRED", false),
    downloadTimeoutMs: integer("DOWNLOAD_TIMEOUT_MS", 60000, 1000),
    providerFetchTimeoutMs: integer("YUNWU_FETCH_TIMEOUT_MS", 90000, 10000),
    maxAudioBytes: integer("MAX_AUDIO_BYTES", 50 * 1024 * 1024, 1024),
  };
}

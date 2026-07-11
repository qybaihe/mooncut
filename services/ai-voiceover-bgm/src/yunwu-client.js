import { ProviderError } from "./errors.js";
import { delay, joinUrl, safeJsonParse } from "./utils.js";

const SUCCESS = new Set(["SUCCESS", "SUCCEEDED", "COMPLETED", "COMPLETE"]);
const FAILURE = new Set(["FAILURE", "FAILED", "FAIL", "ERROR", "CANCELLED"]);

function unwrapTask(body) {
  if (!body || typeof body !== "object") return null;
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) return body.data;
  return body;
}

export function extractTaskId(body) {
  const candidates = [
    body?.task_id,
    body?.taskId,
    body?.id,
    typeof body?.data === "string" ? body.data : null,
    body?.data?.task_id,
    body?.data?.taskId,
    body?.data?.id,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}

export function normalizeTask(body) {
  const task = unwrapTask(body);
  if (!task) throw new ProviderError("云雾查询接口返回了空任务");
  const rawStatus = String(task.status ?? task.state ?? body?.status ?? "UNKNOWN").toUpperCase();
  const nested = task.data;
  let tracks = [];
  if (Array.isArray(nested)) tracks = nested;
  else if (Array.isArray(task.tracks)) tracks = task.tracks;
  else if (Array.isArray(task.clips)) tracks = task.clips;
  else if (
    nested &&
    typeof nested === "object" &&
    (nested.audio_url || nested.audioUrl || nested.cld2AudioUrl)
  ) {
    tracks = [nested];
  }
  const normalizedTracks = tracks
    .map((track) => ({
      id: track.id ?? track.clip_id ?? track.clipId ?? null,
      title: track.title ?? "",
      audioUrl: track.audio_url ?? track.audioUrl ?? track.cld2AudioUrl ?? track.url ?? null,
      imageUrl: track.image_url ?? track.imageUrl ?? track.cld2ImageUrl ?? null,
      videoUrl: track.video_url ?? track.videoUrl ?? track.cld2VideoUrl ?? null,
      durationSeconds: Number(track.duration ?? track.duration_seconds) || null,
      raw: track,
    }))
    .filter((track) => track.audioUrl);
  const succeeded = SUCCESS.has(rawStatus) || (normalizedTracks.length > 0 && rawStatus !== "FAILURE");
  const failed = FAILURE.has(rawStatus);
  return {
    taskId: task.task_id ?? task.taskId ?? task.id ?? null,
    status: failed ? "FAILED" : succeeded ? "SUCCEEDED" : "PROCESSING",
    providerStatus: rawStatus,
    progress: task.progress ?? null,
    failReason: task.fail_reason ?? task.failReason ?? task.error ?? body?.message ?? "",
    tracks: normalizedTracks,
    raw: body,
  };
}

export class YunwuClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  #headers() {
    if (!this.config.yunwu.apiKey) {
      throw new ProviderError("缺少 YUNWU_API_KEY，请先配置云雾 API 密钥");
    }
    return {
      Authorization: `Bearer ${this.config.yunwu.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async submitMusic(plan) {
    const url = joinUrl(this.config.yunwu.baseUrl, this.config.yunwu.submitPath);
    const payload = {
      prompt: plan.prompt,
      tags: plan.tags,
      negative_tags: plan.negativeTags,
      title: plan.title,
      mv: this.config.yunwu.model,
      make_instrumental: true,
    };
    const response = await this.fetch(url, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    const body = safeJsonParse(text);
    if (!response.ok) {
      throw new ProviderError(`云雾音乐任务提交失败 (${response.status})`, body || text.slice(0, 1000));
    }
    const taskId = extractTaskId(body);
    if (!taskId) throw new ProviderError("云雾接口未返回 task_id", body);
    return { taskId, payload, raw: body };
  }

  async fetchTask(taskId) {
    const pathname = this.config.yunwu.fetchPath.replace("{task_id}", encodeURIComponent(taskId));
    const response = await this.fetch(joinUrl(this.config.yunwu.baseUrl, pathname), {
      method: "GET",
      headers: this.#headers(),
      signal: AbortSignal.timeout(this.config.providerFetchTimeoutMs),
    });
    const text = await response.text();
    const body = safeJsonParse(text);
    if (!response.ok) {
      throw new ProviderError(`云雾音乐任务查询失败 (${response.status})`, body || text.slice(0, 1000));
    }
    return normalizeTask(body);
  }

  async waitForTask(taskId, onProgress = () => {}) {
    const startedAt = Date.now();
    let transientErrors = 0;
    while (Date.now() - startedAt < this.config.generationTimeoutMs) {
      try {
        const task = await this.fetchTask(taskId);
        transientErrors = 0;
        await onProgress(task);
        if (task.status === "SUCCEEDED") {
          if (!task.tracks.length) throw new ProviderError("音乐任务成功，但返回中没有 audio_url", task.raw);
          return task;
        }
        if (task.status === "FAILED") throw new ProviderError(task.failReason || "云雾音乐生成失败", task.raw);
      } catch (error) {
        if (error instanceof ProviderError && /生成失败|没有 audio_url/.test(error.message)) throw error;
        transientErrors += 1;
        if (transientErrors >= 3) throw error;
      }
      await delay(this.config.pollIntervalMs);
    }
    throw new ProviderError(`音乐生成超时（${Math.round(this.config.generationTimeoutMs / 1000)} 秒）`);
  }
}

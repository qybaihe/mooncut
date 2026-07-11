import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import { isoNow } from "./utils.js";

export class MusicService {
  constructor({ config, store, analyzer, client, audioProcessor }) {
    this.config = config;
    this.store = store;
    this.analyzer = analyzer;
    this.client = client;
    this.audioProcessor = audioProcessor;
    this.pending = [];
    this.active = 0;
    this.recovering = new Set();
  }

  async createJob(input) {
    const now = isoNow();
    const job = {
      id: randomUUID(),
      status: "QUEUED",
      progress: 0,
      input,
      plan: null,
      providerTaskId: null,
      providerStatus: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.create(job);
    this.pending.push(job.id);
    this.#drain();
    return job;
  }

  async previewPlan(input) {
    return this.analyzer.analyze(input);
  }

  async recoverJob(id) {
    const job = this.store.get(id);
    if (!job) throw new AppError("任务不存在", { statusCode: 404, code: "NOT_FOUND" });
    if (job.status === "SUCCEEDED") return job;
    if (!job.providerTaskId) {
      throw new AppError("任务尚未提交到云雾，无法恢复", { statusCode: 409, code: "NOT_RECOVERABLE" });
    }
    if (this.recovering.has(id)) return job;

    this.recovering.add(id);
    await this.store.update(id, { status: "GENERATING", error: null, progress: Math.max(job.progress || 0, 20) });
    this.#resume(id, job.providerTaskId).finally(() => this.recovering.delete(id));
    return this.store.get(id);
  }

  #drain() {
    while (this.active < this.config.maxConcurrentJobs && this.pending.length) {
      const id = this.pending.shift();
      this.active += 1;
      this.#run(id).finally(() => {
        this.active -= 1;
        this.#drain();
      });
    }
  }

  async #run(id) {
    const job = this.store.get(id);
    if (!job) return;
    try {
      await this.store.update(id, { status: "ANALYZING", progress: 5 });
      const plan = await this.analyzer.analyze(job.input);
      await this.store.update(id, { plan, status: "SUBMITTING", progress: 15 });

      const submitted = await this.client.submitMusic(plan);
      await this.store.update(id, {
        providerTaskId: submitted.taskId,
        status: "GENERATING",
        providerStatus: "SUBMITTED",
        progress: 20,
      });

      await this.#resume(id, submitted.taskId);
    } catch (error) {
      await this.#markFailed(id, error);
    }
  }

  async #resume(id, providerTaskId) {
    try {
      const providerTask = await this.client.waitForTask(providerTaskId, async (task) => {
        const parsed = Number.parseInt(String(task.progress || "").replace("%", ""), 10);
        const progress = Number.isFinite(parsed) ? 20 + Math.round(parsed * 0.65) : 45;
        await this.store.update(id, { providerStatus: task.providerStatus, progress: Math.min(progress, 85) });
      });

      const job = this.store.get(id);
      if (!job) throw new AppError("任务不存在", { statusCode: 404, code: "NOT_FOUND" });
      await this.store.update(id, { status: "PROCESSING", progress: 88 });
      const selectedTrack = providerTask.tracks[0];
      const prepared = await this.audioProcessor.prepare(
        id,
        selectedTrack,
        job.input.durationSeconds,
        job.input.volumeDb,
      );
      const downloadToken = randomUUID();
      const relativeAudioUrl = `/api/v1/bgm/files/${encodeURIComponent(id)}/${prepared.filename}?token=${encodeURIComponent(downloadToken)}`;
      await this.store.update(id, {
        status: "SUCCEEDED",
        progress: 100,
        result: {
          audioUrl: this.config.publicBaseUrl ? `${this.config.publicBaseUrl}${relativeAudioUrl}` : relativeAudioUrl,
          providerAudioUrl: selectedTrack.audioUrl,
          processed: prepared.processed,
          durationSeconds: prepared.durationSeconds,
          volumeDb: prepared.volumeDb,
          warning: prepared.warning || null,
          downloadToken,
          track: selectedTrack,
          alternatives: providerTask.tracks.slice(1),
        },
      });
    } catch (error) {
      await this.#markFailed(id, error);
    }
  }

  async #markFailed(id, error) {
    await this.store.update(id, {
      status: "FAILED",
      error: {
        code: error.code || "GENERATION_FAILED",
        message: error.message || "音乐生成失败",
        details: error.details,
      },
    });
  }
}

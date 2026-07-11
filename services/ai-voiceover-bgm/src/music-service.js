import { randomUUID } from "node:crypto";
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

      const providerTask = await this.client.waitForTask(submitted.taskId, async (task) => {
        const parsed = Number.parseInt(String(task.progress || "").replace("%", ""), 10);
        const progress = Number.isFinite(parsed) ? 20 + Math.round(parsed * 0.65) : 45;
        await this.store.update(id, { providerStatus: task.providerStatus, progress: Math.min(progress, 85) });
      });

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
}

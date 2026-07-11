import fs from "node:fs/promises";
import path from "node:path";
import { isoNow } from "./utils.js";

export class JobStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.jobs = new Map();
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      for (const job of Array.isArray(raw) ? raw : []) {
        if (!["SUCCEEDED", "FAILED"].includes(job.status)) {
          job.status = "FAILED";
          job.error = { code: "PROCESS_RESTARTED", message: "服务重启时任务尚未完成，请重新提交" };
          job.updatedAt = isoNow();
        }
        this.jobs.set(job.id, job);
      }
      await this.#persist();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  list() {
    return [...this.jobs.values()];
  }

  async create(job) {
    this.jobs.set(job.id, job);
    await this.#persist();
    return job;
  }

  async update(id, patch) {
    const current = this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: isoNow() };
    this.jobs.set(id, next);
    await this.#persist();
    return next;
  }

  async #persist() {
    const contents = JSON.stringify(this.list(), null, 2);
    const temp = `${this.filePath}.tmp`;
    this.writeChain = this.writeChain.then(async () => {
      await fs.writeFile(temp, contents, "utf8");
      await fs.rename(temp, this.filePath);
    });
    return this.writeChain;
  }
}

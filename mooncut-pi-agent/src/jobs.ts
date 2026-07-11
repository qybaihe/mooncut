import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rename, stat, writeFile} from "node:fs/promises";
import {basename, join, resolve} from "node:path";
import {runEditingAgent, runSubtitleRepairAgent} from "./agent.ts";
import {assetsRoot, config, jobsRoot} from "./config.ts";
import {copySourceIntoRemotion} from "./media.ts";
import {sendJobMailAutomatically} from "./mail.ts";
import type {
  AgentEditSpec,
  ArtifactMap,
  EditJobRecord,
  EditJobRequest,
  FaceTrackManifest,
  MailDelivery,
  RunContext,
  SubtitleData,
  SubtitleRepairFeedback,
} from "./types.ts";

const now = () => new Date().toISOString();

export const isProcessAlive = (pid: number | undefined) => {
  if (!Number.isInteger(pid) || (pid ?? 0) <= 0) return false;
  try {
    process.kill(pid!, 0);
    return true;
  } catch {
    return false;
  }
};

const safeAssetName = (value: string) => basename(value).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 120) || "upload.mp4";

const queueAdjectives = ["月光", "星火", "晴空", "云端", "青柠", "晚风", "极光", "晨曦"];
const queueKinds = ["观点口播", "灵感分享", "故事短片", "知识表达", "新作预告", "成长记录"];

export const friendlyJobName = (id: string, createdAt: string) => {
  const seed = Number.parseInt(id.slice(0, 8), 16) || 0;
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(createdAt));
  return `${queueAdjectives[seed % queueAdjectives.length]} · ${queueKinds[Math.floor(seed / 8) % queueKinds.length]} · ${time}`;
};

export type StoredAsset = {
  id: string;
  ownerUserId?: string;
  filename: string;
  path: string;
  bytes: number;
  createdAt: string;
};

export const assetDataPath = (id: string, filename: string) => join(assetsRoot, `${id}-${safeAssetName(filename)}`);
export const assetMetadataPath = (id: string) => join(assetsRoot, `${id}.json`);

export const saveAssetMetadata = async (asset: StoredAsset) => {
  await mkdir(assetsRoot, {recursive: true});
  await writeFile(assetMetadataPath(asset.id), `${JSON.stringify(asset, null, 2)}\n`);
};

export const readAsset = async (id: string): Promise<StoredAsset> => {
  const path = assetMetadataPath(id);
  if (!existsSync(path)) throw new Error(`Unknown asset: ${id}`);
  return JSON.parse(await readFile(path, "utf8")) as StoredAsset;
};

const jobPath = (id: string) => join(jobsRoot, id, "job.json");

export class JobManager {
  private queue = Promise.resolve();
  private persistenceQueue = Promise.resolve();
  private pendingJobs = 0;

  canAccept() {
    return this.pendingJobs < config.maxQueuedJobs;
  }

  async recoverInterruptedJobs() {
    await mkdir(jobsRoot, {recursive: true});
    for (const entry of await readdir(jobsRoot, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const path = jobPath(entry.name);
      if (!existsSync(path)) continue;
      try {
        const job = JSON.parse(await readFile(path, "utf8")) as EditJobRecord;
        if (job.status !== "running" && job.status !== "queued") continue;
        // Another local server instance may legitimately own this job. Do not
        // turn its live work into a false "interrupted" failure on startup.
        if (isProcessAlive(job.ownerPid)) continue;
        job.status = "failed";
        job.stage = "interrupted";
        job.error = "The agent process stopped before this job completed. Submit a new job to retry.";
        await this.persist(job);
      } catch {
        // Ignore non-job scratch directories and malformed historical fixtures.
      }
    }
  }

  async create(request: EditJobRequest, ownerUserId?: string): Promise<EditJobRecord> {
    if (!this.canAccept()) throw new Error(`Job queue is full (${config.maxQueuedJobs})`);
    let inputPath: string;
    let originalName: string;
    if (request.assetId) {
      const asset = await readAsset(request.assetId);
      if (ownerUserId && asset.ownerUserId !== ownerUserId) throw new Error("Unknown asset or asset access denied");
      inputPath = asset.path;
      originalName = asset.filename;
    } else if (request.inputPath) {
      inputPath = resolve(request.inputPath);
      originalName = basename(inputPath);
    } else {
      throw new Error("assetId or inputPath is required");
    }
    const sourceStat = await stat(inputPath);
    if (!sourceStat.isFile()) throw new Error(`Input is not a file: ${inputPath}`);

    const id = randomUUID().replaceAll("-", "");
    const timestamp = now();
    const job: EditJobRecord = {
      id,
      displayName: friendlyJobName(id, timestamp),
      ...(ownerUserId ? {ownerUserId} : {}),
      status: "queued",
      stage: "queued",
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      ownerPid: process.pid,
      inputPath,
      originalName,
      request,
      mail: request.notificationEmail ? {
        recipient: request.notificationEmail,
        status: "scheduled",
        updatedAt: timestamp,
      } : undefined,
    };
    await mkdir(join(jobsRoot, id), {recursive: true});
    await this.persist(job);
    this.pendingJobs += 1;
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => this.run(job));
    return job;
  }

  /** Queue a non-destructive caption-only version from a completed edit. */
  async createSubtitleRepair(parent: EditJobRecord, feedback: SubtitleRepairFeedback, ownerUserId?: string): Promise<EditJobRecord> {
    if (!this.canAccept()) throw new Error(`Job queue is full (${config.maxQueuedJobs})`);
    if (parent.status !== "completed" || !parent.result?.artifacts.subtitles || !parent.result.artifacts.editSpec) {
      throw new Error("Only a completed version with subtitle artifacts can be repaired");
    }
    const id = randomUUID().replaceAll("-", "");
    const timestamp = now();
    const rootJobId = parent.subtitleRepair?.rootJobId ?? parent.id;
    const {notificationEmail: _notificationEmail, ...baseRequest} = parent.request;
    const titleBase = parent.request.title?.trim() || parent.originalName.replace(/\.[^.]+$/u, "") || "MoonCut 成片";
    const job: EditJobRecord = {
      id,
      displayName: friendlyJobName(id, timestamp),
      ...(ownerUserId ? {ownerUserId} : parent.ownerUserId ? {ownerUserId: parent.ownerUserId} : {}),
      status: "queued",
      stage: "queued-subtitle-repair",
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      ownerPid: process.pid,
      inputPath: parent.inputPath,
      originalName: parent.originalName,
      request: {
        ...baseRequest,
        title: `${titleBase.slice(0, 48)} · 字幕修订`,
        prompt: [
          parent.request.prompt ?? "按默认 MoonCut 原生 macOS 口播规范剪辑",
          `人工字幕修复：${feedback.instruction}`,
          feedback.replacementText ? `正确字幕：${feedback.replacementText}` : "",
        ].filter(Boolean).join("\n"),
      },
      subtitleRepair: {
        parentJobId: parent.id,
        rootJobId,
        feedback,
      },
    };
    await mkdir(join(jobsRoot, id), {recursive: true});
    await this.persist(job);
    this.pendingJobs += 1;
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => this.run(job));
    return job;
  }

  async wait(id: string): Promise<EditJobRecord> {
    while (true) {
      const job = await this.get(id);
      if (job.status === "completed" || job.status === "failed") return job;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
  }

  async get(id: string): Promise<EditJobRecord> {
    const path = jobPath(id);
    if (!existsSync(path)) throw new Error(`Unknown job: ${id}`);
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return JSON.parse(await readFile(path, "utf8")) as EditJobRecord;
      } catch (error) {
        lastError = error;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      }
    }
    throw lastError;
  }

  async list(limit = 100): Promise<EditJobRecord[]> {
    await mkdir(jobsRoot, {recursive: true});
    const jobs: EditJobRecord[] = [];
    for (const entry of await readdir(jobsRoot, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      try {
        jobs.push(await this.get(entry.name));
      } catch {
        // Ignore scratch folders and incomplete historical fixtures.
      }
    }
    return jobs
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.min(250, Math.max(1, limit)));
  }

  async listSubtitleRepairs(job: EditJobRecord): Promise<EditJobRecord[]> {
    const rootJobId = job.subtitleRepair?.rootJobId ?? job.id;
    return (await this.list(250))
      .filter((candidate) => candidate.subtitleRepair?.rootJobId === rootJobId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async persist(job: EditJobRecord) {
    const snapshot = {...job, updatedAt: now()};
    job.updatedAt = snapshot.updatedAt;
    const operation = this.persistenceQueue.then(async () => {
      const path = jobPath(job.id);
      const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      await rename(temporaryPath, path);
    });
    this.persistenceQueue = operation.catch(() => undefined);
    await operation;
  }

  private async run(job: EditJobRecord) {
    const jobDir = join(jobsRoot, job.id);
    try {
      job.status = "running";
      job.stage = "preparing-source";
      job.progress = 0.02;
      await this.persist(job);
      if (job.subtitleRepair) {
        await this.runSubtitleRepair(job);
        return;
      }
      const copied = await copySourceIntoRemotion(job.inputPath, job.id);
      const context: RunContext = {
        job,
        jobDir,
        publicMediaPath: copied.path,
        publicMediaSrc: copied.src,
        evidenceAssets: [],
        generatedVisuals: [],
        qualityReviews: [],
      };
      const summary = await runEditingAgent(context, async (stage, progress) => {
        job.stage = stage;
        job.progress = progress;
        await this.persist(job);
      });
      if (!context.probe || !context.renderPath || !context.verificationPath || !context.spec) {
        throw new Error("Required artifacts are missing after agent completion");
      }
      const artifacts: ArtifactMap = {
        video: context.renderPath,
        editSpec: join(jobDir, "edit-spec.json"),
        subtitles: join(jobDir, "subtitles.json"),
        sourceInspection: join(jobDir, "source-inspection.json"),
        sourceContactSheet: join(jobDir, "source-contact-sheet.jpg"),
        finalContactSheet: join(jobDir, "final-contact-sheet.jpg"),
        verification: context.verificationPath,
        renderProps: join(jobDir, "render-props.json"),
        renderLog: join(jobDir, "render.log"),
        piEvents: join(jobDir, "pi-events.jsonl"),
        agentSummary: join(jobDir, "agent-summary.txt"),
        qualityReview: join(jobDir, `quality-review-${Math.max(1, context.qualityReviews.length)}.json`),
      };
      if (context.faceTrack) artifacts.faceTrack = join(jobDir, "face-track.json");
      for (const evidence of context.evidenceAssets) {
        artifacts[`evidence-${evidence.id}`] = evidence.localPath;
        artifacts[`evidence-meta-${evidence.id}`] = evidence.evidencePath;
      }
      if (context.imageSchedule) artifacts.imageGeneration = join(jobDir, "image-generation.json");
      for (const visual of context.generatedVisuals) {
        artifacts[`generated-${visual.id}`] = visual.localPath;
        artifacts[`generated-meta-${visual.id}`] = visual.metadataPath;
      }
      if (existsSync(join(jobDir, "learning-proposal.json"))) {
        artifacts.learningProposal = join(jobDir, "learning-proposal.json");
      }
      job.status = "completed";
      job.stage = "completed";
      job.progress = 1;
      job.result = {
        summary,
        artifacts,
        probe: context.probe,
        models: {
          planner: config.plannerModel,
          vision: context.visionModel ?? "unknown",
          ...(context.generatedVisuals.length > 0 ? {image: config.imageGenerationModel} : {}),
        },
        visuals: context.imageSchedule,
        quality: context.qualityReviews.at(-1),
      };
      if (job.mail) {
        if (config.mailTransport === "webhook") {
          try {
            await sendJobMailAutomatically(job);
            job.mail.status = "sent";
            job.mail.sentAt = now();
            job.mail.error = undefined;
          } catch (error) {
            job.mail.status = "failed";
            job.mail.error = error instanceof Error ? error.message : String(error);
          }
        } else {
          job.mail.status = "ready";
        }
        job.mail.updatedAt = now();
      }
      await this.persist(job);
    } catch (error) {
      job.status = "failed";
      job.stage = "failed";
      job.error = error instanceof Error ? error.stack ?? error.message : String(error);
      if (job.mail) {
        job.mail.status = "failed";
        job.mail.error = "剪辑失败，未发送完成通知";
        job.mail.updatedAt = now();
      }
      await this.persist(job);
    } finally {
      this.pendingJobs = Math.max(0, this.pendingJobs - 1);
    }
  }

  private async runSubtitleRepair(job: EditJobRecord) {
    const repair = job.subtitleRepair;
    if (!repair) throw new Error("Missing subtitle repair payload");
    const parent = await this.get(repair.parentJobId);
    if (parent.status !== "completed" || !parent.result) {
      throw new Error("The version selected for subtitle repair is no longer completed");
    }
    const subtitlesPath = parent.result.artifacts.subtitles;
    const editSpecPath = parent.result.artifacts.editSpec;
    if (!subtitlesPath || !editSpecPath) throw new Error("The selected version is missing subtitle repair artifacts");
    const [subtitlesText, specText] = await Promise.all([
      readFile(subtitlesPath, "utf8"),
      readFile(editSpecPath, "utf8"),
    ]);
    const subtitles = JSON.parse(subtitlesText) as SubtitleData;
    const parentSpec = JSON.parse(specText) as AgentEditSpec;
    const faceTrackPath = parent.result.artifacts.faceTrack;
    const faceTrack = faceTrackPath && existsSync(faceTrackPath)
      ? JSON.parse(await readFile(faceTrackPath, "utf8")) as FaceTrackManifest
      : null;
    if (!subtitles.segments.length) throw new Error("The selected version has no timed subtitles to repair");

    job.stage = "preparing-subtitle-repair";
    job.progress = 0.06;
    await this.persist(job);
    const copied = await copySourceIntoRemotion(job.inputPath, job.id);
    const context: RunContext = {
      job,
      jobDir: join(jobsRoot, job.id),
      publicMediaPath: copied.path,
      publicMediaSrc: copied.src,
      probe: parent.result.probe,
      subtitles,
      faceTrack,
      evidenceAssets: parentSpec.evidenceAssets,
      generatedVisuals: parentSpec.generatedVisuals ?? [],
      qualityReviews: [],
    };
    const result = await runSubtitleRepairAgent(context, parentSpec, repair.feedback, async (stage, progress) => {
      job.stage = stage;
      job.progress = progress;
      await this.persist(job);
    });
    if (!context.probe || !context.renderPath || !context.verificationPath || !context.spec) {
      throw new Error("Subtitle repair Agent did not produce a verified render");
    }
    job.subtitleRepair = {...repair, analysis: result.analysis};
    const artifacts: ArtifactMap = {
      video: context.renderPath,
      editSpec: join(context.jobDir, "edit-spec.json"),
      subtitles: join(context.jobDir, "subtitles.json"),
      finalContactSheet: join(context.jobDir, "final-contact-sheet.jpg"),
      verification: context.verificationPath,
      renderProps: join(context.jobDir, "render-props.json"),
      renderLog: join(context.jobDir, "render.log"),
      qualityReview: join(context.jobDir, `quality-review-${Math.max(1, context.qualityReviews.length)}.json`),
      subtitleRepair: join(context.jobDir, "subtitle-repair.json"),
    };
    for (const artifact of ["sourceInspection", "sourceContactSheet", "faceTrack"] as const) {
      const source = parent.result.artifacts[artifact];
      if (source && existsSync(source)) artifacts[artifact] = source;
    }
    await writeFile(join(context.jobDir, "agent-summary.txt"), `${result.summary}\n`);
    artifacts.agentSummary = join(context.jobDir, "agent-summary.txt");
    job.status = "completed";
    job.stage = "completed";
    job.progress = 1;
    job.result = {
      summary: result.summary,
      artifacts,
      probe: context.probe,
      models: {
        planner: config.plannerModel,
        vision: parent.result.models.vision,
      },
      visuals: parent.result.visuals,
      quality: context.qualityReviews.at(-1),
    };
    await this.persist(job);
  }

  async updateMail(id: string, patch: Partial<MailDelivery>) {
    const job = await this.get(id);
    if (!job.mail) throw new Error("This job has no notification email");
    job.mail = {...job.mail, ...patch, updatedAt: now()};
    await this.persist(job);
    return job.mail;
  }
}

export const jobManager = new JobManager();

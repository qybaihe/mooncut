import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rename, stat, writeFile} from "node:fs/promises";
import {basename, join, resolve} from "node:path";
import {runEditingAgent} from "./agent.ts";
import {assetsRoot, config, jobsRoot} from "./config.ts";
import {copySourceIntoRemotion} from "./media.ts";
import type {ArtifactMap, EditJobRecord, EditJobRequest, RunContext} from "./types.ts";

const now = () => new Date().toISOString();

const safeAssetName = (value: string) => basename(value).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 120) || "upload.mp4";

export type StoredAsset = {
  id: string;
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

  async recoverInterruptedJobs() {
    await mkdir(jobsRoot, {recursive: true});
    for (const entry of await readdir(jobsRoot, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const path = jobPath(entry.name);
      if (!existsSync(path)) continue;
      try {
        const job = JSON.parse(await readFile(path, "utf8")) as EditJobRecord;
        if (job.status !== "running" && job.status !== "queued") continue;
        job.status = "failed";
        job.stage = "interrupted";
        job.error = "The agent process stopped before this job completed. Submit a new job to retry.";
        await this.persist(job);
      } catch {
        // Ignore non-job scratch directories and malformed historical fixtures.
      }
    }
  }

  async create(request: EditJobRequest): Promise<EditJobRecord> {
    let inputPath: string;
    let originalName: string;
    if (request.assetId) {
      const asset = await readAsset(request.assetId);
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
      status: "queued",
      stage: "queued",
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      inputPath,
      originalName,
      request,
    };
    await mkdir(join(jobsRoot, id), {recursive: true});
    await this.persist(job);
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
      const copied = await copySourceIntoRemotion(job.inputPath, job.id);
      const context: RunContext = {
        job,
        jobDir,
        publicMediaPath: copied.path,
        publicMediaSrc: copied.src,
        evidenceAssets: [],
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
        qualityReview: join(jobDir, "quality-review.json"),
      };
      if (context.faceTrack) artifacts.faceTrack = join(jobDir, "face-track.json");
      for (const evidence of context.evidenceAssets) {
        artifacts[`evidence-${evidence.id}`] = evidence.localPath;
        artifacts[`evidence-meta-${evidence.id}`] = evidence.evidencePath;
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
        },
        quality: context.qualityReviews.at(-1),
      };
      await this.persist(job);
    } catch (error) {
      job.status = "failed";
      job.stage = "failed";
      job.error = error instanceof Error ? error.stack ?? error.message : String(error);
      await this.persist(job);
    }
  }
}

export const jobManager = new JobManager();

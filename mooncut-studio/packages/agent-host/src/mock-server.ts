/**
 * Controllable mock Agent HTTP server for end-to-end Studio tests.
 * Speaks a subset of the real mooncut-pi-agent API.
 */

import {createHash, randomBytes, randomUUID} from "node:crypto";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

export type MockJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  originalName: string;
  request: {assetId?: string; inputPath?: string; prompt?: string; title?: string};
  error?: string;
  result?: {
    summary: string;
    artifacts: Record<string, string>;
    probe?: {durationMs: number; width: number; height: number; fps: number; hasAudio: boolean; formatName: string};
  };
  cancelRequested?: boolean;
  failOnce?: boolean;
};

export type MockAgentOptions = {
  token: string;
  workDir: string;
  /** Simulated stage interval ms (tests can use small values). */
  stageIntervalMs?: number;
  host?: string;
};

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
};

const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const authorized = (request: IncomingMessage, token: string) => {
  const header = request.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/u);
  if (!match) return false;
  const provided = match[1] ?? "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(token).digest();
  return a.equals(b);
};

export class MockAgentServer {
  readonly token: string;
  readonly workDir: string;
  readonly stageIntervalMs: number;
  readonly host: string;
  private server: Server | null = null;
  private port: number | null = null;
  private readonly jobs = new Map<string, MockJob>();
  private readonly assets = new Map<string, {id: string; filename: string; bytes: number; path: string}>();

  constructor(options: MockAgentOptions) {
    this.token = options.token;
    this.workDir = options.workDir;
    this.stageIntervalMs = options.stageIntervalMs ?? 120;
    this.host = options.host ?? "127.0.0.1";
  }

  get address() {
    return {host: this.host, port: this.port};
  }

  async start(): Promise<{host: string; port: number}> {
    await mkdir(this.workDir, {recursive: true});
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolvePromise, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, this.host, () => resolvePromise());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind mock agent");
    this.port = address.port;
    return {host: this.host, port: this.port};
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server) return;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }

  private publicJob(job: MockJob, baseUrl: string) {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      originalName: job.originalName,
      request: job.request,
      ...(job.error ? {error: job.error} : {}),
      ...(job.result
        ? {
            result: {
              summary: job.result.summary,
              probe: job.result.probe,
              artifacts: Object.fromEntries(
                Object.keys(job.result.artifacts).map((name) => [
                  name,
                  `${baseUrl}/v1/edit-jobs/${job.id}/artifacts/${name}`,
                ]),
              ),
            },
          }
        : {}),
    };
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const hostHeader = request.headers.host ?? `${this.host}:${this.port}`;
      const url = new URL(request.url ?? "/", `http://${hostHeader}`);
      const baseUrl = `http://${this.host}:${this.port}`;

      if (request.method === "GET" && url.pathname === "/healthz") {
        json(response, 200, {
          ok: true,
          service: "mooncut-mock-agent",
          mode: "studio",
          gatewayReachable: false,
        });
        return;
      }

      if (url.pathname.startsWith("/v1/") && !authorized(request, this.token)) {
        json(response, 401, {error: "Unauthorized", code: "AUTH_REQUIRED"});
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/assets") {
        const body = await readBody(request);
        const id = randomUUID().replaceAll("-", "");
        const filename = url.searchParams.get("filename") ?? "upload.mp4";
        const path = join(this.workDir, "assets", `${id}-${filename}`);
        await mkdir(join(this.workDir, "assets"), {recursive: true});
        await writeFile(path, body);
        this.assets.set(id, {id, filename, bytes: body.length, path});
        json(response, 201, {assetId: id, filename, bytes: body.length});
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/edit-jobs") {
        const body = JSON.parse((await readBody(request)).toString("utf8") || "{}") as {
          assetId?: string;
          inputPath?: string;
          prompt?: string;
          title?: string;
          /** Test-only: force first run to fail. */
          __failOnce?: boolean;
        };
        const id = randomUUID().replaceAll("-", "");
        const timestamp = new Date().toISOString();
        const job: MockJob = {
          id,
          status: "queued",
          stage: "queued",
          progress: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          originalName: body.assetId ? this.assets.get(body.assetId)?.filename ?? "asset" : body.inputPath ?? "input",
          request: {
            assetId: body.assetId,
            inputPath: body.inputPath,
            prompt: body.prompt,
            title: body.title,
          },
          failOnce: Boolean(body.__failOnce),
        };
        this.jobs.set(id, job);
        void this.runJob(job);
        json(response, 202, {
          id,
          status: job.status,
          statusUrl: `${baseUrl}/v1/edit-jobs/${id}`,
        });
        return;
      }

      const cancelMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/cancel$/u);
      if (request.method === "POST" && cancelMatch) {
        const job = this.jobs.get(cancelMatch[1] ?? "");
        if (!job) {
          json(response, 404, {error: "Edit job not found"});
          return;
        }
        job.cancelRequested = true;
        if (job.status === "queued" || job.status === "running") {
          job.status = "cancelled";
          job.stage = "cancelled";
          job.error = "Task cancelled by user. Intermediate artifacts were retained; source media was not deleted.";
          job.updatedAt = new Date().toISOString();
        }
        json(response, 200, this.publicJob(job, baseUrl));
        return;
      }

      const jobMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)$/u);
      if (request.method === "GET" && jobMatch) {
        const job = this.jobs.get(jobMatch[1] ?? "");
        if (!job) {
          json(response, 404, {error: "Edit job not found"});
          return;
        }
        json(response, 200, this.publicJob(job, baseUrl));
        return;
      }

      const artifactMatch = url.pathname.match(/^\/v1\/edit-jobs\/([a-f0-9]+)\/artifacts\/([A-Za-z0-9_-]+)$/u);
      if (request.method === "GET" && artifactMatch) {
        const job = this.jobs.get(artifactMatch[1] ?? "");
        const name = artifactMatch[2] ?? "";
        const path = job?.result?.artifacts[name];
        if (!path) {
          json(response, 404, {error: "Artifact not found"});
          return;
        }
        const {createReadStream, existsSync} = await import("node:fs");
        if (!existsSync(path)) {
          json(response, 404, {error: "Artifact missing on disk"});
          return;
        }
        response.writeHead(200, {"Content-Type": "application/octet-stream"});
        createReadStream(path).pipe(response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/models") {
        json(response, 200, {
          available: ["mock-planner", "mock-vision"],
          routing: {
            planner: "mock-planner",
            script: "mock-planner",
            coach: "mock-planner",
            vision: ["mock-vision"],
            image: {configured: false, model: null, maxImages: 0},
          },
        });
        return;
      }

      json(response, 404, {error: "Not found"});
    } catch (error) {
      json(response, 500, {error: error instanceof Error ? error.message : "Internal error"});
    }
  }

  private async runJob(job: MockJob) {
    const stages: Array<{stage: string; progress: number}> = [
      {stage: "inspecting-source", progress: 0.1},
      {stage: "transcribing", progress: 0.3},
      {stage: "tracking-speaker", progress: 0.45},
      {stage: "planning-edit", progress: 0.6},
      {stage: "rendering", progress: 0.85},
      {stage: "visual-quality-review", progress: 0.95},
      {stage: "verified", progress: 0.99},
    ];
    job.status = "running";
    for (const step of stages) {
      if (job.cancelRequested) return;
      await sleep(this.stageIntervalMs);
      if (job.cancelRequested) return;
      job.stage = step.stage;
      job.progress = step.progress;
      job.updatedAt = new Date().toISOString();
    }
    if (job.cancelRequested) return;
    if (job.failOnce) {
      job.failOnce = false;
      job.status = "failed";
      job.stage = "failed";
      job.error = "Simulated provider failure (recoverable). Retry without changing local project data.";
      job.updatedAt = new Date().toISOString();
      return;
    }
    const jobDir = join(this.workDir, "jobs", job.id);
    await mkdir(jobDir, {recursive: true});
    const videoPath = join(jobDir, "final.mp4");
    const subtitlesPath = join(jobDir, "subtitles.json");
    const editSpecPath = join(jobDir, "edit-spec.json");
    const qualityPath = join(jobDir, "quality-report.json");
    const logPath = join(jobDir, "agent.log");
    await writeFile(videoPath, Buffer.from("MOCK_MP4_PLACEHOLDER"));
    await writeFile(
      subtitlesPath,
      `${JSON.stringify({
        duration_ms: 5_000,
        transcript: "Mock transcript for Studio e2e.",
        segments: [{index: 1, text: "Mock transcript for Studio e2e.", start_ms: 0, end_ms: 5_000}],
        provider: "mock",
      }, null, 2)}\n`,
    );
    await writeFile(
      editSpecPath,
      `${JSON.stringify({schemaVersion: "mooncut.edit.v1", title: job.request.title ?? "Mock Edit", beats: []}, null, 2)}\n`,
    );
    await writeFile(
      qualityPath,
      `${JSON.stringify({passed: true, notes: ["mock quality gate"], generatedAt: new Date().toISOString()}, null, 2)}\n`,
    );
    await writeFile(logPath, `mock agent completed job ${job.id}\n`, "utf8");
    job.status = "completed";
    job.stage = "completed";
    job.progress = 1;
    job.updatedAt = new Date().toISOString();
    job.result = {
      summary: "Mock edit completed. This is a controllable simulation, not a real render.",
      probe: {
        durationMs: 5_000,
        width: 1280,
        height: 720,
        fps: 24,
        hasAudio: true,
        formatName: "mock",
      },
      artifacts: {
        video: videoPath,
        subtitles: subtitlesPath,
        editSpec: editSpecPath,
        qualityReview: qualityPath,
        agentSummary: logPath,
      },
    };
  }
}

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

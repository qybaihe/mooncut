/**
 * Agent Host process supervisor: starts mock or real mooncut-pi-agent in Studio mode.
 * Always binds 127.0.0.1, random port, random token. Never writes secrets to .env files.
 */

import {spawn, type ChildProcess} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, writeFile, appendFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import type {AgentHostStatus} from "@mooncut/studio-shared";
import {AgentClient} from "./client.js";
import {createSessionToken, MockAgentServer} from "./mock-server.js";
import {parseAgentReadyLine, resolveAgentSpawnPlan} from "./spawn-entry.js";

export type ProviderRuntimeConfig = {
  baseUrl: string;
  apiKey?: string;
  plannerModel: string;
  visionModel: string;
  imageModel?: string;
  imageBaseUrl?: string;
  imageApiKey?: string;
};

export type SupervisorOptions = {
  mode: "mock" | "real";
  /** Directory for agent data/logs (under app userData). */
  runtimeRoot: string;
  /** Absolute path to monorepo / resources containing mooncut-pi-agent. */
  workspaceRoot: string;
  logPath: string;
  provider?: ProviderRuntimeConfig;
  stageIntervalMs?: number;
  nodeExecutable?: string;
  /** Writable agent data root (jobs/assets/db). */
  dataRoot?: string;
  remotionRoot?: string;
  faceTrackerRoot?: string;
  /** Prepended to PATH so child processes find bundled ffmpeg. */
  extraPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
};

export class AgentSupervisor {
  private options: SupervisorOptions;
  private mock: MockAgentServer | null = null;
  private child: ChildProcess | null = null;
  private token = "";
  private host = "127.0.0.1";
  private port: number | null = null;
  private status: AgentHostStatus = {
    state: "stopped",
    mode: "mock",
    host: "127.0.0.1",
    port: null,
    pid: null,
  };
  private restartCount = 0;
  private appliedProviderFingerprint = "";

  constructor(options: SupervisorOptions) {
    this.options = options;
    this.status.mode = options.mode;
  }

  getStatus(): AgentHostStatus {
    return {...this.status};
  }

  /** Stable fingerprint of provider env applied to the running real Agent. */
  getProviderFingerprint(): string {
    return this.appliedProviderFingerprint;
  }

  static fingerprintProvider(provider?: ProviderRuntimeConfig): string {
    if (!provider) return "";
    return JSON.stringify({
      baseUrl: provider.baseUrl,
      plannerModel: provider.plannerModel,
      visionModel: provider.visionModel,
      imageModel: provider.imageModel ?? "",
      hasKey: Boolean(provider.apiKey),
      // include key length only — not the secret
      keyLen: provider.apiKey?.length ?? 0,
    });
  }

  getClient(): AgentClient {
    if (!this.port || !this.token) throw new Error("Agent Host is not running");
    return new AgentClient({
      baseUrl: `http://${this.host}:${this.port}`,
      token: this.token,
    });
  }

  async start(): Promise<AgentHostStatus> {
    await this.stop();
    this.token = createSessionToken();
    this.status = {
      state: "starting",
      mode: this.options.mode,
      host: this.host,
      port: null,
      pid: null,
      startedAt: new Date().toISOString(),
    };
    await mkdir(this.options.runtimeRoot, {recursive: true});
    await mkdir(dirname(this.options.logPath), {recursive: true});
    await appendFile(this.options.logPath, `\n[${new Date().toISOString()}] starting mode=${this.options.mode}\n`);

    if (this.options.mode === "mock") {
      this.mock = new MockAgentServer({
        token: this.token,
        workDir: join(this.options.runtimeRoot, "mock"),
        stageIntervalMs: this.options.stageIntervalMs ?? 150,
        host: this.host,
      });
      const address = await this.mock.start();
      this.port = address.port;
      this.appliedProviderFingerprint = "";
      this.status = {
        state: "healthy",
        mode: "mock",
        host: this.host,
        port: this.port,
        pid: process.pid,
        startedAt: this.status.startedAt,
      };
      await this.waitHealthy();
      return this.getStatus();
    }

    await this.startRealAgent();
    this.appliedProviderFingerprint = AgentSupervisor.fingerprintProvider(this.options.provider);
    return this.getStatus();
  }

  private async startRealAgent() {
    const agentRoot = join(this.options.workspaceRoot, "mooncut-pi-agent");
    if (!existsSync(agentRoot)) {
      this.status = {
        state: "unhealthy",
        mode: "real",
        host: this.host,
        port: null,
        pid: null,
        lastError: `mooncut-pi-agent not found at ${agentRoot}`,
        startedAt: this.status.startedAt,
      };
      throw new Error(this.status.lastError);
    }

    let spawnPlan;
    try {
      spawnPlan = resolveAgentSpawnPlan({
        agentRoot,
        nodeExecutable: this.options.nodeExecutable,
        preferElectronNode:
          Boolean(process.versions.electron) || process.env.MOONCUT_USE_ELECTRON_NODE === "1",
        electronExecPath: process.execPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = {
        state: "unhealthy",
        mode: "real",
        host: this.host,
        port: null,
        pid: null,
        lastError: message,
        startedAt: this.status.startedAt,
      };
      throw new Error(message);
    }

    const dataRoot = this.options.dataRoot ?? join(this.options.runtimeRoot, "real-data");
    await mkdir(dataRoot, {recursive: true});
    await mkdir(join(dataRoot, "assets"), {recursive: true});
    await mkdir(join(dataRoot, "jobs"), {recursive: true});

    const pathEnv = this.options.extraPath
      ? `${this.options.extraPath}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`
      : process.env.PATH;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: pathEnv,
      ELECTRON_RUN_AS_NODE: "1",
      MOONCUT_STUDIO_MODE: "true",
      MOONCUT_AGENT_HOST: "127.0.0.1",
      MOONCUT_AGENT_PORT: "0",
      MOONCUT_API_KEYS: this.token,
      MOONCUT_ALLOW_INPUT_PATH: "true",
      MOONCUT_AGENT_ROOT: agentRoot,
      MOONCUT_WORKSPACE_ROOT: this.options.workspaceRoot,
      MOONCUT_DATA_ROOT: dataRoot,
      MOONCUT_ASSETS_ROOT: join(dataRoot, "assets"),
      MOONCUT_JOBS_ROOT: join(dataRoot, "jobs"),
      MOONCUT_AGENT_RUNTIME_ROOT: join(dataRoot, "pi-runtime"),
      MOONCUT_DATABASE_PATH: join(dataRoot, "mooncut.sqlite"),
      MOONCUT_REMOTION_ROOT: this.options.remotionRoot ?? join(this.options.workspaceRoot, "remotion-studio"),
      MOONCUT_FACE_TRACKER_ROOT: this.options.faceTrackerRoot ?? join(this.options.workspaceRoot, "face-tracker"),
      MOONCUT_PUBLIC_BASE_URL: "",
      MOONCUT_COOKIE_SECURE: "false",
      MOONCUT_REQUIRE_SUBTITLE_SERVICE: "false",
      MOONCUT_ALLOW_KNOWN_SUBTITLE_FIXTURES: "true",
      MOONCUT_PROBE_GATEWAY_ON_HEALTH: "false",
    };
    if (this.options.ffmpegPath) env.FFMPEG_PATH = this.options.ffmpegPath;
    if (this.options.ffprobePath) env.FFPROBE_PATH = this.options.ffprobePath;

    await writeFile(
      join(this.options.runtimeRoot, "runtime-meta.json"),
      `${JSON.stringify({
        mode: "real",
        agentRoot,
        dataRoot,
        entry: spawnPlan.entryPath,
        strategy: spawnPlan.strategy,
        startedAt: new Date().toISOString(),
      }, null, 2)}\n`,
    );

    if (this.options.provider) {
      env.MOONCUT_GATEWAY_BASE_URL = this.options.provider.baseUrl;
      if (this.options.provider.apiKey) env.MOONCUT_GATEWAY_API_KEY = this.options.provider.apiKey;
      env.MOONCUT_PLANNER_MODEL = this.options.provider.plannerModel;
      env.MOONCUT_VISION_MODELS = this.options.provider.visionModel;
      if (this.options.provider.imageModel) env.MOONCUT_IMAGE_MODEL = this.options.provider.imageModel;
      if (this.options.provider.imageBaseUrl) env.MOONCUT_IMAGE_BASE_URL = this.options.provider.imageBaseUrl;
      if (this.options.provider.imageApiKey) env.MOONCUT_IMAGE_API_KEY = this.options.provider.imageApiKey;
    }

    const child = spawn(spawnPlan.executable, spawnPlan.args, {
      cwd: agentRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    let readyPort: number | null = null;
    const ready = new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error("Agent Host start timeout")), 30_000);
      const onData = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        void appendFile(this.options.logPath, text);
        const parsed = parseAgentReadyLine(text);
        if (parsed) {
          readyPort = parsed.port;
          clearTimeout(timeout);
          resolvePromise();
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (readyPort === null) reject(new Error(`Agent exited before ready (code ${code})`));
      });
    });

    try {
      await ready;
      this.port = readyPort;
      this.status = {
        state: "healthy",
        mode: "real",
        host: this.host,
        port: this.port,
        pid: child.pid ?? null,
        startedAt: this.status.startedAt,
      };
      await this.waitHealthy();
    } catch (error) {
      this.status = {
        state: "unhealthy",
        mode: "real",
        host: this.host,
        port: null,
        pid: child.pid ?? null,
        lastError: error instanceof Error ? error.message : String(error),
        startedAt: this.status.startedAt,
      };
      await this.stopChild();
      throw error;
    }
  }

  private async waitHealthy(timeoutMs = 10_000) {
    const client = this.getClient();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const health = await client.healthz();
        if (health.ok) {
          this.status.state = "healthy";
          return;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    this.status.state = "unhealthy";
    this.status.lastError = "Health check timeout";
    throw new Error("Agent Host health check failed");
  }

  async stop(): Promise<void> {
    if (this.mock) {
      await this.mock.stop();
      this.mock = null;
    }
    await this.stopChild();
    this.port = null;
    this.token = "";
    this.status = {
      state: "stopped",
      mode: this.options.mode,
      host: this.host,
      port: null,
      pid: null,
    };
  }

  private async stopChild() {
    const child = this.child;
    this.child = null;
    if (!child || child.killed) return;
    await new Promise<void>((resolvePromise) => {
      const force = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        resolvePromise();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(force);
        resolvePromise();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(force);
        resolvePromise();
      }
    });
  }

  async restart(): Promise<AgentHostStatus> {
    this.restartCount += 1;
    return this.start();
  }

  updateOptions(partial: Partial<SupervisorOptions>) {
    this.options = {...this.options, ...partial};
  }
}

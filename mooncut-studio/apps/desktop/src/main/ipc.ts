import {app, BrowserWindow, dialog, ipcMain, shell} from "electron";
import {createWriteStream, existsSync} from "node:fs";
import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {basename, extname, join, resolve} from "node:path";
import {createGzip} from "node:zlib";
import {randomUUID} from "node:crypto";
import {
  AgentSupervisor,
  materializeJobArtifacts,
  type ProviderRuntimeConfig,
} from "@mooncut/studio-agent-host";
import {probeDependencies} from "@mooncut/studio-bootstrapper";
import {
  createProject,
  deleteProjectData,
  exportProjectPackage,
  importMediaFile,
  listJobs,
  listMedia,
  loadIndex,
  loadSettings,
  readManifest,
  saveSettings,
  toSummary,
  upsertIndexEntry,
  upsertJob,
} from "@mooncut/studio-project-format";
import {
  IPC_CHANNELS,
  redactSecrets,
  type AgentMode,
  type CompleteOnboardingInput,
  type CreateJobInput,
  type CreateProjectInput,
  type ProviderProfileInput,
  type StudioJob,
  type UpdateSettingsInput,
} from "@mooncut/studio-shared";
import {ProviderStore} from "./provider-store.js";
import {getRuntimeLayout, refreshRuntimeLayout, userPaths} from "./paths.js";
import {pathWithBundledBin, type RuntimeLayout} from "./runtime.js";
import {SecureStore} from "./secure-store.js";
import {spawn} from "node:child_process";
import {
  isPathAllowed,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
} from "./media-access.js";
import {
  EXTERNAL_CLI_NOT_FOUND_SENTINEL,
  EXTERNAL_CLI_PARSE_ERROR_SENTINEL,
  ExternalCliNotFoundError,
  CliJsonParseError,
  runExternalCliAssistant,
  sentinelError,
} from "./external-cli.js";

const VIDEO_FILTERS = [
  {name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"]},
];

export type StudioServices = {
  supervisor: AgentSupervisor;
  providers: ProviderStore;
  secrets: SecureStore;
  paths: ReturnType<typeof userPaths>;
  workspaceRoot: string;
  runtime: RuntimeLayout;
};

function supervisorOptionsFromRuntime(
  paths: ReturnType<typeof userPaths>,
  runtime: RuntimeLayout,
  mode: "mock" | "real" = "mock",
  provider?: ProviderRuntimeConfig,
) {
  return {
    mode,
    runtimeRoot: paths.agentRuntime,
    workspaceRoot: runtime.workspaceRoot,
    logPath: paths.agentLog,
    stageIntervalMs: 150,
    dataRoot: runtime.dataRoot,
    remotionRoot: runtime.remotionRoot,
    faceTrackerRoot: runtime.faceTrackerRoot,
    extraPath: pathWithBundledBin(runtime, ""),
    ffmpegPath: runtime.ffmpegPath ?? undefined,
    ffprobePath: runtime.ffprobePath ?? undefined,
    ...(provider ? {provider} : {}),
  };
}

/**
 * Map any AgentMode down to the supervisor's "mock" | "real" enum.
 * external-cli 不启动派进程，请求时即时 spawn CLI；fallback 时以 mock 启动派。
 */
function supervisorMode(agentMode: AgentMode): "mock" | "real" {
  return agentMode === "external-cli" ? "mock" : agentMode;
}

/** Collect allowed roots for mooncut-media / IPC preview. */
export async function collectMediaAllowlist(
  paths: ReturnType<typeof userPaths>,
  runtime: RuntimeLayout,
): Promise<string[]> {
  const index = await loadIndex(paths.projectIndex);
  return [
    ...index.projects.map((project) => project.rootPath),
    paths.userData,
    paths.agentRuntime,
    runtime.dataRoot,
    runtime.workspaceRoot,
  ].filter(Boolean);
}

export async function resolveProviderForJob(
  providers: ProviderStore,
  profileId?: string,
): Promise<ProviderRuntimeConfig | undefined> {
  const config = await providers.toRuntimeConfig(profileId);
  return config ?? undefined;
}

export function createServices(): StudioServices {
  const paths = userPaths();
  const secrets = new SecureStore(paths.secrets);
  const providers = new ProviderStore(paths.providers, secrets);
  const runtime = getRuntimeLayout();
  const supervisor = new AgentSupervisor(supervisorOptionsFromRuntime(paths, runtime, "mock"));
  return {supervisor, providers, secrets, paths, workspaceRoot: runtime.workspaceRoot, runtime};
}

async function getSettings(services: StudioServices) {
  const fallback = join(app.getPath("documents"), "MoonCut Studio");
  return loadSettings(services.paths.settings, fallback);
}

async function probeMedia(filePath: string, runtime?: RuntimeLayout) {
  const layout = runtime ?? getRuntimeLayout();
  const ffprobeBin = layout.ffprobePath || "ffprobe";
  const env = {
    ...process.env,
    PATH: pathWithBundledBin(layout, process.env.PATH ?? ""),
  };
  return new Promise<{
    durationMs?: number;
    fps?: number;
    width?: number;
    height?: number;
    hasAudio?: boolean;
    formatName?: string;
    error?: string;
  }>((resolvePromise) => {
    const child = spawn(ffprobeBin, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ], {env});
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (error) => {
      resolvePromise({error: `无法运行 ffprobe：${error.message}。请安装 FFmpeg 后重试。`});
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolvePromise({error: redactSecrets(stderr || `ffprobe exit ${code}`)});
        return;
      }
      try {
        const data = JSON.parse(stdout) as {
          format?: {duration?: string; format_name?: string};
          streams?: Array<{codec_type?: string; width?: number; height?: number; r_frame_rate?: string}>;
        };
        const video = data.streams?.find((s) => s.codec_type === "video");
        const audio = data.streams?.find((s) => s.codec_type === "audio");
        let fps: number | undefined;
        if (video?.r_frame_rate?.includes("/")) {
          const [a, b] = video.r_frame_rate.split("/").map(Number);
          if (a && b) fps = a / b;
        }
        resolvePromise({
          durationMs: data.format?.duration ? Math.round(Number(data.format.duration) * 1000) : undefined,
          fps,
          width: video?.width,
          height: video?.height,
          hasAudio: Boolean(audio),
          formatName: data.format?.format_name,
        });
      } catch (error) {
        resolvePromise({error: error instanceof Error ? error.message : "ffprobe parse error"});
      }
    });
  });
}

function assertHttpUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("非法外部链接");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("仅允许 http(s) 外部链接");
  }
  return parsed.toString();
}

export function registerIpc(services: StudioServices) {
  const {supervisor, providers, paths} = services;
  const runtimeOf = () => {
    services.runtime = refreshRuntimeLayout();
    services.workspaceRoot = services.runtime.workspaceRoot;
    return services.runtime;
  };
  // Initial layout (already resolved in createServices)
  let workspaceRoot = services.workspaceRoot;

  ipcMain.handle(IPC_CHANNELS.appGetInfo, async () => ({
    name: "MoonCut Studio",
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath("userData"),
  }));

  ipcMain.handle(IPC_CHANNELS.settingsGet, async () => getSettings(services));

  ipcMain.handle(IPC_CHANNELS.settingsUpdate, async (_e, input: UpdateSettingsInput) => {
    const current = await getSettings(services);
    const next = {...current, ...input};
    if (input.agentMode && input.agentMode !== current.agentMode) {
      const runtime = runtimeOf();
      // external-cli 不需要 supervisor 进程；切到它只需 stop，从它切回 mock/real 才重启。
      if (input.agentMode === "external-cli") {
        await supervisor.stop().catch((error) => {
          console.error("[agent] stop on switch to external-cli failed", error);
        });
      } else {
        supervisor.updateOptions(supervisorOptionsFromRuntime(paths, runtime, supervisorMode(input.agentMode)));
        await supervisor.restart().catch((error) => {
          console.error("[agent] restart after mode change failed", error);
        });
      }
    }
    await saveSettings(paths.settings, next);
    return next;
  });

  ipcMain.handle(IPC_CHANNELS.onboardingGet, async () => {
    const settings = await getSettings(services);
    return {
      step: settings.onboardingCompleted ? 5 : 0,
      workspaceRoot: settings.workspaceRoot,
      preferLocalOnly: !settings.allowNetworkForProviders,
      sampleProjectCreated: false,
      completed: settings.onboardingCompleted,
    };
  });

  ipcMain.handle(IPC_CHANNELS.onboardingComplete, async (_e, input: CompleteOnboardingInput) => {
    const workspace = resolve(input.workspaceRoot);
    await mkdir(workspace, {recursive: true});
    let settings = await getSettings(services);
    settings = {
      ...settings,
      workspaceRoot: workspace,
      onboardingCompleted: true,
      allowNetworkForProviders: !input.preferLocalOnly,
      agentMode: input.agentMode ?? "mock",
      ...(input.externalCli ? {externalCli: input.externalCli} : {}),
    };
    await saveSettings(paths.settings, settings);
    if (input.createSampleProject) {
      const {manifest, rootPath} = await createProject(workspace, "示例项目");
      await upsertIndexEntry(paths.projectIndex, rootPath, manifest);
    }
    // external-cli 模式不强制启动派 supervisor（请求时即时 spawn CLI）。
    if (settings.agentMode !== "external-cli" && !supervisor.getStatus().port) {
      await supervisor.start().catch((error) => console.error(error));
    }
    return settings;
  });

  ipcMain.handle(IPC_CHANNELS.projectList, async () => {
    const index = await loadIndex(paths.projectIndex);
    return index.projects.map(toSummary);
  });

  ipcMain.handle(IPC_CHANNELS.projectCreate, async (_e, input: CreateProjectInput) => {
    const parent = resolve(input.parentDirectory);
    await mkdir(parent, {recursive: true});
    const {manifest, rootPath} = await createProject(parent, input.name, {
      providerProfileId: input.providerProfileId,
    });
    const entry = await upsertIndexEntry(paths.projectIndex, rootPath, manifest);
    return toSummary(entry);
  });

  ipcMain.handle(IPC_CHANNELS.projectOpen, async (_e, projectId: string) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === projectId);
    if (!entry) throw new Error("项目不存在");
    const manifest = await readManifest(entry.rootPath);
    const updated = await upsertIndexEntry(paths.projectIndex, entry.rootPath, manifest);
    return {summary: toSummary(updated), manifest};
  });

  ipcMain.handle(IPC_CHANNELS.projectDelete, async (_e, payload: {projectId: string; deleteFiles: boolean}) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === payload.projectId);
    if (!entry) throw new Error("项目不存在");
    await deleteProjectData(paths.projectIndex, entry.rootPath, payload.projectId, {
      deleteFiles: payload.deleteFiles,
    });
    return {ok: true};
  });

  ipcMain.handle(IPC_CHANNELS.projectReveal, async (_e, projectId: string) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === projectId);
    if (!entry) throw new Error("项目不存在");
    shell.showItemInFolder(entry.rootPath);
    return {ok: true};
  });

  ipcMain.handle(IPC_CHANNELS.projectExportPackage, async (_e, projectId: string) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === projectId);
    if (!entry) throw new Error("项目不存在");
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择导出位置",
    });
    if (result.canceled || !result.filePaths[0]) return {ok: false, error: "已取消"};
    const dest = await exportProjectPackage(entry.rootPath, result.filePaths[0]);
    return {ok: true, path: dest};
  });

  ipcMain.handle(IPC_CHANNELS.projectImportMedia, async (_e, payload: {projectId: string; filePath?: string}) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === payload.projectId);
    if (!entry) throw new Error("项目不存在");
    let filePath = payload.filePath;
    if (!filePath) {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ["openFile"],
        filters: VIDEO_FILTERS,
        title: "导入视频",
      });
      if (result.canceled || !result.filePaths[0]) throw new Error("未选择文件");
      filePath = result.filePaths[0];
    }
    const asset = await importMediaFile(entry.rootPath, filePath);
    const probe = await probeMedia(asset.absolutePath, services.runtime);
    if (!probe.error) {
      asset.durationMs = probe.durationMs;
      asset.width = probe.width;
      asset.height = probe.height;
      const manifest = await readManifest(entry.rootPath);
      const media = manifest.media.map((item) => (item.id === asset.id ? {...asset, absolutePath: item.absolutePath} : item));
      manifest.media = media;
      const {writeManifest} = await import("@mooncut/studio-project-format");
      await writeManifest(entry.rootPath, manifest);
      await upsertIndexEntry(paths.projectIndex, entry.rootPath, manifest);
    }
    return {asset, probe};
  });

  ipcMain.handle(IPC_CHANNELS.projectListMedia, async (_e, projectId: string) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === projectId);
    if (!entry) throw new Error("项目不存在");
    return listMedia(entry.rootPath);
  });

  ipcMain.handle(IPC_CHANNELS.projectProbeMedia, async (_e, absolutePath: string) =>
    probeMedia(resolve(absolutePath), services.runtime),
  );

  ipcMain.handle(IPC_CHANNELS.dialogSelectDirectory, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.dialogSelectVideo, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openFile"],
      filters: VIDEO_FILTERS,
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.agentStatus, async () => supervisor.getStatus());

  ipcMain.handle(IPC_CHANNELS.agentRestart, async () => {
    const settings = await getSettings(services);
    const runtime = runtimeOf();
    workspaceRoot = runtime.workspaceRoot;
    const provider = await resolveProviderForJob(providers, settings.defaultProviderProfileId);
    supervisor.updateOptions(supervisorOptionsFromRuntime(paths, runtime, supervisorMode(settings.agentMode), provider));
    return supervisor.restart();
  });

  ipcMain.handle(IPC_CHANNELS.jobCreate, async (_e, input: CreateJobInput) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === input.projectId);
    if (!entry) throw new Error("项目不存在");
    const media = await listMedia(entry.rootPath);
    const asset = media.find((item) => item.id === input.mediaAssetId);
    if (!asset) throw new Error("素材不存在");
    // Path must remain inside project root.
    if (!asset.absolutePath.startsWith(resolve(entry.rootPath))) {
      throw new Error("素材路径非法");
    }
    const settings = await getSettings(services);
    const profileId = input.providerProfileId ?? settings.defaultProviderProfileId;
    const provider = await resolveProviderForJob(providers, profileId);
    const runtime = runtimeOf();
    supervisor.updateOptions(
      supervisorOptionsFromRuntime(paths, runtime, supervisorMode(settings.agentMode), provider),
    );
    const providerFp = AgentSupervisor.fingerprintProvider(provider);
    if (supervisor.getStatus().state !== "healthy") {
      await supervisor.start();
    } else if (
      settings.agentMode === "real" &&
      supervisor.getStatus().mode === "real" &&
      providerFp !== supervisor.getProviderFingerprint()
    ) {
      // Real Agent only reads provider env at process start — restart when profile changes.
      await supervisor.restart();
    }
    const client = supervisor.getClient();
    const created = await client.createJob({
      inputPath: asset.absolutePath,
      prompt: input.prompt,
      title: input.title,
      imageGeneration: "off",
    });
    const timestamp = new Date().toISOString();
    const job: StudioJob = {
      id: created.id,
      projectId: input.projectId,
      status: "queued",
      stage: "queued",
      progress: 0,
      prompt: input.prompt,
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
      mediaAssetId: input.mediaAssetId,
      providerProfileId: profileId,
    };
    await upsertJob(entry.rootPath, job);
    return job;
  });

  ipcMain.handle(IPC_CHANNELS.jobGet, async (_e, payload: {projectId: string; jobId: string}) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === payload.projectId);
    if (!entry) throw new Error("项目不存在");
    try {
      const client = supervisor.getClient();
      const remote = await client.getJob(payload.jobId);
      let artifacts = remote.result?.artifacts;
      if (remote.status === "completed" && artifacts) {
        try {
          artifacts = await materializeJobArtifacts({
            client,
            projectRoot: entry.rootPath,
            jobId: remote.id,
            artifacts,
          });
        } catch (error) {
          console.error("[jobGet] artifact materialize failed", error);
        }
      }
      const job: StudioJob = {
        id: remote.id,
        projectId: payload.projectId,
        status: remote.status,
        stage: remote.stage,
        progress: remote.progress,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
        error: remote.error ? redactSecrets(remote.error) : undefined,
        artifacts,
        prompt: typeof remote.request?.prompt === "string" ? remote.request.prompt : undefined,
        title: typeof remote.request?.title === "string" ? remote.request.title : undefined,
      };
      await upsertJob(entry.rootPath, job);
      return job;
    } catch {
      const jobs = await listJobs(entry.rootPath);
      const local = jobs.find((item) => item.id === payload.jobId);
      if (!local) throw new Error("任务不存在");
      return local;
    }
  });

  ipcMain.handle(IPC_CHANNELS.jobList, async (_e, projectId: string) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === projectId);
    if (!entry) throw new Error("项目不存在");
    return listJobs(entry.rootPath);
  });

  /** Inbox: 跨项目聚合所有已完成的成片，按完成时间倒序。 */
  ipcMain.handle(IPC_CHANNELS.jobListAll, async () => {
    const index = await loadIndex(paths.projectIndex);
    const items: Array<StudioJob & {projectName: string}> = [];
    for (const entry of index.projects) {
      try {
        const jobs = await listJobs(entry.rootPath);
        for (const job of jobs) {
          if (job.status === "completed") {
            items.push({...job, projectName: entry.name});
          }
        }
      } catch {
        /* skip projects with unreadable manifests */
      }
    }
    items.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
    return items;
  });

  ipcMain.handle(IPC_CHANNELS.jobCancel, async (_e, payload: {projectId: string; jobId: string}) => {
    const client = supervisor.getClient();
    const remote = await client.cancelJob(payload.jobId);
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === payload.projectId);
    if (!entry) throw new Error("项目不存在");
    // Map cancelled status explicitly (never treat cancel as failed-retryable).
    const status = remote.status === "failed" && remote.stage === "cancelled" ? "cancelled" : remote.status;
    const job: StudioJob = {
      id: remote.id,
      projectId: payload.projectId,
      status,
      stage: remote.stage,
      progress: remote.progress,
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
      error: remote.error ? redactSecrets(remote.error) : undefined,
    };
    await upsertJob(entry.rootPath, job);
    return job;
  });

  ipcMain.handle(IPC_CHANNELS.jobRetry, async (_e, payload: {projectId: string; jobId: string}) => {
    const index = await loadIndex(paths.projectIndex);
    const entry = index.projects.find((item) => item.id === payload.projectId);
    if (!entry) throw new Error("项目不存在");
    const jobs = await listJobs(entry.rootPath);
    const previous = jobs.find((item) => item.id === payload.jobId);
    if (!previous?.mediaAssetId) throw new Error("无法重试：缺少原素材引用");
    if (supervisor.getStatus().state !== "healthy") {
      const settings = await getSettings(services);
      supervisor.updateOptions({mode: supervisorMode(settings.agentMode)});
      await supervisor.start();
    }
    const client = supervisor.getClient();
    const media = await listMedia(entry.rootPath);
    const asset = media.find((item) => item.id === previous.mediaAssetId);
    if (!asset) throw new Error("原素材已丢失");
    const created = await client.createJob({
      inputPath: asset.absolutePath,
      prompt: previous.prompt,
      title: previous.title ? `${previous.title} · 重试` : "重试任务",
      imageGeneration: "off",
    });
    const timestamp = new Date().toISOString();
    const job: StudioJob = {
      id: created.id,
      projectId: payload.projectId,
      status: "queued",
      stage: "queued",
      progress: 0,
      prompt: previous.prompt,
      title: previous.title,
      createdAt: timestamp,
      updatedAt: timestamp,
      mediaAssetId: previous.mediaAssetId,
      providerProfileId: previous.providerProfileId,
    };
    await upsertJob(entry.rootPath, job);
    return job;
  });

  ipcMain.handle(IPC_CHANNELS.jobRevealArtifact, async (_e, absolutePath: string) => {
    const resolved = resolve(absolutePath);
    shell.showItemInFolder(resolved);
    return {ok: true};
  });

  ipcMain.handle(IPC_CHANNELS.providerList, async () => providers.ensureCatalogProfiles());

  ipcMain.handle(IPC_CHANNELS.providerCatalog, async () => providers.catalog());

  ipcMain.handle(IPC_CHANNELS.providerUpsert, async (_e, input: ProviderProfileInput) => {
    const settings = await getSettings(services);
    if (input.kind === "remote-openai-compatible" && !settings.allowNetworkForProviders) {
      throw new Error("当前为仅本地模式。请先在设置中允许远程 Provider。");
    }
    return providers.upsert(input);
  });

  ipcMain.handle(IPC_CHANNELS.providerDelete, async (_e, id: string) => providers.delete(id));

  ipcMain.handle(IPC_CHANNELS.providerTest, async (_e, profileId: string) => {
    const settings = await getSettings(services);
    const stored = await providers.getStored(profileId);
    if (!stored) throw new Error("Profile 不存在");
    if (stored.kind === "mock") {
      return {ok: true, latencyMs: 1, modelsSample: ["mock-planner", "mock-vision"]};
    }
    if (stored.kind === "remote-openai-compatible" && !settings.allowNetworkForProviders) {
      return {ok: false, error: "仅本地模式禁止测试远程端点"};
    }
    const apiKey = (await providers.getSecret(profileId)) ?? undefined;
    if (supervisor.getStatus().state !== "healthy") await supervisor.start();
    const client = supervisor.getClient();
    return client.testOpenAiCompatible(stored.baseUrl, apiKey, stored.timeoutMs);
  });

  const probeDeps = async () => {
    const runtime = runtimeOf();
    workspaceRoot = runtime.workspaceRoot;
    return probeDependencies({
      platform: process.platform,
      arch: process.arch,
      workspaceRoot: runtime.workspaceRoot,
      managedRoot: paths.managedDeps,
      ffmpegPath: runtime.ffmpegPath,
      ffprobePath: runtime.ffprobePath,
    });
  };

  ipcMain.handle(IPC_CHANNELS.depsList, async () => probeDeps());
  ipcMain.handle(IPC_CHANNELS.depsRefresh, async () => probeDeps());

  ipcMain.handle(IPC_CHANNELS.cacheClear, async () => {
    await rm(paths.cache, {recursive: true, force: true});
    await mkdir(paths.cache, {recursive: true});
    return {ok: true};
  });

  ipcMain.handle(IPC_CHANNELS.diagnosticsExport, async () => {
    await mkdir(paths.diagnostics, {recursive: true});
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const outPath = join(paths.diagnostics, `mooncut-studio-diag-${stamp}.txt.gz`);
    const settings = await getSettings(services);
    const runtime = runtimeOf();
    workspaceRoot = runtime.workspaceRoot;
    const deps = await probeDeps();
    const agent = supervisor.getStatus();
    let agentLog = "";
    try {
      agentLog = await readFile(paths.agentLog, "utf8");
    } catch {
      agentLog = "(no agent log)";
    }
    // Strip anything that looks like a secret.
    const body = redactSecrets(
      [
        "MoonCut Studio Diagnostic Bundle",
        `generatedAt: ${new Date().toISOString()}`,
        `version: ${app.getVersion()}`,
        `platform: ${process.platform} ${process.arch}`,
        `electron: ${process.versions.electron}`,
        `workspaceRoot: ${workspaceRoot}`,
        `runtimeSource: ${runtime.source}`,
        `ffmpeg: ${runtime.ffmpegPath ?? "path"}`,
        `userData: ${paths.userData}`,
        `settings: ${JSON.stringify({...settings, /* no secrets */}, null, 2)}`,
        `agent: ${JSON.stringify(agent, null, 2)}`,
        `deps: ${JSON.stringify(deps, null, 2)}`,
        "--- agent log (redacted) ---",
        agentLog,
      ].join("\n"),
    );
    await new Promise<void>((resolvePromise, reject) => {
      const gzip = createGzip();
      const out = createWriteStream(outPath);
      gzip.pipe(out);
      gzip.end(body);
      out.on("finish", () => resolvePromise());
      out.on("error", reject);
      gzip.on("error", reject);
    });
    const info = await stat(outPath);
    return {path: outPath, bytes: info.size};
  });

  ipcMain.handle(IPC_CHANNELS.shellOpenExternal, async (_e, url: string) => {
    const safe = assertHttpUrl(url);
    await shell.openExternal(safe);
    return {ok: true};
  });

  ipcMain.handle(IPC_CHANNELS.shellShowItem, async (_e, targetPath: string) => {
    shell.showItemInFolder(resolve(targetPath));
    return {ok: true};
  });

  ipcMain.handle(IPC_CHANNELS.pathJoin, async (_e, parts: string[]) => join(...parts));

  /** Build a privileged preview URL for a local media file under project or app data. */
  ipcMain.handle(IPC_CHANNELS.mediaPreviewUrl, async (_e, absolutePath: string) => {
    const resolved = resolve(absolutePath);
    if (!existsSync(resolved)) throw new Error("文件不存在");
    const roots = await collectMediaAllowlist(paths, services.runtime);
    if (!isPathAllowed(resolved, roots)) {
      throw new Error("只能预览本机项目或 Studio 运行时目录内的媒体文件");
    }
    const encoded = Buffer.from(resolved, "utf8").toString("base64url");
    return `mooncut-media://local/${encoded}`;
  });

  /** Save a recorded video blob into the project recordings/ folder and index it (no double full copy). */
  ipcMain.handle(
    IPC_CHANNELS.mediaSaveRecording,
    async (
      _e,
      payload: {projectId: string; filename: string; bytes: ArrayBuffer; mimeType?: string; durationMs?: number},
    ) => {
      const index = await loadIndex(paths.projectIndex);
      const entry = index.projects.find((item) => item.id === payload.projectId);
      if (!entry) throw new Error("项目不存在");
      const root = resolve(entry.rootPath);
      const buffer = Buffer.from(payload.bytes);
      if (buffer.byteLength > MAX_RECORDING_BYTES) {
        throw new Error(
          `录制文件过大（${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB），上限 ${Math.floor(MAX_RECORDING_BYTES / (1024 * 1024))} MB`,
        );
      }
      if (typeof payload.durationMs === "number" && payload.durationMs > MAX_RECORDING_DURATION_MS) {
        throw new Error(
          `录制时长过长（${Math.round(payload.durationMs / 1000)}s），上限 ${Math.floor(MAX_RECORDING_DURATION_MS / 60000)} 分钟`,
        );
      }
      const safeBase = basename(payload.filename || "recording.webm").replace(/[^\p{L}\p{N}._-]+/gu, "-") || "recording.webm";
      const id = randomUUID().replaceAll("-", "").slice(0, 12);
      const relative = join("recordings", `${id}-${safeBase}`);
      const absolute = join(root, relative);
      await mkdir(join(root, "recordings"), {recursive: true});
      await writeFile(absolute, buffer);
      // Register in place under recordings/ — importMediaFile no longer double-copies when source is inside project.
      const asset = await importMediaFile(root, absolute);
      const probe = await probeMedia(asset.absolutePath, services.runtime);
      if (probe.durationMs && probe.durationMs > MAX_RECORDING_DURATION_MS) {
        await rm(absolute, {force: true}).catch(() => undefined);
        throw new Error(
          `录制时长过长（${Math.round(probe.durationMs / 1000)}s），上限 ${Math.floor(MAX_RECORDING_DURATION_MS / 60000)} 分钟`,
        );
      }
      if (!probe.error) {
        asset.durationMs = probe.durationMs;
        asset.width = probe.width;
        asset.height = probe.height;
        const manifest = await readManifest(root);
        manifest.media = manifest.media.map((item) =>
          item.id === asset.id ? {...asset, absolutePath: item.absolutePath} : item,
        );
        const {writeManifest} = await import("@mooncut/studio-project-format");
        await writeManifest(root, manifest);
        await upsertIndexEntry(paths.projectIndex, root, manifest);
      }
      const roots = await collectMediaAllowlist(paths, services.runtime);
      if (!isPathAllowed(asset.absolutePath, roots)) {
        throw new Error("录制路径不在允许的媒体目录内");
      }
      const previewUrl = `mooncut-media://local/${Buffer.from(asset.absolutePath, "utf8").toString("base64url")}`;
      return {asset, probe, previewUrl};
    },
  );

  ipcMain.handle(IPC_CHANNELS.assistantScript, async (_e, body: unknown) => {
    const settings = await getSettings(services);
    if (settings.agentMode === "external-cli" && settings.externalCli?.kind) {
      try {
        return await runExternalCliAssistant(body, settings.externalCli);
      } catch (error) {
        if (error instanceof ExternalCliNotFoundError) {
          throw new Error(sentinelError("not-found", error.message));
        }
        if (error instanceof CliJsonParseError) {
          throw new Error(sentinelError("parse-error", error.message));
        }
        // Non-zero exit / timeout: treat as not-found fallback so renderer switches back.
        throw new Error(sentinelError("not-found", error instanceof Error ? error.message : String(error)));
      }
    }
    if (supervisor.getStatus().state !== "healthy") {
      supervisor.updateOptions(supervisorOptionsFromRuntime(paths, services.runtime, supervisorMode(settings.agentMode)));
      await supervisor.start();
    }
    if (supervisor.getStatus().state !== "healthy") {
      throw new Error("Agent Host 未就绪。请在设置中确认 Agent 状态，或先离线写稿/录制（本地实时建议仍可用）。");
    }
    return supervisor.getClient().postJson("/v1/assistant/script", body);
  });

  ipcMain.handle(IPC_CHANNELS.assistantCoach, async (_e, body: unknown) => {
    const settings = await getSettings(services);
    // external-cli 模式：Coach 走本地 useSpeakingCoach 规则建议，不直调外部 CLI（高频 spawn 太慢）。
    if (settings.agentMode === "external-cli") {
      throw new Error("Agent Host 未就绪，将继续使用本地实时建议。");
    }
    if (supervisor.getStatus().state !== "healthy") {
      throw new Error("Agent Host 未就绪，将继续使用本地实时建议。");
    }
    return supervisor.getClient().postJson("/v1/assistant/coach", body);
  });
}


export async function bootstrapAgent(services: StudioServices) {
  const settings = await getSettings(services);
  if (!settings.onboardingCompleted) return;
  const runtime = refreshRuntimeLayout();
  services.runtime = runtime;
  services.workspaceRoot = runtime.workspaceRoot;
  const provider = await resolveProviderForJob(services.providers, settings.defaultProviderProfileId);
  services.supervisor.updateOptions(
    supervisorOptionsFromRuntime(services.paths, runtime, supervisorMode(settings.agentMode), provider),
  );
  try {
    await services.supervisor.start();
  } catch (error) {
    console.error("[agent] bootstrap failed", error);
  }
}

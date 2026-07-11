/**
 * Shared domain types and IPC contracts for MoonCut Studio.
 * Renderer, preload, and main all depend on this package — no Node-only APIs here.
 */

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobStage =
  | "queued"
  | "inspecting-source"
  | "transcribing"
  | "tracking-speaker"
  | "planning-edit"
  | "rendering"
  | "visual-quality-review"
  | "verified"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | string;

export type DependencyStatus =
  | "ready"
  | "missing"
  | "downloading"
  | "needs-permission"
  | "unavailable"
  | "degraded";

export type ProviderKind = "local-openai-compatible" | "remote-openai-compatible" | "mock";

/** Built-in catalog entry (UI list → create/configure profile). */
export type ProviderCatalogEntry = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  description: string;
  defaultModels: string[];
  requiresApiKey: boolean;
  allowVideoFrameUploadDefault: boolean;
  builtin: boolean;
};

export type ProviderProfile = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  catalogId?: string;
  hasApiKey: boolean;
  plannerModel: string;
  visionModel: string;
  imageModel: string;
  models: string[];
  allowVideoFrameUpload: boolean;
  timeoutMs: number;
  enabled: boolean;
  isDefault: boolean;
};

export type ProviderProfileInput = {
  id?: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  catalogId?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  plannerModel: string;
  visionModel: string;
  imageModel: string;
  models?: string[];
  allowVideoFrameUpload: boolean;
  timeoutMs: number;
  enabled: boolean;
  isDefault?: boolean;
};

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: "mock-local",
    name: "本地模拟",
    kind: "mock",
    baseUrl: "http://127.0.0.1/mock",
    description: "离线演示任务流，无需 API Key。",
    defaultModels: ["mock-planner", "mock-vision"],
    requiresApiKey: false,
    allowVideoFrameUploadDefault: false,
    builtin: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "remote-openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    description: "官方 OpenAI API（兼容 /models 探测）。",
    defaultModels: ["gpt-4.1", "gpt-4o", "gpt-4o-mini"],
    requiresApiKey: true,
    allowVideoFrameUploadDefault: true,
    builtin: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "remote-openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    description: "DeepSeek OpenAI-compatible 端点。",
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    requiresApiKey: true,
    allowVideoFrameUploadDefault: false,
    builtin: true,
  },
  {
    id: "moonshot",
    name: "Moonshot / Kimi",
    kind: "remote-openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    description: "月之暗面 Kimi OpenAI-compatible 端点。",
    defaultModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    requiresApiKey: true,
    allowVideoFrameUploadDefault: false,
    builtin: true,
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    kind: "remote-openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    description: "智谱 OpenAI-compatible 风格接口。",
    defaultModels: ["glm-4-flash", "glm-4-plus", "glm-4v"],
    requiresApiKey: true,
    allowVideoFrameUploadDefault: true,
    builtin: true,
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    kind: "remote-openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    description: "硅基流动聚合 OpenAI-compatible 端点。",
    defaultModels: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-7B-Instruct"],
    requiresApiKey: true,
    allowVideoFrameUploadDefault: false,
    builtin: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "remote-openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    description: "OpenRouter 统一网关。",
    defaultModels: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
    requiresApiKey: true,
    allowVideoFrameUploadDefault: true,
    builtin: true,
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    kind: "local-openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    description: "本机 Ollama OpenAI-compatible 接口，Key 可留空。",
    defaultModels: ["llama3.2", "qwen2.5", "llava"],
    requiresApiKey: false,
    allowVideoFrameUploadDefault: false,
    builtin: true,
  },
  {
    id: "custom-openai",
    name: "自定义 OpenAI-compatible",
    kind: "remote-openai-compatible",
    baseUrl: "https://example.com/v1",
    description: "任意兼容 /v1/models 与 chat completions 的端点。",
    defaultModels: [],
    requiresApiKey: false,
    allowVideoFrameUploadDefault: false,
    builtin: false,
  },
] as const;

export function getCatalogEntry(catalogId: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.id === catalogId);
}

export function normalizeModelId(value: string): string {
  return value.trim().replace(/\s+/gu, "");
}

export function mergeModelList(existing: string[] | undefined, extras: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(existing ?? []), ...(extras ?? [])]) {
    const id = normalizeModelId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function validateProviderBaseUrl(baseUrl: string, kind: ProviderKind): string {
  const trimmed = baseUrl.trim().replace(/\/$/u, "");
  if (kind === "mock") return trimmed || "http://127.0.0.1/mock";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Base URL 必须是 http(s) 地址");
    }
  } catch {
    throw new Error("Base URL 必须是 http(s) 地址");
  }
  return trimmed;
}

export function profileFromCatalog(
  catalogId: string,
  overrides: Partial<ProviderProfileInput> = {},
): ProviderProfileInput {
  const entry = getCatalogEntry(catalogId);
  if (!entry) throw new Error(`未知 Provider 预设：${catalogId}`);
  const models = mergeModelList(entry.defaultModels, overrides.models);
  const planner = overrides.plannerModel?.trim() || models[0] || entry.defaultModels[0] || "";
  const vision = overrides.visionModel?.trim() || models[1] || planner;
  return {
    id: overrides.id ?? (entry.builtin ? entry.id : undefined),
    name: overrides.name ?? entry.name,
    kind: overrides.kind ?? entry.kind,
    baseUrl: overrides.baseUrl ?? entry.baseUrl,
    catalogId: entry.id,
    plannerModel: planner,
    visionModel: vision,
    imageModel: overrides.imageModel ?? "",
    models,
    allowVideoFrameUpload: overrides.allowVideoFrameUpload ?? entry.allowVideoFrameUploadDefault,
    timeoutMs: overrides.timeoutMs ?? 60_000,
    enabled: overrides.enabled ?? entry.id === "mock-local",
    isDefault: overrides.isDefault ?? entry.id === "mock-local",
    apiKey: overrides.apiKey,
    clearApiKey: overrides.clearApiKey,
  };
}

export type DependencyInfo = {
  id: string;
  name: string;
  status: DependencyStatus;
  version?: string;
  path?: string;
  sizeBytes?: number;
  required: boolean;
  detail: string;
  platform: Array<"darwin" | "win32" | "linux">;
  license?: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  mediaCount: number;
  jobCount: number;
  lastJobStatus?: JobStatus;
  providerProfileId?: string;
};

export type ProjectMediaAsset = {
  id: string;
  filename: string;
  relativePath: string;
  absolutePath: string;
  bytes: number;
  kind: "video" | "audio" | "image" | "other";
  importedAt: string;
  durationMs?: number;
  width?: number;
  height?: number;
};

export type StudioJob = {
  id: string;
  projectId: string;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  prompt?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  mediaAssetId?: string;
  artifacts?: Record<string, string>;
  providerProfileId?: string;
};

export type AgentHostStatus = {
  state: "stopped" | "starting" | "healthy" | "unhealthy" | "crashed";
  mode: "mock" | "real";
  host: string;
  port: number | null;
  pid: number | null;
  lastError?: string;
  startedAt?: string;
};

export type StudioTheme = "light" | "dark" | "memphis";

export type StudioSettings = {
  workspaceRoot: string;
  onboardingCompleted: boolean;
  defaultProviderProfileId?: string;
  locale: string;
  theme: StudioTheme;
  allowNetworkForProviders: boolean;
  agentMode: "mock" | "real";
};

export type OnboardingState = {
  step: number;
  workspaceRoot: string;
  preferLocalOnly: boolean;
  sampleProjectCreated: boolean;
  completed: boolean;
};

export type ConnectionTestResult = {
  ok: boolean;
  latencyMs?: number;
  /** Redacted error safe for UI — never contains API keys. */
  error?: string;
  modelsSample?: string[];
};

export type MediaProbeResult = {
  durationMs?: number;
  fps?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  formatName?: string;
  error?: string;
};

export type DiagnosticBundleResult = {
  path: string;
  bytes: number;
};

export type OpenResult = {
  ok: boolean;
  error?: string;
};

/** IPC channel names — single source of truth. */
export const IPC_CHANNELS = {
  appGetInfo: "studio:app:getInfo",
  settingsGet: "studio:settings:get",
  settingsUpdate: "studio:settings:update",
  onboardingGet: "studio:onboarding:get",
  onboardingComplete: "studio:onboarding:complete",
  projectList: "studio:project:list",
  projectCreate: "studio:project:create",
  projectOpen: "studio:project:open",
  projectDelete: "studio:project:delete",
  projectReveal: "studio:project:reveal",
  projectExportPackage: "studio:project:exportPackage",
  projectImportMedia: "studio:project:importMedia",
  projectListMedia: "studio:project:listMedia",
  projectProbeMedia: "studio:project:probeMedia",
  dialogSelectDirectory: "studio:dialog:selectDirectory",
  dialogSelectVideo: "studio:dialog:selectVideo",
  dialogSelectSavePath: "studio:dialog:selectSavePath",
  agentStatus: "studio:agent:status",
  agentRestart: "studio:agent:restart",
  jobCreate: "studio:job:create",
  jobGet: "studio:job:get",
  jobList: "studio:job:list",
  jobCancel: "studio:job:cancel",
  jobRetry: "studio:job:retry",
  jobRevealArtifact: "studio:job:revealArtifact",
  providerList: "studio:provider:list",
  providerCatalog: "studio:provider:catalog",
  providerUpsert: "studio:provider:upsert",
  providerDelete: "studio:provider:delete",
  providerTest: "studio:provider:test",
  depsList: "studio:deps:list",
  depsRefresh: "studio:deps:refresh",
  cacheClear: "studio:cache:clear",
  diagnosticsExport: "studio:diagnostics:export",
  shellOpenExternal: "studio:shell:openExternal",
  shellShowItem: "studio:shell:showItem",
  pathJoin: "studio:path:join",
  mediaPreviewUrl: "studio:media:previewUrl",
  mediaSaveRecording: "studio:media:saveRecording",
  assistantScript: "studio:assistant:script",
  assistantCoach: "studio:assistant:coach",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type AppInfo = {
  name: string;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  electron: string;
  isPackaged: boolean;
  userDataPath: string;
};

export type CreateProjectInput = {
  name: string;
  parentDirectory: string;
  providerProfileId?: string;
};

export type CreateJobInput = {
  projectId: string;
  mediaAssetId: string;
  prompt?: string;
  title?: string;
  providerProfileId?: string;
};

export type UpdateSettingsInput = Partial<
  Pick<
    StudioSettings,
    | "workspaceRoot"
    | "defaultProviderProfileId"
    | "locale"
    | "theme"
    | "allowNetworkForProviders"
    | "agentMode"
  >
>;

export type CompleteOnboardingInput = {
  workspaceRoot: string;
  preferLocalOnly: boolean;
  createSampleProject: boolean;
  addRemoteProvider?: boolean;
};

/** Stage labels for UI — honest, not decorative. */
export const STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  "inspecting-source": "检查源文件",
  "preparing-source": "准备源素材",
  transcribing: "转写字幕",
  "tracking-speaker": "跟脸分析",
  "planning-edit": "规划分镜",
  rendering: "渲染成片",
  "visual-quality-review": "视觉质检",
  verified: "质检验证",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  "mock-progress": "模拟处理",
};

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Redact secrets from free-form error text before UI/logging. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(api[_-]?key|authorization|bearer|token)\s*[:=]\s*["']?[^\s"',}]+/giu, "$1=[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, "sk-[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gu, "Bearer [REDACTED]");
}

export function maskSecret(value: string | undefined | null): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`;
}

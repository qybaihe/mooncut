import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {homedir} from "node:os";

const sourceDir = dirname(fileURLToPath(import.meta.url));

export const agentRoot = resolve(sourceDir, "..");
export const workspaceRoot = resolve(agentRoot, "..");
export const remotionRoot = join(workspaceRoot, "remotion-studio");
export const faceTrackerRoot = join(workspaceRoot, "face-tracker");
export const dataRoot = join(agentRoot, "data");
export const assetsRoot = join(dataRoot, "assets");
export const jobsRoot = join(dataRoot, "jobs");
export const agentRuntimeRoot = join(dataRoot, "pi-runtime");

const loadDotEnv = () => {
  const envPath = join(agentRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/u, "$2");
    if (process.env[name] === undefined) process.env[name] = value;
  }
};

loadDotEnv();

const integerEnv = (name: string, fallback: number) => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pathEnv = (name: string, fallback: string) => {
  const value = process.env[name] ?? fallback;
  return value === "~" || value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
};

const enumEnv = <T extends string>(name: string, values: readonly T[], fallback: T): T => {
  const value = process.env[name] as T | undefined;
  return value && values.includes(value) ? value : fallback;
};

export const config = {
  gatewayBaseUrl: (process.env.MOONCUT_GATEWAY_BASE_URL ?? "http://localhost:8080/v1").replace(/\/$/u, ""),
  gatewayApiKey: process.env.MOONCUT_GATEWAY_API_KEY ?? "",
  plannerModel: process.env.MOONCUT_PLANNER_MODEL ?? "glm-5.2",
  scriptModel: process.env.MOONCUT_SCRIPT_MODEL ?? process.env.MOONCUT_PLANNER_MODEL ?? "glm-5.2",
  coachModel: process.env.MOONCUT_COACH_MODEL ?? "deepseek-v4-flash",
  imageGenerationBaseUrl: (process.env.MOONCUT_IMAGE_BASE_URL ?? "").replace(/\/$/u, ""),
  imageGenerationApiKey: process.env.MOONCUT_IMAGE_API_KEY ?? "",
  imageGenerationModel: process.env.MOONCUT_IMAGE_MODEL ?? "",
  imageGenerationMaxImages: Math.min(2, Math.max(0, integerEnv("MOONCUT_IMAGE_MAX_IMAGES", 2))),
  imageGenerationSize: process.env.MOONCUT_IMAGE_SIZE ?? "1536x1024",
  imageGenerationTimeoutMs: integerEnv("MOONCUT_IMAGE_TIMEOUT_MS", 180_000),
  visionModels: (process.env.MOONCUT_VISION_MODELS ?? "minimax-m3,mimo-v2.5")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
  visionRequestTimeoutMs: integerEnv("MOONCUT_VISION_TIMEOUT_MS", 120_000),
  host: process.env.MOONCUT_AGENT_HOST ?? "127.0.0.1",
  port: integerEnv("MOONCUT_AGENT_PORT", 4317),
  apiKeys: (process.env.MOONCUT_API_KEYS ?? process.env.MOONCUT_API_KEY ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean),
  allowLocalInputPath: process.env.MOONCUT_ALLOW_INPUT_PATH === "true",
  maxQueuedJobs: integerEnv("MOONCUT_MAX_QUEUED_JOBS", 8),
  // The conversational Pi planner remains available for experimentation, but
  // production must not leave a video task in an unbounded tool-call loop.
  agentExecutionMode: enumEnv("MOONCUT_AGENT_EXECUTION_MODE", ["reliable", "pi"] as const, "reliable"),
  // Server default: a review-ready 16:9 render that avoids swapping on the
  // small CPU worker. These remain configurable per deployment.
  renderWidth: Math.max(320, integerEnv("MOONCUT_RENDER_WIDTH", 1280)),
  renderHeight: Math.max(180, integerEnv("MOONCUT_RENDER_HEIGHT", 720)),
  renderFps: Math.min(60, Math.max(12, integerEnv("MOONCUT_RENDER_FPS", 24))),
  renderConcurrency: integerEnv("MOONCUT_RENDER_CONCURRENCY", 1),
  // Desktop-grade 1080p compositions can take far longer than the source clip
  // on a modest CPU-only server. Do not let a healthy long edit inherit an
  // arbitrary short command timeout.
  renderTimeoutMs: Math.max(60_000, integerEnv("MOONCUT_RENDER_TIMEOUT_MS", 2 * 60 * 60_000)),
  browserExecutable: process.env.MOONCUT_BROWSER_EXECUTABLE || undefined,
  databasePath: pathEnv("MOONCUT_DATABASE_PATH", join(dataRoot, "mooncut.sqlite")),
  sessionDays: Math.min(90, Math.max(1, integerEnv("MOONCUT_SESSION_DAYS", 30))),
  cookieSecure: process.env.MOONCUT_COOKIE_SECURE === "true",
  publicBaseUrl: (process.env.MOONCUT_PUBLIC_BASE_URL ?? "").replace(/\/$/u, ""),
  mailCliPath: pathEnv("MOONCUT_MAIL_CLI", "/opt/homebrew/bin/agently-cli"),
  mailSenderName: process.env.MOONCUT_MAIL_SENDER_NAME ?? "MoonCut 小月",
  mailTransport: enumEnv("MOONCUT_MAIL_TRANSPORT", ["agently-cli", "webhook"] as const, "agently-cli"),
  mailWebhookUrl: (process.env.MOONCUT_MAIL_WEBHOOK_URL ?? "").trim(),
  mailWebhookToken: process.env.MOONCUT_MAIL_WEBHOOK_TOKEN ?? "",
  mailFromAddress: process.env.MOONCUT_MAIL_FROM_ADDRESS ?? "",
  corsOrigins: (process.env.MOONCUT_CORS_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/u, ""))
    .filter(Boolean),
  subtitleApiUrl: (process.env.MOONCUT_SUBTITLE_API_URL ?? "http://127.0.0.1:8765").replace(/\/$/u, ""),
  subtitleApiKey: process.env.MOONCUT_SUBTITLE_API_KEY ?? "integration-test",
  // Fixture transcripts make local UI work convenient, but must never hide the
  // production ASR path unless a developer opts in deliberately.
  allowKnownSubtitleFixtures: process.env.MOONCUT_ALLOW_KNOWN_SUBTITLE_FIXTURES === "true",
  // A production edit should fail visibly instead of silently replacing MiMo
  // text with the lower-accuracy local Whisper fallback.
  requireSubtitleService: process.env.MOONCUT_REQUIRE_SUBTITLE_SERVICE === "true",
  subtitleJobTimeoutMs: integerEnv("MOONCUT_SUBTITLE_JOB_TIMEOUT_MS", 45 * 60_000),
  subtitlePollIntervalMs: Math.max(500, integerEnv("MOONCUT_SUBTITLE_POLL_INTERVAL_MS", 2_000)),
  maxUploadBytes: integerEnv("MOONCUT_MAX_UPLOAD_MB", 2048) * 1024 * 1024,
  transcribePython: pathEnv("MOONCUT_TRANSCRIBE_PYTHON", join(agentRoot, ".venv-transcribe/bin/python")),
  whisperModel: process.env.MOONCUT_WHISPER_MODEL ?? "small",
  whisperLanguage: process.env.MOONCUT_WHISPER_LANGUAGE ?? "auto",
  xPostCaptureScript: pathEnv("MOONCUT_X_POST_CAPTURE_SCRIPT", join(homedir(), ".codex/skills/x-post-screenshot/scripts/x_post_capture.py")),
  playwrightCli: pathEnv("MOONCUT_PLAYWRIGHT_CLI", join(homedir(), ".codex/skills/playwright/scripts/playwright_cli.sh")),
};

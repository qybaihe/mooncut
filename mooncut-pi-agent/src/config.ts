import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {homedir} from "node:os";

const sourceDir = dirname(fileURLToPath(import.meta.url));

export const agentRoot = resolve(
  process.env.MOONCUT_AGENT_ROOT ? resolve(process.env.MOONCUT_AGENT_ROOT) : resolve(sourceDir, ".."),
);

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

const booleanEnv = (name: string, fallback: boolean) => {
  const value = process.env[name]?.trim().toLocaleLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
};

const pathEnv = (name: string, fallback: string) => {
  const value = process.env[name] ?? fallback;
  return value === "~" || value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(value);
};

/** Workspace containing remotion/face-tracker (monorepo or packaged mooncut-runtime). */
export const workspaceRoot = pathEnv("MOONCUT_WORKSPACE_ROOT", resolve(agentRoot, ".."));
export const remotionRoot = pathEnv("MOONCUT_REMOTION_ROOT", join(workspaceRoot, "remotion-studio"));
export const faceTrackerRoot = pathEnv("MOONCUT_FACE_TRACKER_ROOT", join(workspaceRoot, "face-tracker"));

/**
 * Writable data isolation root. Studio injects MOONCUT_DATA_ROOT under userData;
 * default remains agentRoot/data for standalone server deployments.
 */
export const dataRoot = pathEnv("MOONCUT_DATA_ROOT", join(agentRoot, "data"));
export const assetsRoot = pathEnv("MOONCUT_ASSETS_ROOT", join(dataRoot, "assets"));
export const jobsRoot = pathEnv("MOONCUT_JOBS_ROOT", join(dataRoot, "jobs"));
export const agentRuntimeRoot = pathEnv("MOONCUT_AGENT_RUNTIME_ROOT", join(dataRoot, "pi-runtime"));
export const capabilityArtifactsRoot = pathEnv("MOONCUT_CAPABILITY_ARTIFACTS_ROOT", join(dataRoot, "capability-artifacts"));

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
  // reliable = deterministic tool pipeline (no conversational planner).
  // pi      = experimental Pi coding-agent planner over the same tools.
  // grok    = Grok Build headless agent over the same tools (Pi replacement path).
  agentExecutionMode: enumEnv("MOONCUT_AGENT_EXECUTION_MODE", ["reliable", "pi", "grok"] as const, "reliable"),
  // Grok Build CLI (non-interactive). Used when agentExecutionMode=grok.
  grokBinary: process.env.MOONCUT_GROK_BINARY ?? "grok",
  grokModel: process.env.MOONCUT_GROK_MODEL ?? "grok-4.5",
  grokReasoningEffort: process.env.MOONCUT_GROK_REASONING_EFFORT ?? "max",
  grokMaxTurns: Math.max(20, integerEnv("MOONCUT_GROK_MAX_TURNS", 120)),
  // Long enough for Remotion + research; override per deployment.
  grokTimeoutMs: Math.max(120_000, integerEnv("MOONCUT_GROK_TIMEOUT_MS", 45 * 60_000)),
  // Deliverable default: full-HD 16:9. Low-resolution output must be an
  // explicit deployment override, never an implicit quality downgrade.
  renderWidth: Math.max(320, integerEnv("MOONCUT_RENDER_WIDTH", 1920)),
  renderHeight: Math.max(180, integerEnv("MOONCUT_RENDER_HEIGHT", 1080)),
  renderFps: Math.min(60, Math.max(12, integerEnv("MOONCUT_RENDER_FPS", 30))),
  renderConcurrency: integerEnv("MOONCUT_RENDER_CONCURRENCY", 1),
  // Talking-head delivery cleanup is local and non-destructive. The original
  // upload remains intact; only the derived source supplied to Remotion changes.
  speechCleanupEnabled: booleanEnv("MOONCUT_SPEECH_CLEANUP_ENABLED", true),
  speechCleanupMinSilenceMs: Math.max(350, integerEnv("MOONCUT_SPEECH_CLEANUP_MIN_SILENCE_MS", 750)),
  speechCleanupRetainedSilenceMs: Math.max(80, integerEnv("MOONCUT_SPEECH_CLEANUP_RETAINED_SILENCE_MS", 190)),
  speechCleanupFillerPaddingMs: Math.max(0, integerEnv("MOONCUT_SPEECH_CLEANUP_FILLER_PADDING_MS", 80)),
  speechCleanupWordGuardMs: Math.max(20, integerEnv("MOONCUT_SPEECH_CLEANUP_WORD_GUARD_MS", 55)),
  // Desktop-grade 1080p compositions can take far longer than the source clip
  // on a modest CPU-only server. Do not let a healthy long edit inherit an
  // arbitrary short command timeout.
  renderTimeoutMs: Math.max(60_000, integerEnv("MOONCUT_RENDER_TIMEOUT_MS", 2 * 60 * 60_000)),
  browserExecutable: process.env.MOONCUT_BROWSER_EXECUTABLE || undefined,
  databasePath: pathEnv("MOONCUT_DATABASE_PATH", join(dataRoot, "mooncut.sqlite")),
  // Bundled releases use this to detect accidental database/content tampering.
  // Production deployments must override the development fallback.
  capabilitySigningKey: process.env.MOONCUT_CAPABILITY_SIGNING_KEY ?? "mooncut-development-capability-signing-key",
  capabilityArtifactsRoot,
  fifaCliPath: pathEnv("MOONCUT_FIFA_CLI_PATH", join(workspaceRoot, "fifa-highlights-cli/dist/index.js")),
  fifaCliCwd: pathEnv("MOONCUT_FIFA_CLI_CWD", join(workspaceRoot, "fifa-highlights-cli")),
  sessionDays: Math.min(90, Math.max(1, integerEnv("MOONCUT_SESSION_DAYS", 30))),
  cookieSecure: booleanEnv("MOONCUT_COOKIE_SECURE", false),
  // When true, browser session cookies are ignored — only service key (+ optional
  // X-MoonCut-User-Id from Cloudflare edge) can call protected routes.
  edgeAuthOnly: booleanEnv("MOONCUT_EDGE_AUTH_ONLY", false),
  /**
   * Explicit production guard for an Agent reachable through a Tunnel or a
   * network listener. It intentionally stays false for desktop/localhost use.
   */
  publicDeployment: booleanEnv("MOONCUT_PUBLIC_DEPLOYMENT", false),
  publicBaseUrl: (process.env.MOONCUT_PUBLIC_BASE_URL ?? "").replace(/\/$/u, ""),
  mailCliPath: pathEnv("MOONCUT_MAIL_CLI", "/opt/homebrew/bin/agently-cli"),
  mailSenderName: process.env.MOONCUT_MAIL_SENDER_NAME ?? "MoonCut 小月",
  mailTransport: enumEnv("MOONCUT_MAIL_TRANSPORT", ["agently-cli", "webhook", "resend"] as const, "agently-cli"),
  mailWebhookUrl: (process.env.MOONCUT_MAIL_WEBHOOK_URL ?? "").trim(),
  mailWebhookToken: process.env.MOONCUT_MAIL_WEBHOOK_TOKEN ?? "",
  mailFromAddress: process.env.MOONCUT_MAIL_FROM_ADDRESS ?? "",
  // Resend API key (https://resend.com/api-keys). Prefer over agently-cli for unattended delivery.
  resendApiKey: (process.env.MOONCUT_RESEND_API_KEY ?? "").trim(),
  // HMAC secret for email download links (?token=...). Falls back to API key when unset.
  mailDownloadSecret: (process.env.MOONCUT_MAIL_DOWNLOAD_SECRET
    ?? process.env.MOONCUT_API_KEY
    ?? "").trim(),
  // How long a mailed download link stays valid (hours). Default 7 days.
  mailDownloadTtlHours: Math.min(30 * 24, Math.max(1, integerEnv("MOONCUT_MAIL_DOWNLOAD_TTL_HOURS", 168))),
  // After a job completes, automatically deliver mail (agently / webhook / resend).
  mailAutoSend: booleanEnv("MOONCUT_MAIL_AUTO_SEND", true),
  // Attach the ~20MB mail preview (final-mail.mp4), not the full-quality master.
  mailAttachVideo: booleanEnv("MOONCUT_MAIL_ATTACH_VIDEO", true),
  // Target size for the emailed preview encode (raw bytes before Base64).
  mailPreviewTargetBytes: integerEnv("MOONCUT_MAIL_PREVIEW_TARGET_MB", 20) * 1024 * 1024,
  // Mail attachment only: re-encode master down to this max height (default 720).
  // Remotion still renders at MOONCUT_RENDER_WIDTH/HEIGHT (1080p) — never change that for email size.
  mailPreviewMaxHeight: Math.min(2160, Math.max(360, integerEnv("MOONCUT_MAIL_PREVIEW_MAX_HEIGHT", 720))),
  // Hard cap for email attachments (Resend total message ≤40MB incl. Base64 ≈ ~28MB raw).
  mailAttachMaxBytes: integerEnv("MOONCUT_MAIL_ATTACH_MAX_MB", 22) * 1024 * 1024,
  // Membership CTA in completion mail.
  mailMembershipUrl: (process.env.MOONCUT_MAIL_MEMBERSHIP_URL ?? "https://mooncut.me").replace(/\/$/u, ""),
  // Browser Origin is forwarded by the Pages /api proxy even for same-site
  // traffic, so production web hosts must be listed here (or via env).
  corsOrigins: (process.env.MOONCUT_CORS_ORIGINS
    ?? [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "https://mooncut.me",
      "https://www.mooncut.me",
      "https://mooncut.pages.dev",
    ].join(","))
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

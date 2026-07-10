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

export const config = {
  gatewayBaseUrl: (process.env.MOONCUT_GATEWAY_BASE_URL ?? "http://localhost:8080/v1").replace(/\/$/u, ""),
  gatewayApiKey: process.env.MOONCUT_GATEWAY_API_KEY ?? "",
  plannerModel: process.env.MOONCUT_PLANNER_MODEL ?? "glm-5.2",
  visionModels: (process.env.MOONCUT_VISION_MODELS ?? "minimax-m3,mimo-v2.5")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
  host: process.env.MOONCUT_AGENT_HOST ?? "127.0.0.1",
  port: integerEnv("MOONCUT_AGENT_PORT", 4317),
  subtitleApiUrl: (process.env.MOONCUT_SUBTITLE_API_URL ?? "http://127.0.0.1:8765").replace(/\/$/u, ""),
  subtitleApiKey: process.env.MOONCUT_SUBTITLE_API_KEY ?? "integration-test",
  maxUploadBytes: integerEnv("MOONCUT_MAX_UPLOAD_MB", 2048) * 1024 * 1024,
  xPostCaptureScript: pathEnv("MOONCUT_X_POST_CAPTURE_SCRIPT", join(homedir(), ".codex/skills/x-post-screenshot/scripts/x_post_capture.py")),
  playwrightCli: pathEnv("MOONCUT_PLAYWRIGHT_CLI", join(homedir(), ".codex/skills/playwright/scripts/playwright_cli.sh")),
};

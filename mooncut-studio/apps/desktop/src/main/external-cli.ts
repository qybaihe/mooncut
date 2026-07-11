/**
 * External CLI agent adapter — lets users plug their own Claude Code / OpenCode
 * CLI into MoonCut Studio, skipping the bundled pi-agent and model configuration.
 *
 * Flow:
 *   1. buildScriptSystemPrompt(action) builds a strict-JSON system prompt.
 *   2. resolveCliCommand(config) → `which claude` → `which opencode`, or use a
 *      user-supplied absolute path. Throws ExternalCliNotFoundError when neither
 *      exists.
 *   3. spawnCli(command, args, prompt, childHome) spawns the CLI non-interactively
 *      with a single `-p "<prompt>"` argument, 30s timeout.
 *   4. parseCliOutput(stdout) extracts a JSON object matching the assistant
 *      script assistant shape. Throws CliJsonParseError when not valid JSON.
 *
 * Coach (real-time teleprompter advice) does NOT call this path — it stays on
 * local `useSpeakingCoach` rules in the renderer (see ipc.ts assistantCoach).
 */
import {spawn, spawnSync} from "node:child_process";
import {homedir} from "node:os";
import type {ExternalCliConfig} from "@mooncut/studio-shared";

/** Marker string so the renderer can detect a "CLI not installed" fallback case. */
export const EXTERNAL_CLI_NOT_FOUND_SENTINEL =
  "mooncut:external-cli:not-found";

/** Marker string so the renderer can detect a "CLI ran but output was unparseable" case. */
export const EXTERNAL_CLI_PARSE_ERROR_SENTINEL =
  "mooncut:external-cli:parse-error";

export class ExternalCliNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalCliNotFoundError";
  }
}

export class CliJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliJsonParseError";
  }
}

/** Wire format returned by the assistant script endpoint (mirrors pi-agent). */
type ScriptAssistantResponse = {
  reply: string;
  phase: "discover" | "outline" | "draft";
  ready: boolean;
  draft: string;
  petMessage: string;
  suggestions: Array<{eyebrow: string; title: string; detail: string}>;
  model: string;
};

/** Run-as-stdin payload from the renderer (RecordStudio requestScriptAssistant). */
type IncomingBody = {
  action?: "guide" | "generate" | "polish";
  style?: "oral" | "short" | "emotional";
  messages: Array<{role: "assistant" | "user"; content: string}>;
  draft?: string;
};

const CLI_TIMEOUT_MS = 30_000;

/** Build the strict-JSON system prompt the CLI must obey. */
function buildScriptSystemPrompt(action: IncomingBody["action"]): string {
  const actionLabel =
    action === "generate"
      ? "把所选方向融合为唯一一篇 60–90 秒完整口播稿"
      : action === "polish"
        ? "在保留原意前提下润色当前口播稿"
        : "和用户一起拆解主题、给 3 条互不相同的表达角度";
  return [
    "你是 MoonCut Studio 的口播创作助手。",
    `本次任务：${actionLabel}。`,
    "你必须只输出一个 JSON 对象，不要输出任何解释、markdown 代码块或前后空白以外的字符。",
    "JSON schema：",
    "{",
    '  "reply": "对用户的简短回应（1–3 句，口语化，不要大标题）",',
    '  "phase": "discover | outline | draft",',
    '  "ready": false,',
    '  "draft": "完整口播稿纯文本，guide 阶段通常为空；generate/polish 必须给出可直接念的稿",',
    '  "petMessage": "一句品牌吉祥物口播提示，活泼但克制",',
    '  "suggestions": [',
    '    {"eyebrow": "短标签","title": "一句话角度","detail": "1 句具体补充"},',
    '    {"eyebrow": "...","title": "...","detail": "..."},',
    '    {"eyebrow": "...","title": "...","detail": "..."}',
    "  ],",
    '  "model": "你刚才自报的命令名称，如 claude-code / opencode"',
    "}",
    "要求：suggestions 数组必须正好 3 条且互不相同；draft 不要写标题/分隔线/创作说明；reply 里不要重复 draft。",
  ].join("\n");
}

/** Build the user prompt from the conversation + draft. */
function buildScriptUserPrompt(body: IncomingBody): string {
  const lines: string[] = [];
  if (body.style) lines.push(`风格要求：${body.style}`);
  if (body.draft && body.draft.trim()) {
    lines.push(`当前已有口播稿（参考/润色）：\n${body.draft.trim()}`);
  }
  lines.push("对话历史：");
  for (const message of body.messages ?? []) {
    lines.push(`${message.role === "assistant" ? "助手" : "我"}：${message.content}`);
  }
  lines.push("请按 system 要求输出 JSON。");
  return lines.join("\n");
}

/** Resolve the CLI executable. */
export function resolveCliCommand(
  config: ExternalCliConfig,
): {command: string; args: string[]} {
  const explicit = config.commandPath?.trim();
  if (explicit) {
    // Allow "node /path/to/script.cjs" style multi-token commands so users
    // (and tests) can wrap arbitrary node scripts as a fake CLI.
    const tokens = explicit.split(/\s+/).filter(Boolean);
    const command = tokens[0];
    if (!command) {
      throw new ExternalCliNotFoundError("commandPath 为空，无法启动外部 CLI。");
    }
    const presetArgs = tokens.slice(1);
    return {command, args: presetArgs};
  }
  const targets =
    config.kind === "opencode"
      ? ["opencode", "claude"]
      : ["claude", "opencode"];
  for (const candidate of targets) {
    const probe =
      process.platform === "win32"
        ? spawnSync("where", [candidate], {encoding: "utf8"})
        : spawnSync("which", [candidate], {encoding: "utf8"});
    const out = typeof probe.stdout === "string" ? probe.stdout.trim() : "";
    if (probe.status === 0 && out) {
      const first = out.split(/\r?\n/)[0] ?? candidate;
      return {command: first, args: []};
    }
  }
  throw new ExternalCliNotFoundError(
    `未检测到本地 ${targets.join(" / ")} 命令。请先安装 Claude Code 或 OpenCode，或在设置里手填命令绝对路径。`,
  );
}

/** Spawn the CLI with `[presetArgs...] -p "<prompt>"` collecting stdout, with timeout. */
export function spawnCli(
  command: string,
  prompt: string,
  presetArgs: string[] = [],
  timeoutMs = CLI_TIMEOUT_MS,
): Promise<string> {
  return new Promise<string>((resolveRun, rejectRun) => {
    const child = spawn(
      command,
      [...presetArgs, "-p", prompt],
      {
        env: {...process.env},
        cwd: homedir(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectRun(new Error(`外部 CLI 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectRun(
        new ExternalCliNotFoundError(
          `无法启动 ${command}：${error.message}。请确认命令已安装或在设置里手填路径。`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectRun(
          new Error(
            `外部 CLI 退出码 ${code}。${
              stderr ? stderr.slice(0, 240) : ""
            }`.trim(),
          ),
        );
        return;
      }
      resolveRun(stdout);
    });
  });
}

/** Extract the first JSON object from CLI stdout, tolerating fenced blocks. */
export function parseCliOutput(stdout: string): ScriptAssistantResponse {
  const trimmed = stdout.trim();
  // Tolerate ```json ... ``` wrappers from chatty CLIs.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch && fenceMatch[1] ? fenceMatch[1].trim() : trimmed;
  // Find the first `{` ... last `}` slice to ignore trailing prose.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new CliJsonParseError("CLI 输出未找到 JSON 对象");
  }
  const jsonSlice = candidate.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    throw new CliJsonParseError("CLI 输出 JSON 解析失败");
  }
  const obj = parsed as Partial<ScriptAssistantResponse>;
  if (typeof obj.reply !== "string" || !Array.isArray(obj.suggestions)) {
    throw new CliJsonParseError("CLI 输出缺少必要字段 reply/suggestions");
  }
  // Coalesce into a stable shape; default priori provides fallbacks.
  const result: ScriptAssistantResponse = {
    reply: obj.reply ?? "",
    phase: (obj.phase as ScriptAssistantResponse["phase"]) ?? "discover",
    ready: Boolean(obj.ready) || Boolean((obj.draft ?? "").trim()),
    draft: obj.draft ?? "",
    petMessage: obj.petMessage ?? "",
    suggestions: (obj.suggestions ?? []).slice(0, 3).map((s) => ({
      eyebrow: s?.eyebrow ?? "",
      title: s?.title ?? "",
      detail: s?.detail ?? "",
    })),
    model: obj.model ?? "external-cli",
  };
  return result;
}

/** Full entry point: from incoming body+config → ScriptAssistantResponse. */
export async function runExternalCliAssistant(
  body: unknown,
  config: ExternalCliConfig,
): Promise<ScriptAssistantResponse> {
  const incoming = (body ?? {}) as IncomingBody;
  const {command, args} = resolveCliCommand(config);
  const prompt = [
    "=== SYSTEM ===",
    buildScriptSystemPrompt(incoming.action),
    "=== USER ===",
    buildScriptUserPrompt(incoming),
  ].join("\n");
  const stdout = await spawnCli(command, prompt, args);
  return parseCliOutput(stdout);
}

/** Helper for ipc tests: produce an error message with the sentinel prefix. */
export function sentinelError(kind: "not-found" | "parse-error", detail: string): string {
  const sentinel =
    kind === "not-found"
      ? EXTERNAL_CLI_NOT_FOUND_SENTINEL
      : EXTERNAL_CLI_PARSE_ERROR_SENTINEL;
  return `${sentinel}: ${detail}`;
}
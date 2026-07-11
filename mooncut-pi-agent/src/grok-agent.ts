import {existsSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {agentRoot, config, workspaceRoot} from "./config.ts";
import {
  hydrateFromArtifacts,
  hydrateRunContext,
  loadRunContext,
  saveRunContext,
} from "./context-store.ts";
import {invokeMooncutTool, missingRequiredStages, REQUIRED_TOOL_SEQUENCE} from "./tool-runner.ts";
import type {StageUpdate} from "./tools.ts";
import type {RunContext} from "./types.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stageFromContext = (context: RunContext): {stage: string; progress: number} => {
  if (context.verificationPath) return {stage: "verified", progress: 0.99};
  if (context.renderPath) return {stage: "rendered", progress: 0.92};
  if (context.spec) return {stage: "edit-planned", progress: 0.66};
  if (context.faceTrack !== undefined) return {stage: "speaker-tracked", progress: 0.60};
  if (context.imageSchedule) return {stage: "visuals-scheduled", progress: 0.50};
  if (context.speechCleanup) return {stage: "speech-cleaned", progress: 0.44};
  if (context.subtitles) return {stage: "transcribed", progress: 0.34};
  if (context.probe) return {stage: "source-inspected", progress: 0.18};
  return {stage: "grok-planning", progress: 0.10};
};

const buildTaskPrompt = async (context: RunContext, skillText: string): Promise<string> => {
  const lessons = await readFile(join(agentRoot, "memory/lessons.json"), "utf8").catch(() => "[]");
  const userPrompt = context.job.request.prompt ?? "按默认 MoonCut 原生 macOS 口播规范剪辑";
  const toolBinary = `node --experimental-strip-types ${join(agentRoot, "src/cli.ts")}`;
  return [
    skillText.trim(),
    "",
    "## This job",
    "",
    `- Job ID: \`${context.job.id}\``,
    `- Job directory: \`${context.jobDir}\``,
    `- Source file: \`${context.job.inputPath}\``,
    `- Original name: \`${context.job.originalName}\``,
    `- Public remotion media: \`${context.publicMediaSrc}\``,
    `- User prompt: ${userPrompt}`,
    context.job.request.title ? `- Suggested title: ${context.job.request.title}` : "",
    context.job.request.imageGeneration === "off" ? "- Image generation: forced off" : "- Image generation: auto (still prefer zero)",
    context.evidenceAssets.length
      ? `- Preloaded evidence (must use if relevant): ${context.evidenceAssets.map((asset) => `${asset.id} (${asset.label})`).join(", ")}`
      : "- Preloaded evidence: none",
    "",
    "## Tool CLI (cwd = mooncut-pi-agent package root)",
    "",
    "```bash",
    `cd ${agentRoot}`,
    `${toolBinary} tool ${context.jobDir} inspect_source`,
    `${toolBinary} tool ${context.jobDir} transcribe_source`,
    `${toolBinary} tool ${context.jobDir} clean_speech_delivery`,
    `${toolBinary} tool ${context.jobDir} schedule_generated_visuals`,
    `${toolBinary} tool ${context.jobDir} track_speaker`,
    `${toolBinary} tool ${context.jobDir} capture_web_page '{"url":"https://example.com","label":"示例"}'`,
    `${toolBinary} tool ${context.jobDir} save_edit_spec '{"title":"...","summary":"...","accent":"#65d9b6","beats":[...]}'`,
    `${toolBinary} tool ${context.jobDir} render_edit`,
    `${toolBinary} tool ${context.jobDir} verify_render`,
    "```",
    "",
    "## Persistent lessons (mandatory)",
    "",
    "```json",
    lessons.trim(),
    "```",
    "",
    "Execute the full pipeline now. Prefer the tool CLI. Finish only after verify_render succeeds and final.mp4 exists.",
  ].filter(Boolean).join("\n");
};

const runGrokProcess = async (
  context: RunContext,
  promptPath: string,
  logPath: string,
  update: StageUpdate,
): Promise<{exitCode: number; sessionHint?: string}> => {
  await update("grok-agent-running", 0.12);
  const args = [
    "-m", config.grokModel,
    "--reasoning-effort", config.grokReasoningEffort,
    "--always-approve",
    "--permission-mode", "bypassPermissions",
    "--max-turns", String(config.grokMaxTurns),
    "--cwd", workspaceRoot,
    "--prompt-file", promptPath,
    "--output-format", "streaming-json",
    "--no-auto-update",
  ];

  const child = spawn(config.grokBinary, args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logChunks: string[] = [];
  const append = async (chunk: string) => {
    logChunks.push(chunk);
    // Keep log reasonably fresh for operators without rewriting every byte thrice.
    if (logChunks.join("").length % 8_000 < chunk.length) {
      await writeFile(logPath, logChunks.join(""));
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    void append(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    void append(chunk);
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 8_000).unref?.();
  }, config.grokTimeoutMs);

  const progressTimer = setInterval(() => {
    void (async () => {
      try {
        if (existsSync(join(context.jobDir, "run-context.json"))) {
          const disk = await loadRunContext(context.jobDir);
          hydrateRunContext(context, disk);
        } else {
          await hydrateFromArtifacts(context);
        }
        const {stage, progress} = stageFromContext(context);
        await update(stage, progress);
      } catch {
        // Progress polling is best-effort.
      }
    })();
  }, 5_000);

  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolvePromise(code ?? -1));
  });

  clearTimeout(timeout);
  clearInterval(progressTimer);
  await writeFile(logPath, logChunks.join(""));
  if (timedOut) throw new Error(`Grok agent timed out after ${config.grokTimeoutMs}ms`);

  const sessionMatch = logChunks.join("").match(/"sessionId"\s*:\s*"([^"]+)"/u);
  return {exitCode, sessionHint: sessionMatch?.[1]};
};

/**
 * Finish any missing production stages with the shared tools after Grok exits.
 * Planning (save_edit_spec) is never invented here — Grok (or a prior tool call)
 * must have produced a valid edit-spec. Render/verify can be recovered.
 */
const recoverMissingStages = async (context: RunContext, update: StageUpdate) => {
  await hydrateFromArtifacts(context);

  // If Grok wrote edit-spec via free-form means without tool CLI, load it.
  const specPath = join(context.jobDir, "edit-spec.json");
  if (!context.spec && existsSync(specPath)) {
    context.spec = JSON.parse(await readFile(specPath, "utf8"));
  }

  const missing = missingRequiredStages(context);
  if (!missing.length) return;

  // Only auto-run deterministic tails and prep tools that are safe without new creative decisions.
  const recoverable = new Set([
    "inspect_source",
    "transcribe_source",
    "clean_speech_delivery",
    "schedule_generated_visuals",
    "track_speaker",
    "render_edit",
    "verify_render",
  ]);

  for (const name of REQUIRED_TOOL_SEQUENCE) {
    if (!missingRequiredStages(context).includes(name)) continue;
    if (!recoverable.has(name)) {
      throw new Error(
        `Grok agent stopped before creative stage "${name}" completed. Missing: ${missingRequiredStages(context).join(", ")}`,
      );
    }
    // save_edit_spec is not recoverable without beats; render needs spec.
    if (name === "render_edit" && !context.spec) {
      throw new Error("Cannot recover render_edit without edit-spec.json from Grok / save_edit_spec");
    }
    await invokeMooncutTool(context, update, name, {}, `grok-recover-${name}`);
  }
};

export const runGrokEditingAgent = async (
  context: RunContext,
  update: StageUpdate,
): Promise<string> => {
  await mkdir(context.jobDir, {recursive: true});
  await saveRunContext(context);

  const skillPath = join(agentRoot, "prompts/GROK_EDITING_AGENT.md");
  const skillText = await readFile(skillPath, "utf8");
  const promptPath = join(context.jobDir, "GROK_PROMPT.md");
  const logPath = join(context.jobDir, "grok-headless.log");
  const eventsPath = join(context.jobDir, "grok-events.jsonl");

  await writeFile(promptPath, `${await buildTaskPrompt(context, skillText)}\n`);
  await writeFile(join(context.jobDir, "grok-launch.json"), `${JSON.stringify({
    model: config.grokModel,
    reasoningEffort: config.grokReasoningEffort,
    maxTurns: config.grokMaxTurns,
    binary: config.grokBinary,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  let launchError: string | undefined;
  try {
    const result = await runGrokProcess(context, promptPath, logPath, update);
    await writeFile(eventsPath, `${JSON.stringify({
      type: "grok_exit",
      exitCode: result.exitCode,
      sessionId: result.sessionHint,
      at: new Date().toISOString(),
    })}\n`, {flag: "a"});
    if (result.exitCode !== 0) {
      launchError = `Grok process exited with code ${result.exitCode}`;
    }
  } catch (error) {
    launchError = error instanceof Error ? error.message : String(error);
    await writeFile(eventsPath, `${JSON.stringify({
      type: "grok_error",
      message: launchError,
      at: new Date().toISOString(),
    })}\n`, {flag: "a"});
  }

  // Always rehydrate from disk: Grok may have used the tool CLI or free-form writes.
  if (existsSync(join(context.jobDir, "run-context.json"))) {
    try {
      hydrateRunContext(context, await loadRunContext(context.jobDir));
    } catch {
      await hydrateFromArtifacts(context);
    }
  } else {
    await hydrateFromArtifacts(context);
  }

  try {
    await recoverMissingStages(context, update);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error([
      "Grok editing agent did not produce a complete verified render.",
      launchError ? `Grok launch issue: ${launchError}` : undefined,
      detail,
      `jobDir=${context.jobDir}`,
      `log=${logPath}`,
    ].filter(Boolean).join("\n"));
  }

  if (!context.verificationPath || !context.renderPath || !context.spec || !context.probe) {
    throw new Error(`Grok agent finished without required artifacts in ${context.jobDir}`);
  }

  const summaryFromFile = existsSync(join(context.jobDir, "agent-summary.txt"))
    ? await readFile(join(context.jobDir, "agent-summary.txt"), "utf8")
    : "";
  const summary = summaryFromFile.trim() || [
    "MoonCut Grok editing agent completed.",
    `video: ${context.renderPath}`,
    `spec: ${join(context.jobDir, "edit-spec.json")}`,
    `verification: ${context.verificationPath}`,
    launchError ? `note: ${launchError} (recovered via shared tools)` : undefined,
  ].filter(Boolean).join("\n");

  if (!summaryFromFile.trim()) {
    await writeFile(join(context.jobDir, "agent-summary.txt"), `${summary}\n`);
  }
  await saveRunContext(context);
  await update("completed", 1);
  return summary;
};

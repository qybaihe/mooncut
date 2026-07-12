import {existsSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join} from "node:path";
import {agentRoot, config, dataRoot, remotionRoot} from "./config.ts";
import {
  hydrateFromArtifacts,
  hydrateRunContext,
  loadRunContext,
  saveRunContext,
} from "./context-store.ts";
import {invokeMooncutTool, missingRequiredStages, REQUIRED_TOOL_SEQUENCE} from "./tool-runner.ts";
import type {StageUpdate} from "./tools.ts";
import type {RunContext} from "./types.ts";

const stageFromContext = (context: RunContext): {stage: string; progress: number} => {
  if (context.verificationPath) return {stage: "verified", progress: 0.99};
  if (context.renderPath) return {stage: "rendered", progress: 0.92};
  if (context.spec) return {stage: "edit-planned", progress: 0.66};
  if (context.faceTrack !== undefined) return {stage: "speaker-tracked", progress: 0.60};
  if (context.imageSchedule) return {stage: "visuals-scheduled", progress: 0.50};
  if (context.speechCleanup) return {stage: "speech-cleaned", progress: 0.44};
  if (context.subtitles) return {stage: "transcribed", progress: 0.34};
  if (context.probe) return {stage: "source-inspected", progress: 0.18};
  return {stage: "codex-planning", progress: 0.10};
};

const buildTaskPrompt = async (context: RunContext, skillText: string): Promise<string> => {
  const lessons = await readFile(join(agentRoot, "memory/lessons.json"), "utf8").catch(() => "[]");
  const userPrompt = context.job.request.prompt ?? "按默认 MoonCut 原生 macOS 口播规范剪辑";
  const toolBinary = `node --experimental-strip-types ${join(agentRoot, "src/cli.ts")}`;
  const imageDirectory = join(context.jobDir, "codex-imagegen");
  const diagramDirectory = join(context.jobDir, "codex-diagrams");
  return [
    skillText.trim(),
    "",
    "## This job",
    "",
    `- Job ID: \`${context.job.id}\``,
    `- Job directory: \`${context.jobDir}\``,
    `- Source file: \`${context.job.inputPath}\``,
    `- Original name: \`${context.job.originalName}\``,
    `- Public Remotion media: \`${context.publicMediaSrc}\``,
    `- User editorial request: ${userPrompt}`,
    context.job.request.title ? `- Suggested title: ${context.job.request.title}` : "",
    context.job.request.imageGeneration === "off"
      ? "- Image generation: forced off"
      : "- Image generation: auto; use ImageGen only for a necessary illustrative gap (maximum two)",
    context.evidenceAssets.length
      ? `- Preloaded evidence (must use if relevant): ${context.evidenceAssets.map((asset) => `${asset.id} (${asset.label})`).join(", ")}`
      : "- Preloaded evidence: none",
    "",
    "## Host preflight already completed",
    "",
    "The trusted MoonCut host has already completed inspect_source, transcribe_source, clean_speech_delivery, schedule_generated_visuals, and track_speaker outside your sandbox. Read their artifacts in the job directory before planning. Do not rerun those network-capable tools.",
    "",
    "## Authorized MoonCut tool CLI",
    "",
    "Use only this tool CLI to mutate task state or render. It persists run-context after every call.",
    "```bash",
    `cd ${agentRoot}`,
    `${toolBinary} tool ${context.jobDir} save_edit_spec '{"title":"...","summary":"...","accent":"#65d9b6","beats":[...]}'`,
    "```",
    "The trusted host runs render_edit and verify_render after you save a valid creative spec. Do not rerun them from the Codex sandbox.",
    "For evidence beats, you may supply evidencePanels (max three) only when sources add distinct information. Give each panel a unique purpose and role; choose parallel, comparison, or sequence mode. Keep one evidenceId when a second source would repeat, conflict without a clear comparison, or overload the frame.",
    "For desktop beats, select desktopTemplate=editorial|workflow|comparison|dashboard and add up to four visualItems when structured content improves comprehension. Omit them when the speaker shot is stronger.",
    "",
    "## ImageGen registration (only when actually needed and imageGeneration is auto)",
    "",
    `- Generate a text-free illustrative PNG with built-in ImageGen, then copy it below \`${imageDirectory}\`.`,
    `- Register it before planning the matching beat:`,
    "```bash",
    `${toolBinary} tool ${context.jobDir} import_codex_generated_visual '{"sourcePath":"${imageDirectory}/scene-01.png","label":"...","purpose":"...","prompt":"...","avoid":"文字、Logo、水印、二维码、真实人物和品牌标识","relatedQuote":"..."}'`,
    "```",
    "- Use only the returned generatedVisualId on a matching illustration beat. Never generate a factual-looking image or use it as evidence.",
    "",
    "## Hand-drawn diagram bridge (optional, for real process/relationship explanations)",
    "",
    "- Use the installed $excalidraw skill only when the narration explains a process, dependency, decision tree, or architecture that is clearer as a diagram.",
    `- Save both editable JSON and its rendered PNG below \`${diagramDirectory}\`.`,
    "- Register both files, then use only the returned diagramId on a diagram beat:",
    "```bash",
    `${toolBinary} tool ${context.jobDir} import_handdrawn_diagram '{"sourcePath":"${diagramDirectory}/flow.png","sourceExcalidrawPath":"${diagramDirectory}/flow.excalidraw","label":"...","purpose":"..."}'`,
    "```",
    "- A diagram explains structure. It is never evidence and must not repeat facts already visible in simultaneous evidence panels.",
    "",
    "## Persistent lessons (mandatory)",
    "",
    "```json",
    lessons.trim(),
    "```",
    "",
    "Execute the full pipeline now. Do not modify MoonCut source code. Finish only after verify_render succeeds and final.mp4 exists.",
  ].filter(Boolean).join("\n");
};

/**
 * Network-capable media/vision tools run in the trusted host before Codex is
 * launched. Codex keeps workspace-write isolation while retaining ownership of
 * the creative save_edit_spec decision and optional built-in ImageGen assets.
 */
const runCodexPreflight = async (context: RunContext, update: StageUpdate) => {
  const preflight = [
    "inspect_source",
    "transcribe_source",
    "clean_speech_delivery",
    "schedule_generated_visuals",
    "track_speaker",
  ] as const;
  for (const name of preflight) {
    if (!missingRequiredStages(context).includes(name)) continue;
    await invokeMooncutTool(context, update, name, {}, `codex-preflight-${name}`);
  }
};

const runCodexProcess = async (
  context: RunContext,
  prompt: string,
  logPath: string,
  finalMessagePath: string,
  update: StageUpdate,
): Promise<{exitCode: number; sessionHint?: string}> => {
  await update("codex-agent-running", 0.12);
  const args = [
    "exec",
    "--ephemeral",
    "--json",
    "--skip-git-repo-check",
    "--sandbox", "workspace-write",
    "-C", dataRoot,
    "--add-dir", join(remotionRoot, "public/agent-jobs"),
    "-m", config.codexModel,
    "-c", `model_reasoning_effort=\"${config.codexReasoningEffort}\"`,
    "-o", finalMessagePath,
    "-",
  ];
  const child = spawn(config.codexBinary, args, {
    cwd: dataRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const logChunks: string[] = [];
  const append = async (chunk: string) => {
    logChunks.push(chunk);
    if (logChunks.join("").length % 8_000 < chunk.length) {
      await writeFile(logPath, logChunks.join(""));
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { void append(chunk); });
  child.stderr.on("data", (chunk: string) => { void append(chunk); });
  child.stdin.end(prompt);

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 8_000).unref?.();
  }, config.codexTimeoutMs);
  const progressTimer = setInterval(() => {
    void (async () => {
      try {
        if (existsSync(join(context.jobDir, "run-context.json"))) {
          hydrateRunContext(context, await loadRunContext(context.jobDir));
        } else {
          await hydrateFromArtifacts(context);
        }
        const {stage, progress} = stageFromContext(context);
        await update(stage, progress);
      } catch {
        // Progress polling is best effort; final validation remains strict.
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
  if (timedOut) throw new Error(`Codex agent timed out after ${config.codexTimeoutMs}ms`);
  const sessionMatch = logChunks.join("").match(/"thread_id"\s*:\s*"([^"]+)"/u);
  return {exitCode, sessionHint: sessionMatch?.[1]};
};

const recoverMissingStages = async (context: RunContext, update: StageUpdate) => {
  await hydrateFromArtifacts(context);
  const specPath = join(context.jobDir, "edit-spec.json");
  if (!context.spec && existsSync(specPath)) {
    context.spec = JSON.parse(await readFile(specPath, "utf8"));
  }
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
      throw new Error(`Codex stopped before creative stage "${name}". Missing: ${missingRequiredStages(context).join(", ")}`);
    }
    if (name === "render_edit" && !context.spec) {
      throw new Error("Cannot recover render_edit without edit-spec.json from Codex / save_edit_spec");
    }
    await invokeMooncutTool(context, update, name, {}, `codex-recover-${name}`);
  }
};

export const runCodexEditingAgent = async (
  context: RunContext,
  update: StageUpdate,
): Promise<string> => {
  await mkdir(context.jobDir, {recursive: true});
  await mkdir(dataRoot, {recursive: true});
  await saveRunContext(context);
  await runCodexPreflight(context, update);

  const skillText = await readFile(join(agentRoot, "prompts/CODEX_EDITING_AGENT.md"), "utf8");
  const promptPath = join(context.jobDir, "CODEX_PROMPT.md");
  const logPath = join(context.jobDir, "codex-headless.log");
  const eventsPath = join(context.jobDir, "codex-events.jsonl");
  const finalMessagePath = join(context.jobDir, "codex-final-message.txt");
  const prompt = await buildTaskPrompt(context, skillText);
  await writeFile(promptPath, `${prompt}\n`);
  await writeFile(join(context.jobDir, "codex-launch.json"), `${JSON.stringify({
    model: config.codexModel,
    reasoningEffort: config.codexReasoningEffort,
    binary: config.codexBinary,
    sandbox: "workspace-write",
    workspace: dataRoot,
    writableRenderMedia: join(remotionRoot, "public/agent-jobs"),
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  let launchError: string | undefined;
  try {
    const result = await runCodexProcess(context, prompt, logPath, finalMessagePath, update);
    await writeFile(eventsPath, await readFile(logPath, "utf8"));
    if (result.exitCode !== 0) launchError = `Codex process exited with code ${result.exitCode}`;
  } catch (error) {
    launchError = error instanceof Error ? error.message : String(error);
    await writeFile(eventsPath, `${JSON.stringify({type: "codex_error", message: launchError, at: new Date().toISOString()})}\n`, {flag: "a"});
  }

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
      "Codex editing agent did not produce a complete verified render.",
      launchError ? `Codex launch issue: ${launchError}` : undefined,
      detail,
      `jobDir=${context.jobDir}`,
      `log=${logPath}`,
    ].filter(Boolean).join("\n"));
  }

  if (!context.verificationPath || !context.renderPath || !context.spec || !context.probe) {
    throw new Error(`Codex agent finished without required artifacts in ${context.jobDir}`);
  }
  const summaryFromFile = existsSync(join(context.jobDir, "agent-summary.txt"))
    ? await readFile(join(context.jobDir, "agent-summary.txt"), "utf8")
    : "";
  const codexFinal = existsSync(finalMessagePath) ? (await readFile(finalMessagePath, "utf8")).trim() : "";
  const summary = summaryFromFile.trim() || [
    "MoonCut Codex editing agent completed.",
    `video: ${context.renderPath}`,
    `spec: ${join(context.jobDir, "edit-spec.json")}`,
    `verification: ${context.verificationPath}`,
    codexFinal ? `Codex: ${codexFinal.slice(0, 800)}` : undefined,
    launchError ? `note: ${launchError} (recovered via shared tools)` : undefined,
  ].filter(Boolean).join("\n");
  if (!summaryFromFile.trim()) {
    await writeFile(join(context.jobDir, "agent-summary.txt"), `${summary}\n`);
  }
  await saveRunContext(context);
  await update("completed", 1);
  return summary;
};

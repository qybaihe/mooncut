import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {config} from "./config.ts";
import {loadRunContext, saveRunContext} from "./context-store.ts";
import {listGatewayModels} from "./gateway.ts";
import {jobManager} from "./jobs.ts";
import {startServer} from "./server.ts";
import {invokeMooncutTool, MOONCUT_TOOL_NAMES} from "./tool-runner.ts";

const [command = "serve", ...args] = process.argv.slice(2);

const usage = () => {
  console.log(`MoonCut editing agent CLI

Usage:
  node src/cli.ts serve
  node src/cli.ts models
  node src/cli.ts edit /absolute/path/video.mp4 [prompt...]
  node src/cli.ts tool <jobDir> <toolName> [jsonParams]

Execution mode is controlled by MOONCUT_AGENT_EXECUTION_MODE=reliable|pi|grok
Grok settings: MOONCUT_GROK_MODEL, MOONCUT_GROK_REASONING_EFFORT, MOONCUT_GROK_BINARY
`);
};

if (command === "serve") {
  await startServer();
} else if (command === "models") {
  const models = await listGatewayModels();
  console.log(JSON.stringify({
    gateway: config.gatewayBaseUrl,
    available: models,
    routing: {
      planner: config.plannerModel,
      vision: config.visionModels,
      agentExecutionMode: config.agentExecutionMode,
      grok: {
        binary: config.grokBinary,
        model: config.grokModel,
        reasoningEffort: config.grokReasoningEffort,
        maxTurns: config.grokMaxTurns,
      },
    },
  }, null, 2));
} else if (command === "edit") {
  const input = args[0];
  if (!input) throw new Error("Usage: npm run edit -- /absolute/path/video.mp4 [prompt]");
  const job = await jobManager.create({
    inputPath: resolve(input),
    prompt: args.slice(1).join(" ") || undefined,
  });
  console.log(`Queued ${job.id} mode=${config.agentExecutionMode}`);
  const completed = await jobManager.wait(job.id);
  console.log(JSON.stringify(completed, null, 2));
  if (completed.status !== "completed") process.exitCode = 1;
} else if (command === "tool") {
  const jobDir = args[0] ? resolve(args[0]) : "";
  const toolName = args[1];
  const paramsRaw = args[2] ?? "{}";
  if (!jobDir || !toolName) {
    throw new Error(`Usage: node src/cli.ts tool <jobDir> <toolName> [jsonParams]\nTools: ${MOONCUT_TOOL_NAMES.join(", ")}`);
  }
  if (!existsSync(jobDir)) throw new Error(`jobDir not found: ${jobDir}`);
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(paramsRaw) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON params: ${paramsRaw}`);
  }
  const context = await loadRunContext(jobDir);
  const stageLog: Array<{stage: string; progress: number; at: string}> = [];
  const text = await invokeMooncutTool(context, async (stage, progress) => {
    stageLog.push({stage, progress, at: new Date().toISOString()});
  }, toolName, params, `cli-${toolName}`);
  await saveRunContext(context);
  console.log(text);
  if (stageLog.length) {
    console.error(JSON.stringify({tool: toolName, stages: stageLog}, null, 2));
  }
} else if (command === "help" || command === "--help" || command === "-h") {
  usage();
} else {
  usage();
  throw new Error(`Unknown command: ${command}`);
}

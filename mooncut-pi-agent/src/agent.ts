import {readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import type {Model} from "@earendil-works/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  type ResourceLoader,
  type Skill,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {agentRoot, agentRuntimeRoot, config, workspaceRoot} from "./config.ts";
import {createMooncutTools, type StageUpdate} from "./tools.ts";
import type {RunContext} from "./types.ts";

const plannerModel = (): Model<"openai-completions"> => ({
  id: config.plannerModel,
  name: `MoonCut Planner · ${config.plannerModel}`,
  api: "openai-completions",
  provider: "mooncut-local",
  baseUrl: config.gatewayBaseUrl,
  reasoning: false,
  input: ["text"],
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
  contextWindow: 128_000,
  maxTokens: 8192,
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    supportsStrictMode: false,
    maxTokensField: "max_tokens",
  },
});

const createResourceLoader = (systemPrompt: string, skills: Skill[]): ResourceLoader => ({
  getExtensions: () => ({extensions: [], errors: [], runtime: createExtensionRuntime()}),
  getSkills: () => ({skills, diagnostics: []}),
  getPrompts: () => ({prompts: [], diagnostics: []}),
  getThemes: () => ({themes: [], diagnostics: []}),
  getAgentsFiles: () => ({agentsFiles: []}),
  getSystemPrompt: () => systemPrompt,
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
});

const finalAssistantText = (messages: readonly unknown[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") continue;
    if (!("content" in message) || !Array.isArray(message.content)) continue;
    return message.content
      .flatMap((block) => {
        if (!block || typeof block !== "object" || !("type" in block) || block.type !== "text") return [];
        return "text" in block && typeof block.text === "string" ? [block.text] : [];
      })
      .join("\n")
      .trim();
  }
  return "";
};

export const runEditingAgent = async (
  context: RunContext,
  update: StageUpdate,
): Promise<string> => {
  if (!config.gatewayApiKey) throw new Error("MOONCUT_GATEWAY_API_KEY is required");
  const baseSystemPrompt = await readFile(join(agentRoot, "SPEC.md"), "utf8");
  const lessons = await readFile(join(agentRoot, "memory/lessons.json"), "utf8");
  const systemPrompt = `${baseSystemPrompt}\n\n## Persistent editing lessons\n\nThese reviewed lessons are mandatory for every job:\n\n${lessons}`;
  const skillPaths = [
    join(agentRoot, ".pi/skills/mooncut-editor/SKILL.md"),
    join(agentRoot, ".pi/skills/x-post-evidence/SKILL.md"),
    join(agentRoot, ".pi/skills/browser-evidence/SKILL.md"),
  ];
  const skills: Skill[] = await Promise.all(skillPaths.map(async (filePath) => {
    const content = await readFile(filePath, "utf8");
    const name = filePath.includes("x-post-evidence")
      ? "x-post-evidence"
      : filePath.includes("browser-evidence")
        ? "browser-evidence"
        : "mooncut-editor";
    return {
      name,
      description: content.match(/description:\s*([^\n]+)/u)?.[1]?.trim() ?? `MoonCut skill: ${name}`,
      filePath,
      baseDir: dirname(filePath),
      sourceInfo: {
        path: filePath,
        source: "mooncut-pi-agent",
        scope: "project",
        origin: "package",
        baseDir: dirname(filePath),
      },
      disableModelInvocation: false,
    };
  }));
  const authStorage = AuthStorage.create(join(agentRuntimeRoot, "auth.json"));
  authStorage.setRuntimeApiKey("mooncut-local", config.gatewayApiKey);
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  const model = plannerModel();
  const tools = createMooncutTools(context, update);
  const settingsManager = SettingsManager.inMemory({
    compaction: {enabled: true},
    retry: {enabled: true, maxRetries: 2},
  });
  const resourceLoader = createResourceLoader(systemPrompt, skills);
  const {session} = await createAgentSession({
    cwd: workspaceRoot,
    agentDir: agentRuntimeRoot,
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    resourceLoader,
    tools: ["read", ...tools.map((tool) => tool.name)],
    customTools: tools,
    sessionManager: SessionManager.inMemory(context.jobDir),
    settingsManager,
  });

  const eventsPath = join(context.jobDir, "pi-events.jsonl");
  const eventLines: string[] = [];
  session.subscribe((event) => {
    eventLines.push(JSON.stringify(event));
  });

  const taskPrompt = [
    "执行一次完整的口播剪辑任务。必须完成全部核心工具并产出已验证 MP4。",
    `任务 ID：${context.job.id}`,
    `源文件：${context.job.originalName}`,
    `用户要求：${context.job.request.prompt ?? "按默认 MoonCut 原生 macOS 口播规范剪辑"}`,
    context.job.request.title ? `建议标题：${context.job.request.title}` : "",
    "生成剪辑 Spec 时必须覆盖完整时长，使用字幕段时间，不要只给建议。",
    "如果口播涉及产品发布、官方声明或网页证据，先读取并使用 x-post-evidence / browser-evidence Skill，再保存带 evidenceId 的分镜。",
  ].filter(Boolean).join("\n");

  try {
    await session.prompt(taskPrompt);
    for (let attempt = 0; attempt < 3 && !context.verificationPath; attempt += 1) {
      const latestQualityReview = context.qualityReviews.at(-1);
      if (latestQualityReview && !latestQualityReview.ok) {
        const feedback = latestQualityReview.findings
          .filter((finding) => finding.severity === "error")
          .map((finding) => `${finding.id}: ${finding.message}`)
          .join("\n");
        await session.prompt([
          "上一版成片没有通过视觉质检。不要只重复 verify_render。",
          "根据以下失败证据重新调用 save_edit_spec 修正分镜，随后 render_edit 和 verify_render：",
          feedback,
          "必须保留真实 evidenceId，并遵守 persistent editing lessons。",
        ].join("\n"));
        continue;
      }
      const missing = [
        !context.probe && "inspect_source",
        !context.subtitles && "transcribe_source",
        context.faceTrack === undefined && "track_speaker",
        !context.spec && "save_edit_spec",
        !context.renderPath && "render_edit",
        !context.verificationPath && "verify_render",
      ].filter(Boolean).join(", ");
      await session.prompt(`任务尚未完成。立即继续调用缺失工具：${missing}。不要解释，完成渲染和验证。`);
    }
    if (!context.verificationPath || !context.renderPath || !context.spec || !context.probe) {
      throw new Error("Pi agent stopped before the required render verification completed");
    }
    const summary = finalAssistantText(session.state.messages) || `MoonCut render completed: ${context.renderPath}`;
    await writeFile(join(context.jobDir, "agent-summary.txt"), `${summary}\n`);
    return summary;
  } finally {
    await writeFile(eventsPath, `${eventLines.join("\n")}\n`);
    session.dispose();
  }
};

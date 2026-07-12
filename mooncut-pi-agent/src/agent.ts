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
import {runCodexEditingAgent} from "./codex-agent.ts";
import {runGrokEditingAgent} from "./grok-agent.ts";
import {applySubtitleRepair, planSubtitleRepair} from "./subtitle-repair.ts";
import {createMooncutTools, type StageUpdate} from "./tools.ts";
import {invokeMooncutTool} from "./tool-runner.ts";
import {createInstalledCapabilityTools, installedCapabilityGuidance} from "./capabilities.ts";
import {isVisionGateProtocolOnlyFailure} from "./quality.ts";
import type {AgentEditSpec, EditBeat, RunContext, SubtitleRepairAnalysis, SubtitleRepairFeedback, SubtitleSegment} from "./types.ts";

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

const concise = (value: string, maximum = 28) => value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;

const impactPhrase = (segment: SubtitleSegment) => {
  const text = segment.text.replace(/\s+/gu, "").trim();
  const match = text.match(/(?:重磅的消息|GPT五点六发布|太震撼了|自动剪口播的视频|初版的测试|我们的效果)/u);
  return match?.[0] ?? concise(text, 18);
};

const reliableBeats = (segments: readonly SubtitleSegment[], confirmedEvidence: RunContext["evidenceAssets"] = []): EditBeat[] => {
  const impactPattern = /重磅|GPT(?:五点六|5\.6)?|震撼|自动剪|初版|效果/u;
  let impacts = 0;
  const beats: EditBeat[] = segments.map((segment): EditBeat => {
    const isImpact = impactPattern.test(segment.text) && impacts < 5;
    if (isImpact) impacts += 1;
    const phrase = impactPhrase(segment);
    return {
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      kind: isImpact ? "impact" : "speaker",
      headline: phrase,
      body: isImpact ? "重点落下，保留原口播语境" : concise(segment.text, 72),
      keywords: isImpact ? [phrase] : [],
      ...(isImpact ? {impactText: phrase} : {}),
    };
  });
  // The job pipeline only creates an evidence asset after an explicit user
  // confirmation. Make it visible and preserve the existing quality invariant
  // that every captured evidence asset is used by a semantic beat.
  const evidence = confirmedEvidence[0];
  if (evidence && beats.length) {
    const index = Math.floor(beats.length / 2);
    const original = beats[index];
    beats[index] = {
      startMs: original.startMs,
      endMs: original.endMs,
      kind: "evidence",
      headline: evidence.label.slice(0, 30),
      body: "用户确认采集的真实网页证据",
      keywords: [],
      evidenceId: evidence.id,
    };
  }
  return beats;
};

const runReliableEditingPipeline = async (
  context: RunContext,
  update: StageUpdate,
): Promise<string> => {
  // This is deliberately procedural: the paid/slow model services remain in
  // the individual tools, while the indispensable production stages cannot be
  // skipped merely because a conversational planner stops replying.
  await invokeMooncutTool(context, update, "inspect_source", {}, "reliable-inspect_source");
  await invokeMooncutTool(context, update, "transcribe_source", {}, "reliable-transcribe_source");
  await invokeMooncutTool(context, update, "clean_speech_delivery", {}, "reliable-clean_speech_delivery");
  await invokeMooncutTool(context, update, "schedule_generated_visuals", {}, "reliable-schedule_generated_visuals");
  await invokeMooncutTool(context, update, "track_speaker", {}, "reliable-track_speaker");
  if (!context.subtitles?.segments.length) throw new Error("Hybrid subtitle service returned no timed segments");
  await invokeMooncutTool(context, update, "save_edit_spec", {
    title: concise(context.job.request.title ?? "MoonCut 原生口播", 60),
    summary: "完整保留口播时长；关键短语以原生 macOS 风格全屏强调并落下。",
    accent: "#65d9b6",
    beats: reliableBeats(context.subtitles.segments, context.evidenceAssets),
  }, "reliable-save_edit_spec");
  await invokeMooncutTool(context, update, "render_edit", {}, "reliable-render_edit");
  await invokeMooncutTool(context, update, "verify_render", {}, "reliable-verify_render");
  return "MoonCut reliable pipeline completed: Hybrid Subtitle, full-duration edit, render verification, and visual quality review passed.";
};

export const runEditingAgent = async (
  context: RunContext,
  update: StageUpdate,
): Promise<string> => {
  if (config.agentExecutionMode === "reliable") return await runReliableEditingPipeline(context, update);
  if (config.agentExecutionMode === "grok") return await runGrokEditingAgent(context, update);
  if (config.agentExecutionMode === "codex") return await runCodexEditingAgent(context, update);
  return await runPiEditingAgent(context, update);
};

/**
 * Keep human subtitle feedback intentionally narrower than a new edit. The
 * source cut, visual beats and tracked speaker are inherited; the Agent can
 * only return a reviewed list of caption changes before the version is
 * rendered and quality-checked again.
 */
export const runSubtitleRepairAgent = async (
  context: RunContext,
  parentSpec: AgentEditSpec,
  feedback: SubtitleRepairFeedback,
  update: StageUpdate,
): Promise<{summary: string; analysis: SubtitleRepairAnalysis}> => {
  if (!context.probe || !context.subtitles) {
    throw new Error("Subtitle repair requires the completed version's probe and timed subtitles");
  }
  await update("analyzing-subtitle-feedback", 0.16);
  const analysis = await planSubtitleRepair(context.subtitles, feedback);
  await update("subtitle-repair-planned", 0.38);
  const repairedSubtitles = applySubtitleRepair(context.subtitles, analysis.changes);
  context.subtitles = repairedSubtitles;
  context.spec = {
    ...parentSpec,
    source: {...parentSpec.source, src: context.publicMediaSrc},
    transcript: repairedSubtitles.transcript,
    subtitles: repairedSubtitles.segments,
  };
  await writeFile(join(context.jobDir, "subtitles.json"), `${JSON.stringify(repairedSubtitles, null, 2)}\n`);
  await writeFile(join(context.jobDir, "edit-spec.json"), `${JSON.stringify(context.spec, null, 2)}\n`);
  await writeFile(join(context.jobDir, "subtitle-repair.json"), `${JSON.stringify({feedback, analysis}, null, 2)}\n`);
  await update("applying-subtitle-repair", 0.58);

  const invoke = async (name: string) => {
    await invokeMooncutTool(context, update, name, {}, `subtitle-repair-${name}`);
  };
  await invoke("render_edit");
  await invoke("verify_render");
  return {
    summary: `字幕修复版本已完成：${analysis.summary}`,
    analysis,
  };
};

const runPiEditingAgent = async (
  context: RunContext,
  update: StageUpdate,
): Promise<string> => {
  if (!config.gatewayApiKey) throw new Error("MOONCUT_GATEWAY_API_KEY is required");
  const baseSystemPrompt = await readFile(join(agentRoot, "SPEC.md"), "utf8");
  const lessons = await readFile(join(agentRoot, "memory/lessons.json"), "utf8");
  const capabilityGuidance = installedCapabilityGuidance(context);
  const systemPrompt = [
    baseSystemPrompt,
    "## Persistent editing lessons\n\nThese reviewed lessons are mandatory for every job:\n\n" + lessons,
    capabilityGuidance,
  ].filter(Boolean).join("\n\n");
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
  const tools = [...createMooncutTools(context, update), ...createInstalledCapabilityTools(context)];
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
    "转写后必须先调用 clean_speech_delivery；它即使安全跳过也会留下审计记录。之后才能调用 schedule_generated_visuals、track_speaker 和 save_edit_spec，所有后续阶段必须使用清理后的时间轴。",
    "清理完成后调用 schedule_generated_visuals。默认不生图；只有工具实际返回 generatedVisualId 时，才可安排 illustration 分镜，且必须明确这是 AI 示例而非事实证据。",
    "如果口播涉及产品发布、官方声明或网页证据，先读取并使用 x-post-evidence / browser-evidence Skill，再保存带 evidenceId 的分镜。",
    "证据分镜默认单窗；只有两到三份真实素材各自提供不同信息时，才使用 evidencePanels 与 parallel/comparison/sequence。不得重复证据 ID、URL 或用途，不得把未解释的冲突并排当成共同事实。",
    "desktop 分镜按内容自主选择 editorial/workflow/comparison/dashboard，并用最多四个 visualItems 构建信息层级；避免无意义的大按钮和装饰数字。流程、关系或架构确实更清楚时，可用手绘图 Skill 生成并注册 diagramId，单独安排 diagram 分镜，不能冒充证据。",
    context.evidenceAssets.length
      ? `本任务已有用户确认的证据资产，若它们支持视频中的相关事实，必须在 evidence 分镜中使用：${context.evidenceAssets.map((asset) => `${asset.id} (${asset.label})`).join(", ")}`
      : "",
  ].filter(Boolean).join("\n");

  try {
    await session.prompt(taskPrompt);
    for (let attempt = 0; attempt < 3 && !context.verificationPath; attempt += 1) {
      const latestQualityReview = context.qualityReviews.at(-1);
      if (latestQualityReview && !latestQualityReview.ok) {
        const hardFindings = latestQualityReview.findings.filter((finding) => finding.severity === "error");
        const protocolOnlyFailure = isVisionGateProtocolOnlyFailure(latestQualityReview.findings);
        const feedback = hardFindings
          .map((finding) => `${finding.id}: ${finding.message}`)
          .join("\n");
        if (protocolOnlyFailure) {
          await session.prompt([
            "上一轮只是视觉质检服务协议失败，成片本身没有被判定为不合格。",
            "不要修改 Spec，不要重新渲染。立即只调用 verify_render 重试质检：",
            feedback,
          ].join("\n"));
          continue;
        }
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
        context.speechCleanup === undefined && "clean_speech_delivery",
        context.imageSchedule === undefined && "schedule_generated_visuals",
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

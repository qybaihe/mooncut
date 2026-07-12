import {createMooncutTools, type StageUpdate} from "./tools.ts";
import {saveRunContext} from "./context-store.ts";
import type {RunContext} from "./types.ts";

export type MooncutToolName =
  | "inspect_source"
  | "transcribe_source"
  | "clean_speech_delivery"
  | "schedule_generated_visuals"
  | "import_codex_generated_visual"
  | "import_handdrawn_diagram"
  | "track_speaker"
  | "capture_x_post"
  | "capture_web_page"
  | "save_edit_spec"
  | "render_edit"
  | "verify_render";

export const MOONCUT_TOOL_NAMES: readonly MooncutToolName[] = [
  "inspect_source",
  "transcribe_source",
  "clean_speech_delivery",
  "schedule_generated_visuals",
  "import_codex_generated_visual",
  "import_handdrawn_diagram",
  "track_speaker",
  "capture_x_post",
  "capture_web_page",
  "save_edit_spec",
  "render_edit",
  "verify_render",
] as const;

type ToolLike = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: unknown,
  ) => Promise<{content?: Array<{type: string; text?: string}>}>;
};

const extractText = (result: {content?: Array<{type: string; text?: string}>}) =>
  (result.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");

/**
 * Invoke a MoonCut editing tool against a live RunContext and persist state.
 * Used by reliable mode, Grok tool CLI, and post-Grok recovery.
 */
export const invokeMooncutTool = async (
  context: RunContext,
  update: StageUpdate,
  name: string,
  params: Record<string, unknown> = {},
  callId = `invoke-${name}`,
): Promise<string> => {
  const tools = createMooncutTools(context, update) as ToolLike[];
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown MoonCut tool: ${name}. Available: ${MOONCUT_TOOL_NAMES.join(", ")}`);
  const result = await tool.execute(callId, params, undefined, undefined, {});
  await saveRunContext(context);
  return extractText(result) || JSON.stringify({ok: true, tool: name});
};

/** Required production tool order for a complete talking-head edit. */
export const REQUIRED_TOOL_SEQUENCE: readonly MooncutToolName[] = [
  "inspect_source",
  "transcribe_source",
  "clean_speech_delivery",
  "schedule_generated_visuals",
  "track_speaker",
  "save_edit_spec",
  "render_edit",
  "verify_render",
];

export const missingRequiredStages = (context: RunContext): MooncutToolName[] => {
  const missing: MooncutToolName[] = [];
  if (!context.probe) missing.push("inspect_source");
  if (!context.subtitles) missing.push("transcribe_source");
  if (context.speechCleanup === undefined) missing.push("clean_speech_delivery");
  if (context.imageSchedule === undefined) missing.push("schedule_generated_visuals");
  if (context.faceTrack === undefined) missing.push("track_speaker");
  if (!context.spec) missing.push("save_edit_spec");
  if (!context.renderPath) missing.push("render_edit");
  if (!context.verificationPath) missing.push("verify_render");
  return missing;
};

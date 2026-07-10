import {readFile} from "node:fs/promises";
import {basename} from "node:path";
import {config} from "./config.ts";

type ModelListResponse = {
  data?: Array<{id?: string}>;
};

type ChatResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      tool_calls?: Array<{
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

const gatewayHeaders = () => {
  if (!config.gatewayApiKey) {
    throw new Error("MOONCUT_GATEWAY_API_KEY is required");
  }
  return {
    Authorization: `Bearer ${config.gatewayApiKey}`,
    "Content-Type": "application/json",
  };
};

export const listGatewayModels = async (): Promise<string[]> => {
  const response = await fetch(`${config.gatewayBaseUrl}/models`, {headers: gatewayHeaders()});
  if (!response.ok) throw new Error(`Model discovery failed: ${response.status} ${await response.text()}`);
  const payload = (await response.json()) as ModelListResponse;
  return (payload.data ?? []).flatMap((entry) => (entry.id ? [entry.id] : [])).sort();
};

const cleanVisionText = (text: string) =>
  text.replace(/<think>[\s\S]*?<\/think>/giu, "").trim();

const requestVision = async (
  imagePath: string,
  prompt: string,
  maxTokens = 1200,
): Promise<{model: string; text: string}> => {
  const data = await readFile(imagePath);
  const imageUrl = `data:image/jpeg;base64,${data.toString("base64")}`;
  const availableModels = new Set(await listGatewayModels());
  const candidates = config.visionModels.filter((model) => availableModels.has(model));
  if (candidates.length === 0) {
    throw new Error(`None of the configured vision models are available: ${config.visionModels.join(", ")}`);
  }

  const failures: string[] = [];
  for (const model of candidates) {
    try {
      const response = await fetch(`${config.gatewayBaseUrl}/chat/completions`, {
        method: "POST",
        headers: gatewayHeaders(),
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: maxTokens,
          messages: [{
            role: "user",
            content: [
              {type: "text", text: prompt},
              {type: "image_url", image_url: {url: imageUrl, detail: "high"}},
            ],
          }],
        }),
      });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      const payload = (await response.json()) as ChatResponse;
      const text = cleanVisionText(payload.choices?.[0]?.message?.content ?? "");
      if (!text) throw new Error("Vision model returned empty content");
      return {model, text};
    } catch (error) {
      failures.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Vision request failed for ${basename(imagePath)}\n${failures.join("\n")}`);
};

const parseJsonObject = (text: string): Record<string, unknown> => {
  const cleaned = text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`Vision response did not contain JSON: ${cleaned.slice(0, 300)}`);
  const value = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Vision JSON must be an object");
  return value as Record<string, unknown>;
};

const requestVisionGate = async (
  imagePath: string,
  prompt: string,
): Promise<{model: string; value: Record<string, unknown>}> => {
  const data = await readFile(imagePath);
  const imageUrl = `data:image/jpeg;base64,${data.toString("base64")}`;
  const availableModels = new Set(await listGatewayModels());
  const candidates = config.visionModels.filter((model) => availableModels.has(model));
  const failures: string[] = [];
  for (const model of candidates) {
    try {
      const response = await fetch(`${config.gatewayBaseUrl}/chat/completions`, {
        method: "POST",
        headers: gatewayHeaders(),
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: 1800,
          messages: [{
            role: "user",
            content: [
              {type: "text", text: `${prompt}\n必须调用 submit_quality_gate，pass 必须严格服从通过条件。`},
              {type: "image_url", image_url: {url: imageUrl, detail: "high"}},
            ],
          }],
          tools: [{
            type: "function",
            function: {
              name: "submit_quality_gate",
              description: "Submit the strict visual quality gate result.",
              parameters: {
                type: "object",
                properties: {
                  pass: {type: "boolean"},
                  confidence: {type: "number"},
                  summary: {type: "string"},
                  observedText: {type: "array", items: {type: "string"}},
                  issues: {type: "array", items: {type: "string"}},
                },
                required: ["pass", "confidence", "summary", "observedText", "issues"],
              },
            },
          }],
          tool_choice: {type: "function", function: {name: "submit_quality_gate"}},
        }),
      });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      const payload = (await response.json()) as ChatResponse;
      const choice = payload.choices?.[0];
      const call = choice?.message?.tool_calls?.find((item) => item.function?.name === "submit_quality_gate");
      const argumentsText = call?.function?.arguments;
      if (!argumentsText) throw new Error(`Vision model did not call submit_quality_gate (finish=${choice?.finish_reason ?? "unknown"})`);
      return {model, value: parseJsonObject(argumentsText)};
    } catch (error) {
      failures.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Structured vision gate failed for ${basename(imagePath)}\n${failures.join("\n")}`);
};

export const analyzeContactSheet = async (
  contactSheetPath: string,
): Promise<{model: string; analysis: string}> => {
  const result = await requestVision(contactSheetPath, [
    "你是口播视频的视觉导演。分析这张按时间顺序排列的 3×2 视频联系表。",
    "请用中文给出：人物与环境、镜头稳定性、适合的裁切方式、可用的视觉节奏、潜在重点时刻、需要避免的问题。",
    "不要臆造画面外事实，输出简洁的制作建议。",
  ].join("\n"));
  return {model: result.model, analysis: result.text};
};

export type VisualGateResult = {
  pass: boolean;
  confidence: number;
  summary: string;
  observedText: string[];
  issues: string[];
};

const visualGate = async (imagePath: string, prompt: string): Promise<{model: string; result: VisualGateResult}> => {
  const response = await requestVisionGate(imagePath, prompt);
  const value = response.value;
  const summary = typeof value.summary === "string" ? value.summary : "";
  const issues = Array.isArray(value.issues) ? value.issues.filter((item): item is string => typeof item === "string") : [];
  const disqualifyingContradiction = /底部.{0,8}字幕|字幕形式|未.{0,8}全屏|没有.{0,8}全屏|非全屏|not.{0,8}full.?screen/iu.test([summary, ...issues].join(" "));
  return {
    model: response.model,
    result: {
      pass: value.pass === true && !disqualifyingContradiction,
      confidence: typeof value.confidence === "number" ? value.confidence : 0,
      summary,
      observedText: Array.isArray(value.observedText) ? value.observedText.filter((item): item is string => typeof item === "string") : [],
      issues,
    },
  };
};

export const reviewImpactSequence = async (imagePath: string, expectedText: string) => visualGate(
  imagePath,
  [
    "你正在验收口播视频的全屏重点文字动效。图片从左到右是同一动效的连续三帧。",
    `预期重点短语：${expectedText}`,
    "通过条件：至少中间或右侧一帧能清楚看到预期短语的大字全屏呈现，并且三帧能看出从进入、冲击到保持/退出的变化。",
    "如果只有人物全屏、文字缺失、文字太小/被裁切、三帧完全相同，必须 pass=false。",
  ].join("\n"),
);

export const reviewEvidenceSequence = async (
  imagePath: string,
  expectedLabel: string,
  expectedKind: "webpage" | "x-post",
) => visualGate(
  imagePath,
  [
    "你正在验收口播视频中的真实网页证据场景。图片从左到右是同一场景的连续三帧。",
    `预期来源：${expectedLabel}；类型：${expectedKind}`,
    "通过条件：Safari/浏览器窗口内确实显示了真实页面或原始 X 帖子截图，主体清晰可读，没有空白、加载失败、假卡片或严重裁切。",
    expectedKind === "webpage" ? "长网页的三帧最好能看到轻微滚动变化；没有变化记为 issue，但页面真实清晰时仍可通过。" : "X 原帖必须保留账号、正文和原始媒体/互动区域，不得重绘成拟真卡片。",
  ].join("\n"),
);

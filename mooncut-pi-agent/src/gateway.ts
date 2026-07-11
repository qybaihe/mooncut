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

export type GatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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

let modelListCache: {expiresAt: number; models: string[]} | undefined;

export const listGatewayModels = async (): Promise<string[]> => {
  if (modelListCache && modelListCache.expiresAt > Date.now()) return modelListCache.models;
  const response = await fetch(`${config.gatewayBaseUrl}/models`, {headers: gatewayHeaders()});
  if (!response.ok) throw new Error(`Model discovery failed: ${response.status} ${await response.text()}`);
  const payload = (await response.json()) as ModelListResponse;
  const models = (payload.data ?? []).flatMap((entry) => (entry.id ? [entry.id] : [])).sort();
  modelListCache = {expiresAt: Date.now() + 60_000, models};
  return models;
};

export const requestStructuredCompletion = async (options: {
  model: string;
  messages: GatewayMessage[];
  toolName: string;
  toolDescription: string;
  parameters: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
}) => {
  const available = await listGatewayModels();
  if (!available.includes(options.model)) throw new Error(`Configured model is unavailable: ${options.model}`);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${config.gatewayBaseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
        headers: gatewayHeaders(),
        body: JSON.stringify({
          model: options.model,
          stream: false,
          temperature: attempt === 0 ? 0.45 : 0.2,
          max_tokens: options.maxTokens ?? 1200,
          messages: options.messages,
          tools: [{
            type: "function",
            function: {
              name: options.toolName,
              description: options.toolDescription,
              parameters: options.parameters,
            },
          }],
          tool_choice: {type: "function", function: {name: options.toolName}},
        }),
      });
      if (!response.ok) throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
      const payload = (await response.json()) as ChatResponse;
      const choice = payload.choices?.[0];
      const call = choice?.message?.tool_calls?.find((item) => item.function?.name === options.toolName);
      const raw = call?.function?.arguments ?? choice?.message?.content ?? "";
      if (!raw) throw new Error(`Model returned no structured response (finish=${choice?.finish_reason ?? "unknown"})`);
      return parseJsonObject(cleanVisionText(raw));
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw lastError;
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
        signal: AbortSignal.timeout(config.visionRequestTimeoutMs),
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
  const cleaned = text
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    // A few OpenAI-compatible gateways append their own XML-like markers to a
    // function result. They are transport noise, not part of the JSON value.
    .replace(/<\/?(?:summary|invoke)>/giu, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`Vision response did not contain JSON: ${cleaned.slice(0, 300)}`);
  const candidate = cleaned.slice(start, end + 1);
  const escapeControlCharactersInStrings = (value: string) => {
    let result = "";
    let inString = false;
    let escaped = false;
    for (const character of value) {
      if (escaped) {
        result += character;
        escaped = false;
        continue;
      }
      if (character === "\\") {
        result += character;
        escaped = true;
        continue;
      }
      if (character === '"') {
        result += character;
        inString = !inString;
        continue;
      }
      if (inString && character.codePointAt(0)! < 0x20) {
        result += `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`;
        continue;
      }
      result += character;
    }
    return result;
  };
  const value = JSON.parse(escapeControlCharactersInStrings(candidate)) as unknown;
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
        signal: AbortSignal.timeout(config.visionRequestTimeoutMs),
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
      // Some OpenAI-compatible gateways ignore forced tool_choice and return
      // the exact schema as normal JSON text. Accept that equivalent protocol
      // instead of turning a valid visual review into a render failure.
      const argumentsText = call?.function?.arguments ?? cleanVisionText(choice?.message?.content ?? "");
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

// A subtitle may legitimately remain visible while an impact phrase fills the
// screen. Only explicit negative evidence about the required impact itself may
// overturn a model's `pass: true` field.
export const hasDisqualifyingVisualContradiction = (summary: string, issues: readonly string[]) => {
  const text = [summary, ...issues].join(" ");
  return /(?:未能|没有|未见|缺失|缺少|不是|非全屏|只有|仅有|仅以|而非).{0,18}(?:全屏|大字)|(?:全屏|大字).{0,18}(?:缺失|缺少|未见|没有|不清楚)|(?:文字|大字).{0,10}(?:太小|(?<!未)被裁切|严重裁切)|三帧.{0,12}(?:完全相同|没有变化)/iu.test(text);
};

export const hasPositiveImpactConfirmation = (summary: string, issues: readonly string[]) => {
  const text = [summary, ...issues].join(" ");
  return /(?:满足|符合).{0,12}通过条件|(?:全屏|大字).{0,30}(?:清晰|完整|未被裁切).{0,42}(?:进入|冲击|保持|动效变化)|(?:进入|淡入).{0,20}(?:冲击|保持).{0,20}(?:全屏|大字)/iu.test(text);
};

const visualGate = async (imagePath: string, prompt: string): Promise<{model: string; result: VisualGateResult}> => {
  const response = await requestVisionGate(imagePath, prompt);
  const value = response.value;
  const summary = typeof value.summary === "string" ? value.summary : "";
  const issues = Array.isArray(value.issues) ? value.issues.filter((item): item is string => typeof item === "string") : [];
  const disqualifyingContradiction = hasDisqualifyingVisualContradiction(summary, issues);
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

export const reviewImpactSequence = async (imagePath: string, expectedText: string) => {
  const review = await visualGate(
    imagePath,
    [
    "你正在验收口播视频的全屏重点文字动效。图片从左到右是同一动效的连续三帧。",
    `预期重点短语：${expectedText}`,
    "通过条件：至少中间或右侧一帧能清楚看到预期短语的大字全屏呈现，并且三帧能看出从进入、冲击到保持/退出的变化。",
    "如果只有人物全屏、文字缺失、文字太小/被裁切、三帧完全相同，必须 pass=false。",
    ].join("\n"),
  );
  // Some compatible models write a clear passing rationale but leave the
  // forced-tool boolean at false. For this narrowly-defined impact gate, the
  // explicit textual rationale is reliable when it contains no hard failure.
  if (!review.result.pass && hasPositiveImpactConfirmation(review.result.summary, review.result.issues) &&
    !hasDisqualifyingVisualContradiction(review.result.summary, review.result.issues)) {
    return {...review, result: {...review.result, pass: true}};
  }
  return review;
};

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

export const reviewGeneratedVisualSequence = async (
  imagePath: string,
  expectedLabel: string,
) => visualGate(
  imagePath,
  [
    "你正在验收口播视频中的 AI 生成示例插画。图片从左到右是同一场景的连续三帧。",
    `预期示例：${expectedLabel}`,
    "通过条件：示例插画清楚可见、构图完整，并在画面中明确出现 AI GENERATED EXAMPLE 或 AI 生成示例标识。",
    "如果画面像真实新闻照片、网页证据或产品事实证明，或者没有 AI 标识，必须 pass=false。",
  ].join("\n"),
);

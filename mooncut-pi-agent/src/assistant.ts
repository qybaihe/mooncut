import {config} from "./config.ts";
import {requestStructuredCompletion, type GatewayMessage} from "./gateway.ts";
import {COACH_SYSTEM_PROMPT, SCRIPT_ASSISTANT_SYSTEM_PROMPT} from "./prompts.ts";

export type ScriptAssistantRequest = {
  action?: "guide" | "generate" | "polish";
  style?: "oral" | "short" | "emotional";
  messages: Array<{role: "assistant" | "user"; content: string}>;
  draft?: string;
};

export type CoachAdviceRequest = {
  transcript: string;
  currentScript: string;
  currentSentence: string;
  lastAdvice?: string;
  metrics: {
    pace: number;
    wordCount: number;
    volume: number;
    pauseCount: number;
    eyeContact?: number;
    elapsedSeconds: number;
  };
};

const stringValue = (value: unknown, fallback = "") => typeof value === "string" ? value.trim() : fallback;

export const runScriptAssistant = async (request: ScriptAssistantRequest) => {
  const messages: GatewayMessage[] = [
    {role: "system", content: SCRIPT_ASSISTANT_SYSTEM_PROMPT},
    ...request.messages.slice(-12).map((message) => ({role: message.role, content: message.content.slice(0, 4000)})),
    {
      role: "user",
      content: [
        `当前动作：${request.action ?? "guide"}`,
        request.style ? `润色方向：${request.style}` : "",
        request.draft ? `当前稿件：\n${request.draft.slice(0, 12_000)}` : "",
        "请调用 submit_script_response 返回结果。",
      ].filter(Boolean).join("\n\n"),
    },
  ];
  const value = await requestStructuredCompletion({
    model: config.scriptModel,
    messages,
    toolName: "submit_script_response",
    toolDescription: "返回下一步引导、三个主题化建议、可选完整口播稿与宠物短评。",
    maxTokens: 2200,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        reply: {type: "string"},
        phase: {type: "string", enum: ["discover", "outline", "draft"]},
        ready: {type: "boolean"},
        draft: {type: "string"},
        petMessage: {type: "string"},
        suggestions: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              eyebrow: {type: "string"},
              title: {type: "string"},
              detail: {type: "string"},
            },
            required: ["eyebrow", "title", "detail"],
          },
        },
      },
      required: ["reply", "phase", "ready", "draft", "petMessage", "suggestions"],
    },
  });
  const suggestions = Array.isArray(value.suggestions)
    ? value.suggestions.slice(0, 3).map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        eyebrow: stringValue(record.eyebrow, "表达角度"),
        title: stringValue(record.title, "换一个更具体的说法"),
        detail: stringValue(record.detail, "补充一个真实场景，让观点落地。"),
      };
    })
    : [];
  return {
    reply: stringValue(value.reply, "再告诉我一个具体场景，我就能继续成稿。"),
    phase: stringValue(value.phase, "discover"),
    ready: value.ready === true,
    draft: stringValue(value.draft).replace(/^【[^\n]+】\s*/u, ""),
    petMessage: stringValue(value.petMessage, "这个方向有感觉，再具体一点吧。"),
    suggestions,
    model: config.scriptModel,
  };
};

export const runCoachAdvice = async (request: CoachAdviceRequest) => {
  const value = await requestStructuredCompletion({
    model: config.coachModel,
    messages: [
      {role: "system", content: COACH_SYSTEM_PROMPT},
      {role: "user", content: JSON.stringify(request)},
    ],
    toolName: "submit_coach_advice",
    toolDescription: "提交一条可立即执行的实时口播建议。",
    maxTokens: 320,
    timeoutMs: 16_000,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        category: {type: "string", enum: ["pace", "volume", "pause", "script", "camera", "steady"]},
        advice: {type: "string"},
        petMessage: {type: "string"},
        positive: {type: "boolean"},
      },
      required: ["category", "advice", "petMessage", "positive"],
    },
  });
  return {
    category: stringValue(value.category, "steady"),
    advice: stringValue(value.advice, "状态很稳，继续自然表达。"),
    petMessage: stringValue(value.petMessage, "讲得很顺，我开心地跑起来啦！"),
    positive: value.positive === true,
    model: config.coachModel,
  };
};

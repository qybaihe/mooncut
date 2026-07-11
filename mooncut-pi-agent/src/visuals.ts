import {randomUUID} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {config} from "./config.ts";
import {requestStructuredCompletion} from "./gateway.ts";
import type {
  GeneratedVisualAsset,
  ImageGenerationPlanItem,
  ImageGenerationSchedule,
  RunContext,
} from "./types.ts";

type ImageGenerationResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
};

type PlannedVisuals = {
  useImages: boolean;
  reason: string;
  images: ImageGenerationPlanItem[];
};

const MAX_GENERATED_IMAGES = 2;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const text = (value: unknown, maximum: number) =>
  (typeof value === "string" ? value : "").replace(/\s+/gu, " ").trim().slice(0, maximum);

export const normalizeImageGenerationPlan = (
  value: Record<string, unknown>,
  configuredMaximum = MAX_GENERATED_IMAGES,
): PlannedVisuals => {
  const maximum = Math.min(MAX_GENERATED_IMAGES, Math.max(0, Math.floor(configuredMaximum)));
  const useImages = value.useImages === true;
  const reason = text(value.reason, 300) || (useImages ? "需要示例图帮助理解" : "现有素材足够");
  if (!useImages || maximum === 0 || !Array.isArray(value.images)) {
    return {useImages: false, reason, images: []};
  }
  const seen = new Set<string>();
  const images = value.images.flatMap((candidate): ImageGenerationPlanItem[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const prompt = text(record.prompt, 1200);
    const purpose = text(record.purpose, 240);
    if (!prompt || !purpose) return [];
    const fingerprint = `${prompt.toLocaleLowerCase()}|${purpose.toLocaleLowerCase()}`;
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [{
      label: text(record.label, 80) || "AI 示例图",
      purpose,
      prompt,
      avoid: text(record.avoid, 400) || "文字、Logo、水印、真实人物与品牌标识",
      relatedQuote: text(record.relatedQuote, 240),
    }];
  }).slice(0, maximum);
  return {useImages: images.length > 0, reason, images};
};

const imageEndpoint = () => config.imageGenerationBaseUrl.endsWith("/images/generations")
  ? config.imageGenerationBaseUrl
  : `${config.imageGenerationBaseUrl}/images/generations`;

const providerConfigured = () => Boolean(
  config.imageGenerationBaseUrl &&
  config.imageGenerationApiKey &&
  config.imageGenerationModel &&
  config.imageGenerationMaxImages > 0,
);

const imageHeaders = () => ({
  Authorization: `Bearer ${config.imageGenerationApiKey}`,
  "Content-Type": "application/json",
});

const imageBufferFromResponse = async (payload: ImageGenerationResponse) => {
  const item = payload.data?.[0];
  if (item?.b64_json) {
    const buffer = Buffer.from(item.b64_json.replace(/^data:image\/[^;]+;base64,/iu, ""), "base64");
    if (buffer.length === 0) throw new Error("Image API returned empty base64 data");
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Generated image exceeds 20 MB");
    return {buffer, revisedPrompt: item.revised_prompt};
  }
  if (item?.url) {
    const url = new URL(item.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Image API returned an unsupported asset URL");
    }
    const response = await fetch(url, {signal: AbortSignal.timeout(config.imageGenerationTimeoutMs)});
    if (!response.ok) throw new Error(`Generated image download failed: ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMAGE_BYTES) throw new Error("Generated image exceeds 20 MB");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error("Generated image payload is invalid");
    return {buffer, revisedPrompt: item.revised_prompt};
  }
  throw new Error("Image API returned neither b64_json nor url");
};

export const detectGeneratedImageFormat = (buffer: Buffer) => {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {extension: "png", contentType: "image/png"};
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return {extension: "jpg", contentType: "image/jpeg"};
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return {extension: "webp", contentType: "image/webp"};
  }
  throw new Error("Image API returned an unsupported image format");
};

export const requestGeneratedImage = async (item: ImageGenerationPlanItem) => {
  const prompt = [
    item.prompt,
    `用途：${item.purpose}`,
    "画面要求：16:9 横向编辑插画，构图清晰，适合作为口播视频的短暂辅助画面。",
    "必须保持示意性，不得伪装成新闻照片、网页截图、产品证据或真实事件记录。",
    `避免：${item.avoid}`,
    "不要生成文字、Logo、水印、二维码或可识别的真实人物。",
  ].join("\n");
  const requestBody: Record<string, unknown> = {
    model: config.imageGenerationModel,
    prompt,
    n: 1,
    size: config.imageGenerationSize,
    response_format: "b64_json",
  };
  let response = await fetch(imageEndpoint(), {
    method: "POST",
    signal: AbortSignal.timeout(config.imageGenerationTimeoutMs),
    headers: imageHeaders(),
    body: JSON.stringify(requestBody),
  });
  if ((response.status === 400 || response.status === 422)) {
    const message = await response.text();
    if (/response.?format|b64.?json/iu.test(message)) {
      delete requestBody.response_format;
      response = await fetch(imageEndpoint(), {
        method: "POST",
        signal: AbortSignal.timeout(config.imageGenerationTimeoutMs),
        headers: imageHeaders(),
        body: JSON.stringify(requestBody),
      });
    } else {
      throw new Error(`Image generation failed: ${response.status} ${message.slice(0, 500)}`);
    }
  }
  if (!response.ok) throw new Error(`Image generation failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json() as ImageGenerationResponse;
  return {...await imageBufferFromResponse(payload), prompt};
};

const planVisuals = async (context: RunContext) => {
  const value = await requestStructuredCompletion({
    model: config.plannerModel,
    messages: [
      {
        role: "system",
        content: [
          "你是 MoonCut 的视觉素材调度器。默认不生图，只有在素材难以搜索、又必须用一个抽象或假设示例帮助观众理解时才选择生图。",
          "真实人物、新闻事件、产品发布、数据结论、品牌界面、官方声明和事实证据绝对不能用生成图代替；这些场景应保留真人、用文字解释或获取真实网页证据。",
          "普通概念、已有口播画面能说明的内容、仅为装饰的画面都选择 useImages=false。",
          "确需生图时通常只生成 1 张；只有两个彼此独立且都无法用现有素材表达的示例才生成 2 张。",
          "每张图必须是明确的示意插画，不包含文字、Logo、水印、二维码或可识别真实人物。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `用户剪辑要求：${context.job.request.prompt ?? "默认自然口播剪辑"}`,
          `视频视觉分析：${(context.visionAnalysis ?? "无").slice(0, 2400)}`,
          `口播文本：${(context.subtitles?.transcript ?? "").slice(0, 7000)}`,
          `本任务最多允许 ${config.imageGenerationMaxImages} 张生成图。请严格节制。`,
        ].join("\n\n"),
      },
    ],
    toolName: "schedule_generated_visuals",
    toolDescription: "Decide whether this edit genuinely needs zero, one, or two generated example illustrations.",
    parameters: {
      type: "object",
      properties: {
        useImages: {type: "boolean"},
        reason: {type: "string"},
        images: {
          type: "array",
          maxItems: 2,
          items: {
            type: "object",
            properties: {
              label: {type: "string"},
              purpose: {type: "string"},
              prompt: {type: "string"},
              avoid: {type: "string"},
              relatedQuote: {type: "string"},
            },
            required: ["label", "purpose", "prompt", "avoid", "relatedQuote"],
          },
        },
      },
      required: ["useImages", "reason", "images"],
    },
    maxTokens: 1200,
    timeoutMs: 45_000,
  });
  return normalizeImageGenerationPlan(value, config.imageGenerationMaxImages);
};

const persistSchedule = async (context: RunContext, schedule: ImageGenerationSchedule) => {
  context.imageSchedule = schedule;
  await writeFile(join(context.jobDir, "image-generation.json"), `${JSON.stringify(schedule, null, 2)}\n`);
  return schedule;
};

export const scheduleGeneratedVisuals = async (context: RunContext): Promise<ImageGenerationSchedule> => {
  const maximum = config.imageGenerationMaxImages;
  const configured = providerConfigured();
  if (context.job.request.imageGeneration === "off" || maximum === 0) {
    return persistSchedule(context, {
      mode: "off",
      reason: context.job.request.imageGeneration === "off" ? "用户已关闭 AI 示例图" : "系统已关闭图片生成预算",
      maxImages: maximum,
      requestedCount: 0,
      providerConfigured: configured,
      plan: [],
      assets: [],
      errors: [],
    });
  }

  let plan: PlannedVisuals;
  try {
    plan = await planVisuals(context);
  } catch (error) {
    return persistSchedule(context, {
      mode: "unavailable",
      reason: "视觉素材调度器暂时不可用，安全降级为不生图",
      maxImages: maximum,
      requestedCount: 0,
      providerConfigured: configured,
      plan: [],
      assets: [],
      errors: [error instanceof Error ? error.message : String(error)],
    });
  }

  if (!plan.useImages || plan.images.length === 0) {
    return persistSchedule(context, {
      mode: "none",
      reason: plan.reason,
      maxImages: maximum,
      requestedCount: 0,
      providerConfigured: configured,
      plan: [],
      assets: [],
      errors: [],
    });
  }
  if (!configured) {
    return persistSchedule(context, {
      mode: "unavailable",
      reason: `${plan.reason}；尚未配置生图 API，已降级为不生图`,
      maxImages: maximum,
      requestedCount: plan.images.length,
      providerConfigured: false,
      plan: plan.images,
      assets: [],
      errors: ["MOONCUT_IMAGE_BASE_URL, MOONCUT_IMAGE_API_KEY and MOONCUT_IMAGE_MODEL are required"],
    });
  }

  const assets: GeneratedVisualAsset[] = [];
  const errors: string[] = [];
  const localDirectory = join(context.jobDir, "generated-visuals");
  const publicDirectory = join(dirname(context.publicMediaPath), "generated-visuals", context.job.id);
  await mkdir(localDirectory, {recursive: true});
  await mkdir(publicDirectory, {recursive: true});

  for (const [index, item] of plan.images.entries()) {
    try {
      const generated = await requestGeneratedImage(item);
      const format = detectGeneratedImageFormat(generated.buffer);
      const id = `generated-${String(index + 1).padStart(2, "0")}-${randomUUID().slice(0, 8)}`;
      const filename = `${id}.${format.extension}`;
      const localPath = join(localDirectory, filename);
      const publicPath = join(publicDirectory, filename);
      const metadataPath = join(localDirectory, `${id}.json`);
      const generatedAt = new Date().toISOString();
      await Promise.all([
        writeFile(localPath, generated.buffer),
        writeFile(publicPath, generated.buffer),
        writeFile(metadataPath, `${JSON.stringify({
          schemaVersion: "mooncut.generated-visual.v1",
          id,
          label: item.label,
          purpose: item.purpose,
          prompt: generated.prompt,
          revisedPrompt: generated.revisedPrompt,
          model: config.imageGenerationModel,
          size: config.imageGenerationSize,
          contentType: format.contentType,
          generatedAt,
          disclaimer: "AI-generated illustrative example; not factual evidence",
        }, null, 2)}\n`),
      ]);
      const asset: GeneratedVisualAsset = {
        id,
        kind: "generated-illustration",
        label: item.label,
        purpose: item.purpose,
        prompt: item.prompt,
        src: `${dirname(context.publicMediaSrc)}/generated-visuals/${context.job.id}/${filename}`,
        localPath,
        metadataPath,
        model: config.imageGenerationModel,
        generatedAt,
      };
      assets.push(asset);
      context.generatedVisuals.push(asset);
    } catch (error) {
      errors.push(`${item.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return persistSchedule(context, {
    mode: assets.length > 0 ? "generated" : "unavailable",
    reason: assets.length > 0 ? plan.reason : `${plan.reason}；图片服务未返回可用素材，已安全降级`,
    maxImages: maximum,
    requestedCount: plan.images.length,
    providerConfigured: true,
    plan: plan.images,
    assets,
    errors,
  });
};

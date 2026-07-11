import assert from "node:assert/strict";
import test from "node:test";
import {config} from "../src/config.ts";
import {detectGeneratedImageFormat, normalizeImageGenerationPlan, requestGeneratedImage} from "../src/visuals.ts";

test("defaults to zero generated visuals even when the model returns decorative candidates", () => {
  const plan = normalizeImageGenerationPlan({
    useImages: false,
    reason: "原视频已经足够",
    images: [{label: "装饰", purpose: "好看", prompt: "decorative gradient"}],
  }, 2);
  assert.equal(plan.useImages, false);
  assert.deepEqual(plan.images, []);
});

test("caps the generated visual schedule at two unique useful examples", () => {
  const candidate = (label: string, purpose: string, prompt: string) => ({
    label,
    purpose,
    prompt,
    avoid: "text",
    relatedQuote: "举个例子",
  });
  const plan = normalizeImageGenerationPlan({
    useImages: true,
    reason: "两个抽象例子很难找到真实素材",
    images: [
      candidate("例子一", "解释抽象流程", "editorial illustration one"),
      candidate("重复", "解释抽象流程", "editorial illustration one"),
      candidate("例子二", "解释另一种状态", "editorial illustration two"),
      candidate("例子三", "不应进入预算", "editorial illustration three"),
    ],
  }, 2);
  assert.equal(plan.useImages, true);
  assert.equal(plan.images.length, 2);
  assert.deepEqual(plan.images.map((item) => item.label), ["例子一", "例子二"]);
});

test("rejects unsupported generated image bytes before publishing them", () => {
  assert.deepEqual(
    detectGeneratedImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    {extension: "png", contentType: "image/png"},
  );
  assert.throws(() => detectGeneratedImageFormat(Buffer.from("not-an-image")), /unsupported image format/u);
});

test("adapts an OpenAI-compatible images/generations response without requesting batches", async () => {
  const originalFetch = globalThis.fetch;
  const originalConfig = {
    base: config.imageGenerationBaseUrl,
    key: config.imageGenerationApiKey,
    model: config.imageGenerationModel,
    size: config.imageGenerationSize,
  };
  let requestBody: Record<string, unknown> = {};
  let requestUrl = "";
  try {
    config.imageGenerationBaseUrl = "https://images.example/v1";
    config.imageGenerationApiKey = "test-image-key";
    config.imageGenerationModel = "test-image-model";
    config.imageGenerationSize = "1536x1024";
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        data: [{b64_json: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}],
      }), {status: 200, headers: {"Content-Type": "application/json"}});
    };
    const generated = await requestGeneratedImage({
      label: "抽象例子",
      purpose: "解释流程",
      prompt: "clean editorial illustration",
      avoid: "text and logos",
      relatedQuote: "举个例子",
    });
    assert.equal(requestUrl, "https://images.example/v1/images/generations");
    assert.equal(requestBody.model, "test-image-model");
    assert.equal(requestBody.n, 1);
    assert.equal(requestBody.size, "1536x1024");
    assert.equal(generated.buffer.length, 8);
  } finally {
    globalThis.fetch = originalFetch;
    config.imageGenerationBaseUrl = originalConfig.base;
    config.imageGenerationApiKey = originalConfig.key;
    config.imageGenerationModel = originalConfig.model;
    config.imageGenerationSize = originalConfig.size;
  }
});

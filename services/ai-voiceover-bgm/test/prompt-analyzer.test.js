import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWithRules } from "../src/prompt-analyzer.js";

test("科技口播生成纯音乐友好的提示词", () => {
  const plan = analyzeWithRules({
    script: "这款 AI 产品可以显著提高团队效率，今天正式发布。",
    durationSeconds: 90,
    title: "新品发布",
  });
  assert.equal(plan.title, "新品发布");
  assert.match(plan.tags, /technology/);
  assert.match(plan.prompt, /instrumental/i);
  assert.match(plan.negativeTags, /vocals/);
});

test("风格提示会合并到 tags", () => {
  const plan = analyzeWithRules({
    script: "讲述一段城市历史故事。",
    durationSeconds: 60,
    styleHint: "Chinese acoustic",
  });
  assert.match(plan.tags, /Chinese acoustic/);
  assert.equal(plan.source, "rules");
});

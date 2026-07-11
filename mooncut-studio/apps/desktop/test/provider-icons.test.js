/**
 * Structural check: provider brand icons used by Settings are present.
 */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {providerIconId} from "../src/renderer/lib/providerIconId.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const icons = join(root, "src/renderer/public/provider-icons");

const required = [
  "openai",
  "deepseek",
  "moonshot",
  "zhipu",
  "siliconflow",
  "openrouter",
  "ollama",
  "custom-openai",
  "mock-local",
];

test("provider brand SVGs exist for light and dark themes", () => {
  for (const id of required) {
    assert.ok(existsSync(join(icons, "light", `${id}.svg`)), `missing light ${id}`);
    assert.ok(existsSync(join(icons, "dark", `${id}.svg`)), `missing dark ${id}`);
  }
});

test("providerIconId maps catalog and aliases", () => {
  assert.equal(providerIconId({id: "deepseek", catalogId: "deepseek"}), "deepseek");
  assert.equal(providerIconId({id: "openai"}), "openai");
  assert.equal(providerIconId({id: "unknown-xyz"}), "custom-openai");
});

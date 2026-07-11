import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_CATALOG,
  getCatalogEntry,
  mergeModelList,
  normalizeModelId,
  profileFromCatalog,
  redactSecrets,
  validateProviderBaseUrl,
} from "../dist/index.js";

test("catalog includes practical OpenAI-compatible presets", () => {
  const ids = PROVIDER_CATALOG.map((e) => e.id);
  for (const id of ["mock-local", "openai", "deepseek", "ollama", "openrouter", "custom-openai"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("profileFromCatalog seeds mock and remote defaults", () => {
  const mock = profileFromCatalog("mock-local");
  assert.equal(mock.kind, "mock");
  assert.equal(mock.enabled, true);
  assert.ok((mock.models ?? []).includes("mock-planner"));

  const openai = profileFromCatalog("openai", {apiKey: "sk-test-should-not-echo-here"});
  assert.equal(openai.kind, "remote-openai-compatible");
  assert.equal(openai.baseUrl, "https://api.openai.com/v1");
  assert.ok(openai.plannerModel.length > 0);
});

test("mergeModelList dedupes and trims", () => {
  assert.deepEqual(mergeModelList([" gpt-4o ", "gpt-4o", ""], ["a", "gpt-4o"]), ["gpt-4o", "a"]);
  assert.equal(normalizeModelId("  x y  "), "xy");
});

test("validateProviderBaseUrl rejects non-http for remote", () => {
  assert.throws(() => validateProviderBaseUrl("file:///etc/passwd", "remote-openai-compatible"));
  assert.equal(
    validateProviderBaseUrl("https://api.example.com/v1/", "remote-openai-compatible"),
    "https://api.example.com/v1",
  );
});

test("redactSecrets never leaks connection-test style keys", () => {
  const raw = 'Authorization: Bearer sk-live-secret-value-12345 api_key="super-secret-key-xyz"';
  const out = redactSecrets(raw);
  assert.equal(out.includes("sk-live-secret-value-12345"), false);
  assert.equal(out.includes("super-secret-key-xyz"), false);
  assert.ok(out.includes("[REDACTED]"));
});

test("getCatalogEntry returns undefined for unknown", () => {
  assert.equal(getCatalogEntry("nope"), undefined);
  assert.equal(getCatalogEntry("ollama")?.kind, "local-openai-compatible");
});

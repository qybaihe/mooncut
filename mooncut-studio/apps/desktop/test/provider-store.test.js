/**
 * Exercises shipped ProviderStore — list/upsert/delete/enable/key non-persistence.
 */
import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {pathToFileURL} from "node:url";

const desktopRoot = join(import.meta.dirname, "..");

test("provider store: catalog ensure, upsert masks key, delete reset, enable, test-safe list", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-provider-"));
  try {
    class MemorySecrets {
      #map = new Map();
      async set(k, v) {
        this.#map.set(k, v);
      }
      async get(k) {
        return this.#map.has(k) ? this.#map.get(k) : null;
      }
      async delete(k) {
        this.#map.delete(k);
      }
      async has(k) {
        return this.#map.has(k);
      }
    }

    const {ProviderStore} = await import(
      pathToFileURL(join(desktopRoot, "dist-electron/main/provider-store.js")).href
    );

    const secrets = new MemorySecrets();
    const store = new ProviderStore(join(dir, "providers.json"), secrets);
    const listed = await store.ensureCatalogProfiles();
    assert.ok(listed.length >= 5);
    assert.ok(listed.some((p) => p.id === "openai"));
    assert.ok(listed.every((p) => !("apiKey" in p) || p.apiKey === undefined));

    const after = await store.upsert({
      id: "openai",
      name: "OpenAI",
      kind: "remote-openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      catalogId: "openai",
      apiKey: "sk-super-secret-never-persist-plain",
      plannerModel: "gpt-4.1",
      visionModel: "gpt-4o",
      imageModel: "",
      models: ["gpt-4.1", "gpt-4o"],
      allowVideoFrameUpload: true,
      timeoutMs: 60_000,
      enabled: true,
      isDefault: true,
    });
    const openai = after.find((p) => p.id === "openai");
    assert.equal(openai?.hasApiKey, true);
    assert.equal(openai?.enabled, true);
    assert.equal(openai?.isDefault, true);
    assert.ok(openai?.models.includes("gpt-4.1"));

    const disk = await readFile(join(dir, "providers.json"), "utf8");
    assert.equal(disk.includes("sk-super-secret-never-persist-plain"), false);

    const secret = await store.getSecret("openai");
    assert.equal(secret, "sk-super-secret-never-persist-plain");

    await store.upsert({
      id: "openai",
      name: "OpenAI",
      kind: "remote-openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      plannerModel: "gpt-4.1",
      visionModel: "gpt-4o",
      imageModel: "",
      models: ["gpt-4.1"],
      allowVideoFrameUpload: true,
      timeoutMs: 60_000,
      enabled: false,
      isDefault: false,
    });
    const disabled = (await store.list()).find((p) => p.id === "openai");
    assert.equal(disabled?.enabled, false);

    const afterDelete = await store.delete("openai");
    const reset = afterDelete.find((p) => p.id === "openai");
    assert.ok(reset);
    assert.equal(reset.enabled, false);
    assert.equal(reset.hasApiKey, false);

    await assert.rejects(() => store.delete("mock-local"), /不可删除/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

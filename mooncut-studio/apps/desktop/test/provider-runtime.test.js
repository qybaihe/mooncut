/**
 * Provider runtime assembly fingerprint + structural wiring of jobCreate.
 */
import assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {AgentSupervisor} from "@mooncut/studio-agent-host";

test("AgentSupervisor.fingerprintProvider is stable and key-length only", () => {
  const a = AgentSupervisor.fingerprintProvider({
    baseUrl: "https://api.example/v1",
    apiKey: "sk-secret-abc",
    plannerModel: "p1",
    visionModel: "v1",
  });
  const b = AgentSupervisor.fingerprintProvider({
    baseUrl: "https://api.example/v1",
    apiKey: "sk-secret-abc",
    plannerModel: "p1",
    visionModel: "v1",
  });
  assert.equal(a, b);
  assert.equal(a.includes("sk-secret"), false);
  const c = AgentSupervisor.fingerprintProvider({
    baseUrl: "https://api.example/v1",
    apiKey: "sk-other",
    plannerModel: "p1",
    visionModel: "v1",
  });
  assert.notEqual(a, c);
});

test("structural: jobCreate source wires provider into supervisor options", async () => {
  const {readFile} = await import("node:fs/promises");
  const {fileURLToPath} = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const ipc = await readFile(join(root, "src/main/ipc.ts"), "utf8");
  assert.ok(ipc.includes("resolveProviderForJob"));
  assert.ok(ipc.includes("toRuntimeConfig") || ipc.includes("resolveProviderForJob(providers"));
  assert.ok(ipc.includes("materializeJobArtifacts"));
  assert.ok(ipc.includes("fingerprintProvider"));
  const store = await readFile(join(root, "src/main/provider-store.ts"), "utf8");
  assert.ok(store.includes("async toRuntimeConfig"));
  assert.ok(store.includes("MOONCUT_GATEWAY") === false); // env is supervisor side
});

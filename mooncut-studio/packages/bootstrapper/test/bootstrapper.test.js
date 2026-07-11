import assert from "node:assert/strict";
import {mkdtemp, writeFile, mkdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {probeDependencies, summarizeReadiness, verifySha256, sha256File} from "../dist/index.js";

test("sha256 verify", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-boot-"));
  const file = join(dir, "a.bin");
  await writeFile(file, "hello-studio");
  const hash = await sha256File(file);
  assert.equal(await verifySha256(file, hash), true);
  assert.equal(await verifySha256(file, "0".repeat(64)), false);
  await rm(dir, {recursive: true, force: true});
});

test("probeDependencies returns stable ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-boot-ws-"));
  await mkdir(join(dir, "mooncut-pi-agent", "node_modules"), {recursive: true});
  await writeFile(join(dir, "mooncut-pi-agent", "package.json"), "{\"name\":\"x\"}\n");
  const deps = await probeDependencies({
    platform: process.platform,
    arch: process.arch,
    workspaceRoot: dir,
    managedRoot: join(dir, "managed"),
  });
  const ids = deps.map((d) => d.id).sort();
  assert.ok(ids.includes("ffmpeg"));
  assert.ok(ids.includes("pi-agent"));
  assert.equal(deps.find((d) => d.id === "pi-agent")?.status, "ready");
  const summary = summarizeReadiness(deps);
  assert.equal(summary.canOpenProjects, true);
  assert.equal(summary.canRunMockAgent, true);
  await rm(dir, {recursive: true, force: true});
});

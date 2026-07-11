import assert from "node:assert/strict";
import {mkdtemp, rm, readFile, mkdir, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {existsSync} from "node:fs";
import test from "node:test";
import {AgentClient, AgentSupervisor, createSessionToken, MockAgentServer, parseAgentReadyLine, resolveAgentSpawnPlan, materializeJobArtifacts, isHttpUrl} from "../dist/index.js";

test("mock agent e2e: create → progress → complete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-mock-"));
  const token = createSessionToken();
  const server = new MockAgentServer({token, workDir: dir, stageIntervalMs: 30});
  const {port} = await server.start();
  const client = new AgentClient({baseUrl: `http://127.0.0.1:${port}`, token});
  try {
    const health = await client.healthz();
    assert.equal(health.ok, true);
    const created = await client.createJob({
      inputPath: join(dir, "source.mp4"),
      prompt: "mock cut",
      title: "Demo",
    });
    let job = await client.getJob(created.id);
    const started = Date.now();
    while (job.status === "queued" || job.status === "running") {
      if (Date.now() - started > 10_000) throw new Error("timeout waiting for job");
      await new Promise((r) => setTimeout(r, 40));
      job = await client.getJob(created.id);
    }
    assert.equal(job.status, "completed");
    assert.ok(job.result?.artifacts?.video);
    assert.ok(job.result?.artifacts?.subtitles);
    assert.ok(job.result?.artifacts?.qualityReview);
    const dest = join(dir, "downloaded-subtitles.json");
    await client.downloadArtifact(created.id, "subtitles", dest);
    const text = await readFile(dest, "utf8");
    assert.ok(text.includes("Mock transcript"));
  } finally {
    await server.stop();
    await rm(dir, {recursive: true, force: true});
  }
});

test("mock agent cancel retains safety message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-cancel-"));
  const token = createSessionToken();
  const server = new MockAgentServer({token, workDir: dir, stageIntervalMs: 200});
  const {port} = await server.start();
  const client = new AgentClient({baseUrl: `http://127.0.0.1:${port}`, token});
  try {
    const created = await client.createJob({inputPath: "/tmp/x.mp4", prompt: "slow"});
    await new Promise((r) => setTimeout(r, 50));
    const cancelled = await client.cancelJob(created.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.stage, "cancelled");
    assert.ok(cancelled.error?.includes("not deleted"));
  } finally {
    await server.stop();
    await rm(dir, {recursive: true, force: true});
  }
});

test("unauthorized requests are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-authz-"));
  const server = new MockAgentServer({token: "secret-token-value", workDir: dir, stageIntervalMs: 10});
  const {port} = await server.start();
  try {
    const bad = new AgentClient({baseUrl: `http://127.0.0.1:${port}`, token: "wrong"});
    await assert.rejects(() => bad.createJob({inputPath: "/x"}), /Unauthorized|create job failed/);
  } finally {
    await server.stop();
    await rm(dir, {recursive: true, force: true});
  }
});

test("supervisor mock mode health", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-sup-"));
  const supervisor = new AgentSupervisor({
    mode: "mock",
    runtimeRoot: dir,
    workspaceRoot: dir,
    logPath: join(dir, "agent.log"),
    stageIntervalMs: 20,
  });
  try {
    const status = await supervisor.start();
    assert.equal(status.state, "healthy");
    assert.equal(status.host, "127.0.0.1");
    assert.ok(status.port && status.port > 0);
    const client = supervisor.getClient();
    const job = await client.createJob({inputPath: join(dir, "a.mp4")});
    assert.ok(job.id);
  } finally {
    await supervisor.stop();
    await rm(dir, {recursive: true, force: true});
  }
});

test("provider connection test redacts errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-prov-"));
  const token = createSessionToken();
  // Local OpenAI-compatible mock
  const server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({data: [{id: "gpt-local"}, {id: "vision-local"}]}));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const client = new AgentClient({baseUrl: `http://127.0.0.1:${port}`, token});
  try {
    const ok = await client.testOpenAiCompatible(`http://127.0.0.1:${port}/v1`, "sk-test-secret-key", 5_000);
    assert.equal(ok.ok, true);
    assert.ok(ok.modelsSample?.includes("gpt-local"));
    const fail = await client.testOpenAiCompatible(`http://127.0.0.1:${port}/missing`, "sk-test-secret-key", 5_000);
    assert.equal(fail.ok, false);
    assert.equal(fail.error?.includes("sk-test-secret-key"), false);
  } finally {
    server.close();
    await rm(dir, {recursive: true, force: true});
  }
});


test("resolveAgentSpawnPlan prefers dist/cli.mjs for Electron (no strip-types)", () => {
  // packages/agent-host/test -> monorepo is ../../../..
  const root = join(fileURLToPath(new URL("../../../..", import.meta.url)));
  const candidate = join(root, "mooncut-pi-agent");
  const useRoot = existsSync(join(candidate, "src", "cli.ts")) ? candidate : join(root, "..", "mooncut-pi-agent");
  assert.ok(existsSync(join(useRoot, "dist", "cli.mjs")), `dist/cli.mjs missing at ${useRoot} — run build:studio`);
  const plan = resolveAgentSpawnPlan({
    agentRoot: useRoot,
    preferElectronNode: true,
    electronExecPath: "/fake/Electron",
  });
  assert.equal(plan.strategy, "dist-js");
  assert.ok(plan.entryPath.endsWith("cli.mjs") || plan.entryPath.endsWith("cli.js"));
  assert.equal(plan.args.includes("--experimental-strip-types"), false);
  assert.equal(plan.args.at(-1), "serve");
  assert.equal(plan.executable, "/fake/Electron");
});

test("resolveAgentSpawnPlan throws for Electron when dist missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-no-dist-"));
  try {
    assert.throws(
      () =>
        resolveAgentSpawnPlan({
          agentRoot: dir,
          preferElectronNode: true,
          electronExecPath: "/fake/Electron",
        }),
      /prebuilt entry missing|dist\/cli/,
    );
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("parseAgentReadyLine extracts host and port", () => {
  const parsed = parseAgentReadyLine("noise\nMOONCUT_AGENT_READY host=127.0.0.1 port=54321\nmore");
  assert.deepEqual(parsed, {host: "127.0.0.1", port: 54321});
  assert.equal(parseAgentReadyLine("no ready"), null);
});

test("materializeJobArtifacts downloads via client.downloadArtifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-art-"));
  try {
    const calls = [];
    const client = {
      async downloadArtifact(jobId, name, dest) {
        calls.push({jobId, name, dest});
        await mkdir(join(dir, "exports", jobId), {recursive: true});
        await writeFile(dest, `content-${name}`);
        return dest;
      },
    };
    const out = await materializeJobArtifacts({
      client,
      projectRoot: dir,
      jobId: "abc123",
      artifacts: {
        video: "http://127.0.0.1:9/v1/edit-jobs/abc123/artifacts/video",
        subtitles: "http://127.0.0.1:9/v1/edit-jobs/abc123/artifacts/subtitles",
      },
    });
    assert.equal(calls.length, 2);
    assert.ok(out.video.startsWith(dir));
    assert.ok(existsSync(out.video));
    assert.ok(isHttpUrl("http://x"));
    assert.equal(isHttpUrl("/tmp/a"), false);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

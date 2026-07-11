/**
 * Studio data root isolation: config paths honor MOONCUT_DATA_ROOT.
 * Run with: node --experimental-strip-types --test test/studio-data-root.test.ts
 */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";

const agentRoot = fileURLToPath(new URL("..", import.meta.url));

test("config resolves data/assets/jobs under MOONCUT_DATA_ROOT", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "mooncut-data-"));
  try {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "-e",
        `
        process.env.MOONCUT_DATA_ROOT = ${JSON.stringify(dataRoot)};
        process.env.MOONCUT_DATABASE_PATH = ${JSON.stringify(join(dataRoot, "mooncut.sqlite"))};
        const m = await import(${JSON.stringify(join(agentRoot, "src/config.ts"))});
        console.log(JSON.stringify({
          dataRoot: m.dataRoot,
          assetsRoot: m.assetsRoot,
          jobsRoot: m.jobsRoot,
          databasePath: m.config.databasePath,
        }));
        `,
      ],
      {cwd: agentRoot, env: {...process.env, MOONCUT_DATA_ROOT: dataRoot}},
    );
    let out = "";
    let err = "";
    child.stdout?.on("data", (c) => {
      out += c.toString();
    });
    child.stderr?.on("data", (c) => {
      err += c.toString();
    });
    const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)));
    assert.equal(code, 0, err || out);
    const line = out.trim().split("\n").filter(Boolean).at(-1) ?? "";
    const parsed = JSON.parse(line) as {
      dataRoot: string;
      assetsRoot: string;
      jobsRoot: string;
      databasePath: string;
    };
    assert.equal(parsed.dataRoot, dataRoot);
    assert.ok(parsed.assetsRoot.startsWith(dataRoot));
    assert.ok(parsed.jobsRoot.startsWith(dataRoot));
    assert.ok(parsed.databasePath.startsWith(dataRoot));
    assert.equal(parsed.assetsRoot.includes(`${agentRoot}/data`), false);
  } finally {
    await rm(dataRoot, {recursive: true, force: true});
  }
});

test("server prints MOONCUT_AGENT_READY with bound port (prebuilt dist/cli.mjs)", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "mooncut-ready-"));
  const token = "test-token-ready-marker";
  const entry = join(agentRoot, "dist", "cli.mjs");
  assert.ok(existsSync(entry), "dist/cli.mjs required — run npm run build:studio");
  try {
    const child = spawn(
      process.execPath,
      [entry, "serve"],
      {
        cwd: agentRoot,
        env: {
          ...process.env,
          MOONCUT_STUDIO_MODE: "true",
          MOONCUT_AGENT_HOST: "127.0.0.1",
          MOONCUT_AGENT_PORT: "0",
          MOONCUT_API_KEYS: token,
          MOONCUT_DATA_ROOT: dataRoot,
          MOONCUT_DATABASE_PATH: join(dataRoot, "db.sqlite"),
          MOONCUT_ASSETS_ROOT: join(dataRoot, "assets"),
          MOONCUT_JOBS_ROOT: join(dataRoot, "jobs"),
          MOONCUT_ALLOW_INPUT_PATH: "true",
          MOONCUT_PROBE_GATEWAY_ON_HEALTH: "false",
          MOONCUT_REQUIRE_SUBTITLE_SERVICE: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    const ready = new Promise<{host: string; port: number}>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ready: ${output}`)), 15_000);
      const onData = (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const match = output.match(/MOONCUT_AGENT_READY host=(\S+) port=(\d+)/u);
        if (match) {
          clearTimeout(timer);
          resolve({host: match[1]!, port: Number(match[2])});
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`exited ${code}: ${output}`));
      });
    });
    try {
      const {port} = await ready;
      assert.ok(port > 0);
      // cancel route exists
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      assert.equal(res.ok, true);
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  } finally {
    await rm(dataRoot, {recursive: true, force: true});
  }
});

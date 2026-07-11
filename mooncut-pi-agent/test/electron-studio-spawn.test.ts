/**
 * Honest Electron-as-Node spawn of the prebuilt dist entry (what Supervisor uses).
 * System Node alone is NOT sufficient evidence for Studio real Agent.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const agentRoot = fileURLToPath(new URL("..", import.meta.url));
const monorepoRoot = dirname(agentRoot);

function findElectron(): string | null {
  try {
    const requireFromStudio = createRequire(join(monorepoRoot, "mooncut-studio/package.json"));
    const electronPkg = dirname(requireFromStudio.resolve("electron/package.json"));
    const candidates = [
      join(electronPkg, "dist/Electron.app/Contents/MacOS/Electron"),
      join(electronPkg, "dist/electron"),
      join(electronPkg, "dist/electron.exe"),
    ];
    for (const path of candidates) {
      if (existsSync(path)) return path;
    }
  } catch {
    /* fall through */
  }
  const fallback = [
    join(monorepoRoot, "mooncut-studio/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    join(monorepoRoot, "mooncut-studio/node_modules/electron/dist/electron"),
  ];
  for (const path of fallback) {
    if (existsSync(path)) return path;
  }
  return null;
}

test("dist/cli.mjs exists after build:studio", () => {
  assert.ok(
    existsSync(join(agentRoot, "dist", "cli.mjs")),
    "missing dist/cli.mjs — npm run build:studio must run before Electron spawn",
  );
});

test("Electron ELECTRON_RUN_AS_NODE + dist/cli.mjs emits MOONCUT_AGENT_READY", async () => {
  const electron = findElectron();
  if (!electron) {
    assert.fail("Electron binary not found under mooncut-studio/node_modules — cannot verify Studio spawn path");
  }
  const dataRoot = await mkdtemp(join(tmpdir(), "mooncut-e-spawn-"));
  const entry = join(agentRoot, "dist", "cli.mjs");
  const child = spawn(electron, [entry, "serve"], {
    cwd: agentRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MOONCUT_STUDIO_MODE: "true",
      MOONCUT_AGENT_HOST: "127.0.0.1",
      MOONCUT_AGENT_PORT: "0",
      MOONCUT_API_KEYS: "electron-spawn-test-token",
      MOONCUT_DATA_ROOT: dataRoot,
      MOONCUT_DATABASE_PATH: join(dataRoot, "db.sqlite"),
      MOONCUT_ASSETS_ROOT: join(dataRoot, "assets"),
      MOONCUT_JOBS_ROOT: join(dataRoot, "jobs"),
      MOONCUT_ALLOW_INPUT_PATH: "true",
      MOONCUT_PROBE_GATEWAY_ON_HEALTH: "false",
      MOONCUT_REQUIRE_SUBTITLE_SERVICE: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const ready = new Promise<{port: number}>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Electron agent ready timeout:\n${output}`)), 20_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = output.match(/MOONCUT_AGENT_READY host=(\S+) port=(\d+)/u);
      if (match) {
        clearTimeout(timer);
        resolve({port: Number(match[2])});
      }
      // Fail fast if strip-types / TS errors appear
      if (/ERR_UNKNOWN_FILE_EXTENSION|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|Cannot find module/u.test(output)) {
        clearTimeout(timer);
        reject(new Error(output));
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Electron agent exited ${code}:\n${output}`));
    });
  });

  try {
    const {port} = await ready;
    assert.ok(port > 0 && port < 65536);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.ok, true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    await rm(dataRoot, {recursive: true, force: true});
  }
});

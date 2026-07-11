/**
 * Gate: the agent root Studio actually uses (resources/mooncut-runtime when present)
 * must include prebuilt dist/cli.mjs, and Electron must be able to start from it.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {cpSync, existsSync, mkdirSync} from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const studioRoot = fileURLToPath(new URL("../../..", import.meta.url));
const monorepoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const monorepoAgent = join(monorepoRoot, "mooncut-pi-agent");
const resourcesAgent = join(desktopRoot, "resources/mooncut-runtime/mooncut-pi-agent");

function findElectron() {
  try {
    const requireFromStudio = createRequire(join(studioRoot, "package.json"));
    const electronPkg = dirname(requireFromStudio.resolve("electron/package.json"));
    for (const rel of [
      "dist/Electron.app/Contents/MacOS/Electron",
      "dist/electron",
      "dist/electron.exe",
    ]) {
      const path = join(electronPkg, rel);
      if (existsSync(path)) return path;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function ensureResourcesDist() {
  const monorepoDist = join(monorepoAgent, "dist", "cli.mjs");
  assert.ok(existsSync(monorepoDist), "monorepo dist/cli.mjs missing — run build:studio");
  if (!existsSync(join(resourcesAgent, "package.json"))) {
    return null; // no prepared resources tree in this checkout
  }
  mkdirSync(join(resourcesAgent, "dist"), {recursive: true});
  cpSync(monorepoDist, join(resourcesAgent, "dist", "cli.mjs"));
  return join(resourcesAgent, "dist", "cli.mjs");
}

test("resources mooncut-runtime agent has (or receives) dist/cli.mjs when tree exists", () => {
  if (!existsSync(join(resourcesAgent, "package.json"))) {
    // Accept monorepo-only checkouts without a prepared runtime tree.
    assert.ok(existsSync(join(monorepoAgent, "dist", "cli.mjs")));
    return;
  }
  const entry = ensureResourcesDist();
  assert.ok(entry && existsSync(entry), "resources agent still missing dist/cli.mjs after sync");
});

test("Electron ELECTRON_RUN_AS_NODE starts from runtime-bundle agent path", async () => {
  const electron = findElectron();
  assert.ok(electron, "Electron binary required for runtime agent spawn gate");

  // Prefer resources agent path (what resolveRuntimeLayout uses in dev when present).
  let agentRoot = resourcesAgent;
  let entry = join(resourcesAgent, "dist", "cli.mjs");
  if (!existsSync(join(resourcesAgent, "package.json"))) {
    agentRoot = monorepoAgent;
    entry = join(monorepoAgent, "dist", "cli.mjs");
  } else {
    ensureResourcesDist();
    entry = join(resourcesAgent, "dist", "cli.mjs");
  }
  assert.ok(existsSync(entry), `entry missing: ${entry}`);

  const dataRoot = await mkdtemp(join(tmpdir(), "mooncut-rt-spawn-"));
  const child = spawn(electron, [entry, "serve"], {
    cwd: agentRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MOONCUT_STUDIO_MODE: "true",
      MOONCUT_AGENT_HOST: "127.0.0.1",
      MOONCUT_AGENT_PORT: "0",
      MOONCUT_API_KEYS: "runtime-bundle-spawn-token",
      MOONCUT_AGENT_ROOT: agentRoot,
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
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout from ${entry}:\n${output}`)), 20_000);
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/MOONCUT_AGENT_READY host=(\S+) port=(\d+)/u);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[2]));
      }
      if (/ERR_UNKNOWN_FILE_EXTENSION|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|prebuilt entry missing/u.test(output)) {
        clearTimeout(timer);
        reject(new Error(output));
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`exited ${code} entry=${entry}\n${output}`));
    });
  });

  try {
    const port = await ready;
    assert.ok(port > 0);
    // Prove we used the resources path when it exists
    if (existsSync(join(resourcesAgent, "package.json"))) {
      assert.ok(entry.includes("resources/mooncut-runtime"), `expected resources entry, got ${entry}`);
    }
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.ok, true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 250));
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    await rm(dataRoot, {recursive: true, force: true});
  }
});

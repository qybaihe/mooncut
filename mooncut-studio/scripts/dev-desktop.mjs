import {spawn} from "node:child_process";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps/desktop");

const run = (command, args, cwd, env = {}) =>
  spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {...process.env, ...env},
  });

// Build packages once for types/runtime
for (const pkg of ["shared", "project-format", "bootstrapper", "agent-host"]) {
  const result = spawn("npm", ["run", "build", "-w", `@mooncut/studio-${pkg}`], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  await new Promise((resolvePromise, reject) => {
    result.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`build ${pkg} failed`))));
  });
}

// Prebuild Agent dist entry for Electron-as-Node real mode
const monorepoRoot = resolve(root, "..");
const agentRoot = join(monorepoRoot, "mooncut-pi-agent");
await new Promise((resolvePromise, reject) => {
  const child = spawn("node", ["scripts/build-studio-entry.mjs"], {
    cwd: agentRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code) =>
    code === 0 ? resolvePromise() : reject(new Error("mooncut-pi-agent build:studio failed")),
  );
});

// Sync into resources/mooncut-runtime if present (resolveRuntimeLayout prefers this tree in dev)
const {cpSync, existsSync, mkdirSync} = await import("node:fs");
const resourcesAgent = join(desktop, "resources/mooncut-runtime/mooncut-pi-agent");
const distMjs = join(agentRoot, "dist", "cli.mjs");
if (existsSync(join(resourcesAgent, "package.json")) && existsSync(distMjs)) {
  mkdirSync(join(resourcesAgent, "dist"), {recursive: true});
  cpSync(distMjs, join(resourcesAgent, "dist", "cli.mjs"));
  console.log("[dev-desktop] synced dist/cli.mjs → resources/mooncut-runtime agent");
}

// tsc main + esbuild preload CJS
await new Promise((resolvePromise, reject) => {
  const child = run("npx", ["tsc", "-p", "tsconfig.node.json"], desktop);
  child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error("tsc failed"))));
});
await new Promise((resolvePromise, reject) => {
  const child = run(
    "npx",
    [
      "esbuild",
      "src/preload/index.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--external:electron",
      "--outfile=dist-electron/preload/index.cjs",
    ],
    desktop,
  );
  child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error("preload bundle failed"))));
});

const vite = run("npx", ["vite", "--config", "vite.config.ts"], desktop);
await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));

const electron = run(
  "npx",
  ["electron", "."],
  desktop,
  {MOONCUT_STUDIO_DEV: "1", ELECTRON_DISABLE_SECURITY_WARNINGS: "1"},
);

const shutdown = () => {
  vite.kill("SIGTERM");
  electron.kill("SIGTERM");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

electron.on("exit", () => {
  vite.kill("SIGTERM");
  process.exit(0);
});

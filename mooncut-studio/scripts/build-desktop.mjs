import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import * as esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps/desktop");

const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, {cwd, stdio: "inherit", shell: process.platform === "win32"});
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// Build workspace packages first
for (const pkg of ["shared", "project-format", "bootstrapper", "agent-host"]) {
  run("npm", ["run", "build", "-w", `@mooncut/studio-${pkg}`]);
}

// Prebuild mooncut-pi-agent dist/cli.mjs for Electron-as-Node (strip-types cannot run full TS).
const monorepoRoot = resolve(root, "..");
const agentRoot = join(monorepoRoot, "mooncut-pi-agent");
if (existsSync(join(agentRoot, "scripts/build-studio-entry.mjs"))) {
  run("node", ["scripts/build-studio-entry.mjs"], agentRoot);
}

// Keep prepared resources/mooncut-runtime agent in sync with monorepo dist (dev + pack inputs).
const resourcesAgent = join(desktop, "resources/mooncut-runtime/mooncut-pi-agent");
const monorepoDist = join(agentRoot, "dist");
if (existsSync(join(resourcesAgent, "package.json")) && existsSync(join(monorepoDist, "cli.mjs"))) {
  const {cpSync, mkdirSync: mk} = await import("node:fs");
  mk(join(resourcesAgent, "dist"), {recursive: true});
  cpSync(join(monorepoDist, "cli.mjs"), join(resourcesAgent, "dist", "cli.mjs"));
  console.log("[build-desktop] synced dist/cli.mjs → resources/mooncut-runtime/mooncut-pi-agent/dist/");
}

// Compile main process (ESM)
run("npx", ["tsc", "-p", "tsconfig.node.json"], desktop);

// Bundle preload as single CJS for Electron sandbox compatibility
const preloadOut = join(desktop, "dist-electron/preload");
mkdirSync(preloadOut, {recursive: true});
await esbuild.build({
  entryPoints: [join(desktop, "src/preload/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(preloadOut, "index.cjs"),
  external: ["electron"],
  sourcemap: true,
});

// Build renderer with vite
run("npx", ["vite", "build", "--config", "vite.config.ts"], desktop);

const resources = join(desktop, "resources");
if (!existsSync(resources)) mkdirSync(resources, {recursive: true});

console.log("[build-desktop] ok (main ESM + preload CJS + renderer)");

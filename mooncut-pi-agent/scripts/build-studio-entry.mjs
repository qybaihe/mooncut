/**
 * Prebuild a plain ESM entry for Studio / Electron-as-Node.
 * Electron Node 22 strip-types cannot run parameter properties in TS sources.
 */
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {mkdirSync, existsSync} from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentRoot = resolve(__dirname, "..");
const monorepoRoot = resolve(agentRoot, "..");
const outFile = join(agentRoot, "dist", "cli.mjs");

const require = createRequire(import.meta.url);
const esbuildCandidates = [
  join(monorepoRoot, "mooncut-studio/node_modules/esbuild"),
  join(agentRoot, "node_modules/esbuild"),
  "esbuild",
];

let esbuild;
for (const candidate of esbuildCandidates) {
  try {
    esbuild = require(candidate);
    break;
  } catch {
    /* try next */
  }
}
if (!esbuild) {
  console.error("[build-studio-entry] esbuild not found; install in mooncut-studio or locally");
  process.exit(1);
}

mkdirSync(join(agentRoot, "dist"), {recursive: true});
await esbuild.build({
  entryPoints: [join(agentRoot, "src/cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node22",
  outfile: outFile,
  banner: {
    js: "/* mooncut-pi-agent prebuilt studio entry — for Electron ELECTRON_RUN_AS_NODE */",
  },
  logLevel: "info",
  absWorkingDir: agentRoot,
});

if (!existsSync(outFile)) {
  console.error("[build-studio-entry] missing output", outFile);
  process.exit(1);
}
console.log(`[build-studio-entry] wrote ${outFile}`);

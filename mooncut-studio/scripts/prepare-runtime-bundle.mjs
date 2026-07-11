/**
 * Build a self-contained mooncut-runtime tree for Electron extraResources.
 * Layout (siblings, matching pi-agent workspaceRoot expectations):
 *
 *   apps/desktop/resources/mooncut-runtime/
 *     mooncut-pi-agent/
 *     remotion-studio/
 *     face-tracker/
 *     hybrid-subtitle-service/
 *     bin/{ffmpeg,ffprobe}
 *     MANIFEST.json
 */
import {spawnSync} from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(__dirname, "..");
const monorepoRoot = resolve(studioRoot, "..");
const outRoot = join(studioRoot, "apps/desktop/resources/mooncut-runtime");
const require = createRequire(import.meta.url);

const log = (msg) => console.log(`[prepare-runtime] ${msg}`);

const rsync = (src, dest, excludes = []) => {
  mkdirSync(dirname(dest), {recursive: true});
  if (process.platform === "win32") {
    // Fallback: recursive copy (slower, less exclude control)
    mkdirSync(dest, {recursive: true});
    cpSync(src, dest, {
      recursive: true,
      filter: (source) => {
        const base = source.split(/[/\\]/).pop();
        return !excludes.some((ex) => source.includes(ex) || base === ex);
      },
    });
    return;
  }
  const args = ["-a", "--delete"];
  for (const ex of excludes) args.push("--exclude", ex);
  args.push(`${src}/`, `${dest}/`);
  mkdirSync(dest, {recursive: true});
  const result = spawnSync("rsync", args, {stdio: "inherit"});
  if (result.status !== 0) {
    log(`rsync failed for ${src}, falling back to cpSync`);
    cpSync(src, dest, {recursive: true, force: true});
  }
};

const ensureDir = (path) => mkdirSync(path, {recursive: true});

// Clean previous bundle (keep if MOONCUT_RUNTIME_KEEP=1 for faster iter)
if (existsSync(outRoot) && process.env.MOONCUT_RUNTIME_KEEP !== "1") {
  log(`removing ${outRoot}`);
  rmSync(outRoot, {recursive: true, force: true});
}
ensureDir(outRoot);

const runtimeProfile = (process.env.MOONCUT_RUNTIME_PROFILE || "full").toLowerCase();
const minimal = runtimeProfile === "minimal" || runtimeProfile === "ci";
if (minimal) log(`runtime profile=minimal (agent + ffmpeg only; skip remotion/face/subtitle)`);

// ── pi-agent ──────────────────────────────────────────────
const agentSrc = join(monorepoRoot, "mooncut-pi-agent");
const agentDest = join(outRoot, "mooncut-pi-agent");
if (!existsSync(join(agentSrc, "package.json"))) {
  console.error("mooncut-pi-agent not found in monorepo");
  process.exit(1);
}
log("prebuilding mooncut-pi-agent studio entry (dist/cli.mjs)…");
const studioEntryBuild = spawnSync("node", ["scripts/build-studio-entry.mjs"], {
  cwd: agentSrc,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (studioEntryBuild.status !== 0) {
  console.error("mooncut-pi-agent build:studio failed — Electron real Agent cannot start without dist/cli.mjs");
  process.exit(studioEntryBuild.status ?? 1);
}
if (!existsSync(join(agentSrc, "dist", "cli.mjs"))) {
  console.error("missing mooncut-pi-agent/dist/cli.mjs after build:studio");
  process.exit(1);
}

log("bundling mooncut-pi-agent…");
rsync(agentSrc, agentDest, [
  "data",
  "node_modules/.cache",
  ".env",
  ".env.*",
  ".venv-transcribe",
  "test",
  "*.log",
]);
if (!existsSync(join(agentDest, "dist", "cli.mjs"))) {
  console.error("runtime bundle missing mooncut-pi-agent/dist/cli.mjs");
  process.exit(1);
}

// Destination paths always defined so MANIFEST components can existSync them
// under both full and minimal profiles (minimal skips copying heavy trees).
const remotionDest = join(outRoot, "remotion-studio");
const faceDest = join(outRoot, "face-tracker");
const subDest = join(outRoot, "hybrid-subtitle-service");

if (!minimal) {
// ── remotion-studio ───────────────────────────────────────
const remotionSrc = join(monorepoRoot, "remotion-studio");
if (existsSync(join(remotionSrc, "package.json"))) {
  log("bundling remotion-studio (pruned)…");
  rsync(remotionSrc, remotionDest, [
    "out",
    "public/agent-jobs",
    "node_modules/.cache",
    "extensions/wallpaper-candidates",
    ".git",
  ]);
  ensureDir(join(remotionDest, "public/agent-jobs"));
  writeFileSync(join(remotionDest, "public/agent-jobs/.gitkeep"), "");
} else {
  log("WARN: remotion-studio missing — real render will be unavailable");
}

// ── face-tracker ──────────────────────────────────────────
const faceSrc = join(monorepoRoot, "face-tracker");
if (existsSync(join(faceSrc, "pyproject.toml"))) {
  log("bundling face-tracker (incl. venv if present)…");
  rsync(faceSrc, faceDest, [
    "__pycache__",
    ".pytest_cache",
    "*.pyc",
    "tests/__pycache__",
  ]);
} else {
  log("WARN: face-tracker missing");
}

// ── hybrid-subtitle-service ───────────────────────────────
const subSrc = join(monorepoRoot, "hybrid-subtitle-service");
if (existsSync(join(subSrc, "pyproject.toml"))) {
  log("bundling hybrid-subtitle-service…");
  rsync(subSrc, subDest, [
    "data/jobs",
    "__pycache__",
    ".pytest_cache",
    "*.pyc",
  ]);
} else {
  log("WARN: hybrid-subtitle-service missing");
}

} // end !minimal heavy components

// ── ffmpeg / ffprobe via pinned npm installers ────────────
// Pins: @ffmpeg-installer/ffmpeg@1.1.0, @ffprobe-installer/ffprobe@2.1.2
// Install into a throwaway prefix; write lock + sha256 of resulting binaries into MANIFEST.
const FFMPEG_PKG = "@ffmpeg-installer/ffmpeg@1.1.0";
const FFPROBE_PKG = "@ffprobe-installer/ffprobe@2.1.2";
const binDir = join(outRoot, "bin");
ensureDir(binDir);
const ffmpegPrefix = join(outRoot, ".ffmpeg-npm");
ensureDir(ffmpegPrefix);
const pinManifest = {
  packages: [FFMPEG_PKG, FFPROBE_PKG],
  note: "Pinned versions only; ad-hoc unversioned npm install is not used.",
  hostArch: process.arch,
  hostPlatform: process.platform,
};
writeFileSync(join(ffmpegPrefix, "pin.json"), JSON.stringify(pinManifest, null, 2) + "\n");
// package.json so npm can produce a lockfile for this pin set
writeFileSync(
  join(ffmpegPrefix, "package.json"),
  JSON.stringify(
    {
      name: "mooncut-runtime-ffmpeg-pins",
      private: true,
      dependencies: {
        "@ffmpeg-installer/ffmpeg": "1.1.0",
        "@ffprobe-installer/ffprobe": "2.1.2",
      },
    },
    null,
    2,
  ) + "\n",
);
log("installing pinned ffmpeg/ffprobe binaries…");
const installFfmpeg = spawnSync(
  "npm",
  ["install", "--ignore-scripts=false", "--no-audit", "--no-fund"],
  {cwd: ffmpegPrefix, stdio: "inherit", shell: process.platform === "win32"},
);
if (installFfmpeg.status === 0) {
  try {
    const ffmpegPath = require(join(outRoot, ".ffmpeg-npm/node_modules/@ffmpeg-installer/ffmpeg")).path;
    const ffprobePath = require(join(outRoot, ".ffmpeg-npm/node_modules/@ffprobe-installer/ffprobe")).path;
    const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    cpSync(ffmpegPath, join(binDir, ffmpegName));
    cpSync(ffprobePath, join(binDir, ffprobeName));
    if (process.platform !== "win32") {
      chmodSync(join(binDir, ffmpegName), 0o755);
      chmodSync(join(binDir, ffprobeName), 0o755);
    }
    log(`ffmpeg → ${join(binDir, ffmpegName)}`);
    log(`ffprobe → ${join(binDir, ffprobeName)}`);
  } catch (error) {
    log(`WARN: could not copy ffmpeg installer binaries: ${error.message}`);
    // Fallback: copy homebrew binaries + note (may need dylibs)
    for (const name of ["ffmpeg", "ffprobe"]) {
      const which = spawnSync("which", [name], {encoding: "utf8"});
      if (which.status === 0) {
        const src = which.stdout.trim();
        try {
          cpSync(src, join(binDir, name), {dereference: true});
          chmodSync(join(binDir, name), 0o755);
          log(`fallback copy ${name} from ${src}`);
        } catch (e) {
          log(`fallback failed for ${name}: ${e.message}`);
        }
      }
    }
  }
} else {
  log("WARN: npm ffmpeg installer failed");
}

// Cleanup ffmpeg npm tree (binaries already copied)
if (existsSync(join(outRoot, ".ffmpeg-npm"))) {
  rmSync(join(outRoot, ".ffmpeg-npm"), {recursive: true, force: true});
}

const components = {
  "pi-agent": existsSync(join(agentDest, "package.json")),
  remotion: existsSync(join(remotionDest, "package.json")),
  "face-tracker": existsSync(join(faceDest, "pyproject.toml")),
  "hybrid-subtitle": existsSync(join(subDest, "pyproject.toml")),
  ffmpeg: existsSync(join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")),
  ffprobe: existsSync(join(binDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")),
  "face-tracker-venv": existsSync(join(faceDest, ".venv")),
  "hybrid-subtitle-venv": existsSync(join(subDest, ".venv")),
};

const sha256File = (filePath) => {
  if (!existsSync(filePath)) return null;
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
};
const ffmpegBinPath = join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobeBinPath = join(binDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const binaryIntegrity = {
  ffmpeg: {path: "bin/" + (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"), sha256: sha256File(ffmpegBinPath), arch: process.arch},
  ffprobe: {path: "bin/" + (process.platform === "win32" ? "ffprobe.exe" : "ffprobe"), sha256: sha256File(ffprobeBinPath), arch: process.arch},
};
// Honest arch: embedded installers match the build host only (currently arm64 on Apple Silicon).
const supportedMacArch = process.platform === "darwin" ? [process.arch] : undefined;

const manifest = {
  schemaVersion: "mooncut.runtime.v1",
  createdAt: new Date().toISOString(),
  ffmpegPins: {packages: ["@ffmpeg-installer/ffmpeg@1.1.0", "@ffprobe-installer/ffprobe@2.1.2"]},
  binaryIntegrity,
  supportedArch: {host: process.arch, platform: process.platform, mac: supportedMacArch},

  platform: process.platform,
  arch: process.arch,
  monorepoRoot,
  components,
};

writeFileSync(join(outRoot, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
log(`manifest written. components=${JSON.stringify(components)}`);

// Size report
const du = spawnSync("du", ["-sh", outRoot], {encoding: "utf8"});
if (du.status === 0) log(`bundle size: ${du.stdout.trim()}`);
log(`done → ${outRoot}`);

/**
 * Resolves and materializes the bundled MoonCut runtime so the installed app
 * is self-contained: pi-agent, remotion, face-tracker, hybrid-subtitle, ffmpeg.
 */

import {app} from "electron";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export type RuntimeLayout = {
  /** Directory containing mooncut-pi-agent, remotion-studio, … as siblings */
  workspaceRoot: string;
  agentRoot: string;
  remotionRoot: string;
  faceTrackerRoot: string;
  hybridSubtitleRoot: string;
  binDir: string;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  dataRoot: string;
  source: "bundled" | "materialized" | "monorepo" | "missing";
  manifest?: Record<string, unknown>;
};

function ffmpegName() {
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}
function ffprobeName() {
  return process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
}

/** True when agent tree can be started under Electron (needs prebuilt dist entry). */
function hasAgent(root: string) {
  const agent = join(root, "mooncut-pi-agent");
  if (!existsSync(join(agent, "package.json"))) return false;
  return (
    existsSync(join(agent, "dist", "cli.mjs")) ||
    existsSync(join(agent, "dist", "cli.js"))
  );
}

export function agentStudioEntry(agentRoot: string): string | null {
  const mjs = join(agentRoot, "dist", "cli.mjs");
  const js = join(agentRoot, "dist", "cli.js");
  if (existsSync(mjs)) return mjs;
  if (existsSync(js)) return js;
  return null;
}

function readManifest(root: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(join(root, "MANIFEST.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function layoutFromWorkspace(workspaceRoot: string, dataRoot: string, source: RuntimeLayout["source"]): RuntimeLayout {
  const binDir = join(workspaceRoot, "bin");
  const ffmpegPath = existsSync(join(binDir, ffmpegName())) ? join(binDir, ffmpegName()) : null;
  const ffprobePath = existsSync(join(binDir, ffprobeName())) ? join(binDir, ffprobeName()) : null;
  return {
    workspaceRoot,
    agentRoot: join(workspaceRoot, "mooncut-pi-agent"),
    remotionRoot: join(workspaceRoot, "remotion-studio"),
    faceTrackerRoot: join(workspaceRoot, "face-tracker"),
    hybridSubtitleRoot: join(workspaceRoot, "hybrid-subtitle-service"),
    binDir,
    ffmpegPath,
    ffprobePath,
    dataRoot,
    source,
    manifest: readManifest(workspaceRoot),
  };
}

/** Packaged app Resources path that holds mooncut-runtime. */
export function bundledRuntimeSource(): string | null {
  if (!app.isPackaged) {
    // Dev: prepared bundle next to desktop app
    const devBundle = resolve(here, "../../resources/mooncut-runtime");
    if (hasAgent(devBundle)) return devBundle;
    return null;
  }
  const candidates = [
    join(process.resourcesPath, "mooncut-runtime"),
    join(process.resourcesPath, "resources", "mooncut-runtime"),
  ];
  for (const candidate of candidates) {
    if (hasAgent(candidate)) return candidate;
  }
  return null;
}

export function monorepoWorkspaceRoot(): string | null {
  const candidates = [
    process.env.MOONCUT_WORKSPACE_ROOT,
    resolve(here, "../../../../../../"),
    resolve(here, "../../../../../"),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "../.."),
    process.cwd(),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (hasAgent(candidate)) return candidate;
    if (hasAgent(resolve(candidate, ".."))) return resolve(candidate, "..");
  }
  return null;
}

/**
 * Create a writable workspace by symlinking heavy trees from the read-only
 * bundle and using real directories for agent-jobs / data.
 */
function materializeWritableRuntime(bundleRoot: string, targetRoot: string): void {
  mkdirSync(targetRoot, {recursive: true});
  const stamp = join(targetRoot, ".runtime-stamp");
  const bundleManifest = readManifest(bundleRoot);
  const agentEntry = agentStudioEntry(join(bundleRoot, "mooncut-pi-agent"));
  const stampPayload = JSON.stringify({
    bundleCreatedAt: bundleManifest?.createdAt ?? null,
    appVersion: app.getVersion(),
    // Force rematerialize when Studio entry appears/changes in the bundle.
    agentStudioEntry: agentEntry,
  });

  if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === stampPayload) {
    // Ensure writable agent-jobs still exists
    mkdirSync(join(targetRoot, "remotion-studio", "public", "agent-jobs"), {recursive: true});
    return;
  }

  // Fresh materialize
  if (existsSync(targetRoot)) {
    // Keep target but refresh links
    for (const name of readdirSync(targetRoot)) {
      if (name === ".runtime-stamp") continue;
      rmSync(join(targetRoot, name), {recursive: true, force: true});
    }
  }
  mkdirSync(targetRoot, {recursive: true});

  const linkOrCopy = (name: string) => {
    const from = join(bundleRoot, name);
    const to = join(targetRoot, name);
    if (!existsSync(from)) return;
    try {
      if (process.platform === "win32") {
        cpSync(from, to, {recursive: true});
      } else {
        symlinkSync(from, to, "dir");
      }
    } catch {
      cpSync(from, to, {recursive: true});
    }
  };

  linkOrCopy("mooncut-pi-agent");
  linkOrCopy("face-tracker");
  linkOrCopy("hybrid-subtitle-service");
  linkOrCopy("bin");
  if (existsSync(join(bundleRoot, "MANIFEST.json"))) {
    cpSync(join(bundleRoot, "MANIFEST.json"), join(targetRoot, "MANIFEST.json"));
  }

  // Remotion: symlink most of tree, real public/agent-jobs for writes
  const remotionFrom = join(bundleRoot, "remotion-studio");
  const remotionTo = join(targetRoot, "remotion-studio");
  if (existsSync(remotionFrom)) {
    mkdirSync(remotionTo, {recursive: true});
    for (const entry of readdirSync(remotionFrom)) {
      if (entry === "public") continue;
      const from = join(remotionFrom, entry);
      const to = join(remotionTo, entry);
      try {
        if (process.platform === "win32") {
          if (lstatSync(from).isDirectory()) cpSync(from, to, {recursive: true});
          else cpSync(from, to);
        } else {
          symlinkSync(from, to, lstatSync(from).isDirectory() ? "dir" : "file");
        }
      } catch {
        cpSync(from, to, {recursive: true});
      }
    }
    const publicFrom = join(remotionFrom, "public");
    const publicTo = join(remotionTo, "public");
    mkdirSync(publicTo, {recursive: true});
    if (existsSync(publicFrom)) {
      for (const entry of readdirSync(publicFrom)) {
        if (entry === "agent-jobs") continue;
        const from = join(publicFrom, entry);
        const to = join(publicTo, entry);
        try {
          if (process.platform === "win32") cpSync(from, to, {recursive: true});
          else symlinkSync(from, to, lstatSync(from).isDirectory() ? "dir" : "file");
        } catch {
          cpSync(from, to, {recursive: true});
        }
      }
    }
    mkdirSync(join(publicTo, "agent-jobs"), {recursive: true});
  }

  writeFileSync(stamp, stampPayload);
}

export function resolveRuntimeLayout(): RuntimeLayout {
  const userData = app.getPath("userData");
  const dataRoot = join(userData, "agent-data");
  mkdirSync(dataRoot, {recursive: true});

  const bundle = bundledRuntimeSource();
  if (bundle) {
    // Prefer materializing to userData so remotion can write agent-jobs.
    const materialRoot = join(userData, "mooncut-runtime");
    try {
      materializeWritableRuntime(bundle, materialRoot);
      if (hasAgent(materialRoot)) {
        return layoutFromWorkspace(materialRoot, dataRoot, "materialized");
      }
    } catch (error) {
      console.error("[runtime] materialize failed, using read-only bundle", error);
    }
    return layoutFromWorkspace(bundle, dataRoot, "bundled");
  }

  const mono = monorepoWorkspaceRoot();
  if (mono) {
    return layoutFromWorkspace(mono, dataRoot, "monorepo");
  }

  // Missing — return best-effort empty layout under userData
  const fallback = join(userData, "mooncut-runtime");
  mkdirSync(fallback, {recursive: true});
  return layoutFromWorkspace(fallback, dataRoot, "missing");
}

export function pathWithBundledBin(layout: RuntimeLayout, basePath = process.env.PATH ?? ""): string {
  if (!layout.binDir || !existsSync(layout.binDir)) return basePath;
  const sep = process.platform === "win32" ? ";" : ":";
  return `${layout.binDir}${sep}${basePath}`;
}

/**
 * Portable MoonCut Studio project format + local project index (JSON, SQLite-ready schema).
 * Project files live in user-chosen directories; index lives under app userData.
 */

import {createHash, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {basename, dirname, extname, join, relative, resolve, sep} from "node:path";
import type {
  ProjectMediaAsset,
  ProjectSummary,
  StudioJob,
  StudioSettings,
} from "@mooncut/studio-shared";

export const PROJECT_SCHEMA_VERSION = "mooncut.studio.project.v1" as const;
export const PROJECT_MANIFEST = "mooncut.project.json";
export const INDEX_FILENAME = "project-index.json";
export const SETTINGS_FILENAME = "settings.json";

export type ProjectManifest = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  providerProfileId?: string;
  media: ProjectMediaAsset[];
  jobs: StudioJob[];
};

export type ProjectIndexEntry = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  mediaCount: number;
  jobCount: number;
  lastJobStatus?: StudioJob["status"];
  providerProfileId?: string;
};

export type ProjectIndex = {
  schemaVersion: "mooncut.studio.index.v1";
  projects: ProjectIndexEntry[];
};

const now = () => new Date().toISOString();

const safeName = (value: string) =>
  value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, "-").replace(/\s+/gu, " ").slice(0, 80) || "Untitled";

const mediaKind = (filename: string): ProjectMediaAsset["kind"] => {
  const ext = extname(filename).toLowerCase();
  if ([".mp4", ".mov", ".m4v", ".webm", ".mkv"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".m4a", ".aac", ".flac"].includes(ext)) return "audio";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  return "other";
};

/** Reject path traversal: resolved path must stay under root. */
export function assertWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new Error("Path escapes project root");
  }
  return resolved;
}

export function projectRootFromParent(parentDirectory: string, name: string): string {
  const folder = safeName(name).replace(/\s+/gu, "-");
  return join(resolve(parentDirectory), folder);
}

export async function createProject(
  parentDirectory: string,
  name: string,
  options: {providerProfileId?: string} = {},
): Promise<{manifest: ProjectManifest; rootPath: string}> {
  const rootPath = projectRootFromParent(parentDirectory, name);
  const manifestPath = join(rootPath, PROJECT_MANIFEST);
  // Non-destructive: refuse when a project folder/manifest already exists.
  if (existsSync(manifestPath)) {
    throw new Error(`项目已存在，拒绝覆盖：${rootPath}`);
  }
  if (existsSync(rootPath)) {
    try {
      const entries = await readdir(rootPath);
      if (entries.length > 0) {
        throw new Error(`目标文件夹非空，无法创建同名项目：${rootPath}`);
      }
    } catch (error) {
      if (error instanceof Error && /非空|已存在/u.test(error.message)) throw error;
      throw new Error(`无法创建项目：${rootPath}`);
    }
  }
  await mkdir(join(rootPath, "media"), {recursive: true});
  await mkdir(join(rootPath, "recordings"), {recursive: true});
  await mkdir(join(rootPath, "jobs"), {recursive: true});
  await mkdir(join(rootPath, "exports"), {recursive: true});
  await mkdir(join(rootPath, "logs"), {recursive: true});
  const timestamp = now();
  const manifest: ProjectManifest = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: randomUUID().replaceAll("-", ""),
    name: safeName(name),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(options.providerProfileId ? {providerProfileId: options.providerProfileId} : {}),
    media: [],
    jobs: [],
  };
  await writeManifest(rootPath, manifest);
  await writeFile(
    join(rootPath, "README.txt"),
    [
      "MoonCut Studio Project",
      "======================",
      "",
      `Name: ${manifest.name}`,
      `Id: ${manifest.id}`,
      "",
      "This folder is portable. Keep media/, jobs/, exports/ together.",
      "API keys are NEVER stored in project files — only in OS secure storage.",
      "",
    ].join("\n"),
    "utf8",
  );
  return {manifest, rootPath};
}

export async function writeManifest(rootPath: string, manifest: ProjectManifest): Promise<void> {
  const path = join(rootPath, PROJECT_MANIFEST);
  const tmp = `${path}.${process.pid}.tmp`;
  const next = {...manifest, updatedAt: now()};
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmp, path);
  Object.assign(manifest, next);
}

export async function readManifest(rootPath: string): Promise<ProjectManifest> {
  const path = join(rootPath, PROJECT_MANIFEST);
  const raw = JSON.parse(await readFile(path, "utf8")) as ProjectManifest;
  if (raw.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported project schema: ${String(raw.schemaVersion)}`);
  }
  return raw;
}

export async function importMediaFile(
  rootPath: string,
  sourcePath: string,
): Promise<ProjectMediaAsset> {
  const manifest = await readManifest(rootPath);
  const absoluteSource = resolve(sourcePath);
  const info = await stat(absoluteSource);
  if (!info.isFile()) throw new Error("Selected path is not a file");
  if (info.size === 0) throw new Error("Selected video is empty");
  const filename = basename(absoluteSource);
  const id = createHash("sha256").update(`${absoluteSource}:${info.size}:${info.mtimeMs}`).digest("hex").slice(0, 16);

  // Already inside project (e.g. recordings/) — register in place, no second full copy.
  const resolvedRoot = resolve(rootPath);
  const underRoot =
    absoluteSource === resolvedRoot ||
    absoluteSource.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep);
  if (underRoot) {
    const rel = relative(resolvedRoot, absoluteSource).split(sep).join("/");
    const asset: ProjectMediaAsset = {
      id,
      filename,
      relativePath: rel,
      absolutePath: absoluteSource,
      bytes: info.size,
      kind: mediaKind(filename),
      importedAt: now(),
    };
    manifest.media = [...manifest.media.filter((item) => item.id !== id), asset];
    await writeManifest(rootPath, manifest);
    return asset;
  }

  const destRelative = join("media", `${id}-${filename.replace(/[^\p{L}\p{N}._-]+/gu, "-")}`);
  const destAbsolute = assertWithinRoot(rootPath, destRelative);
  await mkdir(dirname(destAbsolute), {recursive: true});
  try {
    // Prefer hardlink when same volume to avoid doubling large videos.
    await link(absoluteSource, destAbsolute);
  } catch {
    await copyFile(absoluteSource, destAbsolute);
  }
  const asset: ProjectMediaAsset = {
    id,
    filename,
    relativePath: destRelative.split(sep).join("/"),
    absolutePath: destAbsolute,
    bytes: info.size,
    kind: mediaKind(filename),
    importedAt: now(),
  };
  manifest.media = [...manifest.media.filter((item) => item.id !== id), asset];
  await writeManifest(rootPath, manifest);
  return asset;
}

export async function listMedia(rootPath: string): Promise<ProjectMediaAsset[]> {
  const manifest = await readManifest(rootPath);
  return manifest.media.map((asset) => ({
    ...asset,
    absolutePath: assertWithinRoot(rootPath, asset.relativePath),
  }));
}

export async function upsertJob(rootPath: string, job: StudioJob): Promise<ProjectManifest> {
  const manifest = await readManifest(rootPath);
  const index = manifest.jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) manifest.jobs[index] = job;
  else manifest.jobs.unshift(job);
  await writeManifest(rootPath, manifest);
  return manifest;
}

export async function listJobs(rootPath: string): Promise<StudioJob[]> {
  const manifest = await readManifest(rootPath);
  return [...manifest.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function toSummary(entry: ProjectIndexEntry): ProjectSummary {
  return {
    id: entry.id,
    name: entry.name,
    rootPath: entry.rootPath,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastOpenedAt: entry.lastOpenedAt,
    mediaCount: entry.mediaCount,
    jobCount: entry.jobCount,
    lastJobStatus: entry.lastJobStatus,
    providerProfileId: entry.providerProfileId,
  };
}

export async function loadIndex(indexPath: string): Promise<ProjectIndex> {
  try {
    const raw = JSON.parse(await readFile(indexPath, "utf8")) as ProjectIndex;
    if (raw.schemaVersion !== "mooncut.studio.index.v1") {
      return {schemaVersion: "mooncut.studio.index.v1", projects: []};
    }
    return raw;
  } catch {
    return {schemaVersion: "mooncut.studio.index.v1", projects: []};
  }
}

export async function saveIndex(indexPath: string, index: ProjectIndex): Promise<void> {
  await mkdir(dirname(indexPath), {recursive: true});
  const tmp = `${indexPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await rename(tmp, indexPath);
}

export async function upsertIndexEntry(
  indexPath: string,
  rootPath: string,
  manifest: ProjectManifest,
  lastOpenedAt = now(),
): Promise<ProjectIndexEntry> {
  const index = await loadIndex(indexPath);
  const entry: ProjectIndexEntry = {
    id: manifest.id,
    name: manifest.name,
    rootPath: resolve(rootPath),
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    lastOpenedAt,
    mediaCount: manifest.media.length,
    jobCount: manifest.jobs.length,
    lastJobStatus: manifest.jobs[0]?.status,
    providerProfileId: manifest.providerProfileId,
  };
  index.projects = [entry, ...index.projects.filter((item) => item.id !== entry.id)];
  await saveIndex(indexPath, index);
  return entry;
}

export async function removeIndexEntry(indexPath: string, projectId: string): Promise<void> {
  const index = await loadIndex(indexPath);
  index.projects = index.projects.filter((item) => item.id !== projectId);
  await saveIndex(indexPath, index);
}

export async function deleteProjectData(
  indexPath: string,
  rootPath: string,
  projectId: string,
  options: {deleteFiles: boolean},
): Promise<void> {
  await removeIndexEntry(indexPath, projectId);
  if (options.deleteFiles) {
    const resolved = resolve(rootPath);
    const manifest = await readManifest(resolved).catch(() => null);
    if (manifest && manifest.id === projectId) {
      await rm(resolved, {recursive: true, force: true});
    }
  }
}

export async function defaultSettings(workspaceRoot: string): Promise<StudioSettings> {
  return {
    workspaceRoot,
    onboardingCompleted: false,
    locale: "zh-CN",
    theme: "light",
    allowNetworkForProviders: false,
    agentMode: "mock",
  };
}

export async function loadSettings(path: string, fallbackWorkspace: string): Promise<StudioSettings> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as StudioSettings;
    return {
      ...(await defaultSettings(fallbackWorkspace)),
      ...raw,
      workspaceRoot: raw.workspaceRoot || fallbackWorkspace,
    };
  } catch {
    return defaultSettings(fallbackWorkspace);
  }
}

export async function saveSettings(path: string, settings: StudioSettings): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  const tmp = `${path}.${process.pid}.tmp`;
  // Never persist API keys in settings JSON.
  const safe = {...settings};
  await writeFile(tmp, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

/** Export a portable project package (directory copy of essential files). */
export async function exportProjectPackage(
  rootPath: string,
  destinationDirectory: string,
): Promise<string> {
  const manifest = await readManifest(rootPath);
  const packageName = `${safeName(manifest.name)}-${manifest.id.slice(0, 8)}`;
  const dest = join(resolve(destinationDirectory), packageName);
  await mkdir(dest, {recursive: true});
  await copyTree(rootPath, dest, ["node_modules", ".git"]);
  return dest;
}

async function copyTree(src: string, dest: string, ignore: string[]): Promise<void> {
  await mkdir(dest, {recursive: true});
  for (const entry of await readdir(src, {withFileTypes: true})) {
    if (ignore.includes(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, ignore);
    else await copyFile(from, to);
  }
}

export function relativePortable(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

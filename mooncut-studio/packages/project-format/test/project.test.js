import assert from "node:assert/strict";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {
  assertWithinRoot,
  createProject,
  importMediaFile,
  loadIndex,
  upsertIndexEntry,
  writeManifest,
  readManifest,
} from "../dist/index.js";

test("assertWithinRoot blocks path traversal", () => {
  const root = join(tmpdir(), "proj-root");
  assert.throws(() => assertWithinRoot(root, "../outside.txt"));
  assert.ok(assertWithinRoot(root, "media/a.mp4").includes("media"));
});

test("create project, import media, index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-proj-"));
  try {
    const {manifest, rootPath} = await createProject(dir, "Demo Project");
    assert.equal(manifest.schemaVersion, "mooncut.studio.project.v1");
    const sample = join(dir, "sample.mp4");
    await writeFile(sample, Buffer.alloc(64, 1));
    const asset = await importMediaFile(rootPath, sample);
    assert.equal(asset.kind, "video");
    assert.ok(asset.bytes > 0);
    const reloaded = await readManifest(rootPath);
    assert.equal(reloaded.media.length, 1);
    const indexPath = join(dir, "index.json");
    await upsertIndexEntry(indexPath, rootPath, reloaded);
    const index = await loadIndex(indexPath);
    assert.equal(index.projects.length, 1);
    assert.equal(index.projects[0].mediaCount, 1);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("createProject same name does not overwrite existing project", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-collide-"));
  try {
    const first = await createProject(dir, "Same Name");
    const sample = join(dir, "clip.mp4");
    await writeFile(sample, Buffer.alloc(128, 2));
    await importMediaFile(first.rootPath, sample);
    const before = await readManifest(first.rootPath);
    assert.equal(before.media.length, 1);
    const firstId = before.id;
    await assert.rejects(() => createProject(dir, "Same Name"), /已存在|非空/);
    const after = await readManifest(first.rootPath);
    assert.equal(after.id, firstId);
    assert.equal(after.media.length, 1);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("importMediaFile under project root does not duplicate into media/", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooncut-inplace-"));
  try {
    const {rootPath} = await createProject(dir, "InPlace");
    const rec = join(rootPath, "recordings", "take1.webm");
    const {mkdir} = await import("node:fs/promises");
    await mkdir(join(rootPath, "recordings"), {recursive: true});
    await writeFile(rec, Buffer.alloc(32, 3));
    const asset = await importMediaFile(rootPath, rec);
    assert.ok(asset.relativePath.startsWith("recordings/"));
    assert.equal(asset.absolutePath, rec);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

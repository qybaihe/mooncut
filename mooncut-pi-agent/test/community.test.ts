import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {CommunityStore, CommunityStoreError} from "../src/community.ts";
import type {EditJobRecord} from "../src/types.ts";

const completedJob = (id: string, videoPath: string, posterPath: string): EditJobRecord => ({
  id,
  status: "completed",
  stage: "completed",
  progress: 1,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:01:00.000Z",
  inputPath: videoPath,
  originalName: "community-demo.mp4",
  request: {title: "社区口播示例"},
  result: {
    summary: "done",
    artifacts: {video: videoPath, finalContactSheet: posterPath},
    probe: {durationMs: 12_345, fps: 30, width: 1920, height: 1080, hasAudio: true, formatName: "mp4"},
    models: {planner: "glm-5.2", vision: "minimax-m3"},
    quality: {
      schemaVersion: "mooncut.quality.v1",
      ok: true,
      reviewedAt: "2026-07-11T00:01:00.000Z",
      findings: [],
      qaAssets: {},
    },
  },
});

test("persists explicitly shared finished videos in SQLite and keeps publishing idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mooncut-community-"));
  const databasePath = join(directory, "mooncut.sqlite");
  const videoPath = join(directory, "final.mp4");
  const posterPath = join(directory, "poster.jpg");
  await Promise.all([writeFile(videoPath, "video"), writeFile(posterPath, "poster")]);
  const store = new CommunityStore(databasePath);
  try {
    const job = completedJob("a".repeat(32), videoPath, posterPath);
    const first = store.publish(job, {authorName: "小月", title: "第一条社区口播", caption: "把表达分享给更多人。"});
    assert.equal(first.created, true);
    assert.equal(first.post.authorName, "小月");
    assert.equal(first.post.durationMs, 12_345);
    assert.equal(existsSync(databasePath), true);
    assert.equal(store.count(), 1);
    assert.equal(store.list().items[0]?.id, first.post.id);
    assert.equal(store.get(first.post.id)?.videoPath, videoPath);

    const repeated = store.publish(job, {title: "不应覆盖原发布"});
    assert.equal(repeated.created, false);
    assert.equal(repeated.post.title, "第一条社区口播");
    assert.equal(store.count(), 1);

    const second = store.publish(completedJob("c".repeat(32), videoPath, posterPath), {title: "第二条社区口播"});
    assert.equal(second.created, true);
    const firstPage = store.list(1);
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    const secondPage = store.list(1, firstPage.nextCursor);
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(secondPage.items[0]?.id, firstPage.items[0]?.id);
    assert.equal(store.count(), 2);
  } finally {
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("refuses to publish an edit that did not pass quality review", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mooncut-community-reject-"));
  const videoPath = join(directory, "final.mp4");
  const posterPath = join(directory, "poster.jpg");
  await Promise.all([writeFile(videoPath, "video"), writeFile(posterPath, "poster")]);
  const store = new CommunityStore(join(directory, "mooncut.sqlite"));
  try {
    const job = completedJob("b".repeat(32), videoPath, posterPath);
    if (job.result?.quality) job.result.quality.ok = false;
    assert.throws(() => store.publish(job), (error) => error instanceof CommunityStoreError && error.status === 409);
  } finally {
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});

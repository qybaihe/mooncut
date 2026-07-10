import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ChineseMatchPage } from "../src/models.js";
import { screenshotChineseMatch } from "../src/screenshot.js";

const page: ChineseMatchPage = {
  provider: "Baidu Sports",
  matchId: "match-id",
  home: "阿根廷",
  away: "埃及",
  score: "3-2",
  status: "已结束",
  stage: "世界杯1/8决赛",
  startTime: "2026-07-07T16:00:00.000Z",
  summary: null,
  url: "https://tiyu.baidu.com/al/live/detail?matchId=match-id&tab=球员评分",
  views: {
    ratings: "https://tiyu.baidu.com/al/live/detail?matchId=match-id&tab=球员评分",
    match: "https://tiyu.baidu.com/al/live/detail?matchId=match-id&tab=赛况",
    chat: "https://tiyu.baidu.com/al/live/detail?matchId=match-id&tab=聊天"
  }
};

test("screenshotChineseMatch defaults to ratings and atomically publishes the PNG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-cn-shot-"));
  const outPath = join(directory, "ratings.png");
  try {
    const result = await screenshotChineseMatch(
      page,
      { outPath },
      {
        capture: async (url, temporaryPath, view) => {
          assert.equal(url, page.views.ratings);
          assert.equal(view, "ratings");
          assert.notEqual(temporaryPath, outPath);
          await writeFile(temporaryPath, "png-data");
          return { width: 890, height: 720 };
        }
      }
    );

    assert.deepEqual(result, {
      path: outPath,
      url: page.views.ratings,
      view: "ratings",
      width: 890,
      height: 720
    });
    assert.equal(await readFile(outPath, "utf8"), "png-data");
    assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".part-")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("screenshotChineseMatch preserves an existing file when capture fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-cn-shot-fail-"));
  const outPath = join(directory, "ratings.png");
  await writeFile(outPath, "old-good-image");
  try {
    await assert.rejects(
      () => screenshotChineseMatch(
        page,
        { outPath, overwrite: true },
        {
          capture: async (_url, temporaryPath) => {
            await writeFile(temporaryPath, "partial");
            throw new Error("mock screenshot failure");
          }
        }
      ),
      /mock screenshot failure/
    );
    assert.equal(await readFile(outPath, "utf8"), "old-good-image");
    assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".part-")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("screenshotChineseMatch refuses an existing file without overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-cn-shot-existing-"));
  const outPath = join(directory, "ratings.png");
  await writeFile(outPath, "keep");
  try {
    await assert.rejects(() => screenshotChineseMatch(page, { outPath }), /截图文件已存在/);
    assert.equal(await readFile(outPath, "utf8"), "keep");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

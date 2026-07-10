import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FifaWorldCup26Error, type FetchLike } from "../src/client.js";
import { downloadHighlight, resolveStreamUrl } from "../src/downloader.js";

const VIDEO_ID = "JzfSs2Jwd7yn9Ffowg7YQ";
const ASSET = "ICAK2WapMky6ge3JLUJUmA";
const QUERY = "v=2&ct=a&cid=abc";

test("resolveStreamUrl builds the public Uplynk ext master URL", async () => {
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    assert.ok(url.includes(`/videoPlayerData/${VIDEO_ID}`));
    assert.ok(url.includes("locale=en"));
    return new Response(
      JSON.stringify({
        externalVerizonAssetId: ASSET,
        preplayParameters: { queryStr: QUERY }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const stream = await resolveStreamUrl(VIDEO_ID, fetchImpl);
  assert.equal(stream.videoId, VIDEO_ID);
  assert.equal(stream.externalVerizonAssetId, ASSET);
  assert.equal(
    stream.masterUrl,
    `https://content.uplynk.com/ext/5d8e9ef63a204d0b8cb71b50093bde7d/${ASSET}.m3u8?${QUERY}`
  );
});

test("resolveStreamUrl rejects when FIFA returns no asset id", async () => {
  const fetchImpl: FetchLike = async () =>
    new Response(JSON.stringify({}), { status: 200 });
  await assert.rejects(
    () => resolveStreamUrl(VIDEO_ID, fetchImpl),
    /未返回可下载的视频标识/
  );
});

test("resolveStreamUrl propagates FIFA HTTP errors", async () => {
  const fetchImpl: FetchLike = async () => new Response("{}", { status: 404 });
  await assert.rejects(() => resolveStreamUrl(VIDEO_ID, fetchImpl), /HTTP 404/);
});

test("downloadHighlight validates a temporary file before atomically replacing output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-download-success-"));
  const outPath = join(directory, "highlight.mp4");
  await writeFile(outPath, "old-good-file");
  let validatedPath = "";
  try {
    const returned = await downloadHighlight(
      VIDEO_ID,
      { outPath, overwrite: true },
      {
        captureManifest: async () => "https://media.invalid/authorized.m3u8",
        runFfmpeg: async (_url, temporaryPath) => {
          assert.notEqual(temporaryPath, outPath);
          await writeFile(temporaryPath, "new-validated-file");
        },
        validateOutput: async (temporaryPath) => {
          validatedPath = temporaryPath;
          assert.equal(await readFile(temporaryPath, "utf8"), "new-validated-file");
          assert.equal(await readFile(outPath, "utf8"), "old-good-file");
        }
      }
    );

    assert.equal(returned, outPath);
    assert.notEqual(validatedPath, outPath);
    assert.equal(await readFile(outPath, "utf8"), "new-validated-file");
    assert.deepEqual((await readdir(directory)).filter((name) => /\.part-|\.backup-/.test(name)), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("downloadHighlight preserves an existing good file and removes partial output on failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-download-failure-"));
  const outPath = join(directory, "highlight.mp4");
  await writeFile(outPath, "old-good-file");
  try {
    await assert.rejects(
      () => downloadHighlight(
        VIDEO_ID,
        { outPath, overwrite: true },
        {
          captureManifest: async () => "https://media.invalid/authorized.m3u8",
          runFfmpeg: async (_url, temporaryPath) => {
            await writeFile(temporaryPath, "partial-file");
            throw new Error("mock ffmpeg failure");
          }
        }
      ),
      /mock ffmpeg failure/
    );

    assert.equal(await readFile(outPath, "utf8"), "old-good-file");
    assert.deepEqual((await readdir(directory)).filter((name) => /\.part-|\.backup-/.test(name)), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("downloadHighlight cleans a rejected file after validation fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-download-validation-"));
  const outPath = join(directory, "highlight.mp4");
  try {
    await assert.rejects(
      () => downloadHighlight(
        VIDEO_ID,
        { outPath },
        {
          captureManifest: async () => "https://media.invalid/authorized.m3u8",
          runFfmpeg: async (_url, temporaryPath) => writeFile(temporaryPath, "too-short"),
          validateOutput: async () => { throw new Error("mock validation failure"); }
        }
      ),
      /mock validation failure/
    );

    await assert.rejects(() => readFile(outPath), /ENOENT/);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("downloadHighlight reacquires authorization and retries an incomplete file once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-download-retry-"));
  const outPath = join(directory, "highlight.mp4");
  let captures = 0;
  let validations = 0;
  try {
    await downloadHighlight(
      VIDEO_ID,
      { outPath },
      {
        captureManifest: async () => {
          captures += 1;
          return `https://media.invalid/authorized-${captures}.m3u8`;
        },
        runFfmpeg: async (_url, temporaryPath) => writeFile(temporaryPath, `attempt-${captures}`),
        validateOutput: async () => {
          validations += 1;
          if (validations === 1) {
            throw new FifaWorldCup26Error("下载文件不完整：实际 130.0 秒，预期约 134.1 秒");
          }
        }
      }
    );

    assert.equal(captures, 2);
    assert.equal(validations, 2);
    assert.equal(await readFile(outPath, "utf8"), "attempt-2");
    assert.deepEqual((await readdir(directory)).filter((name) => /\.part-|\.backup-/.test(name)), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("downloadHighlight refuses an existing output before resolving media", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-download-existing-"));
  const outPath = join(directory, "highlight.mp4");
  await writeFile(outPath, "keep-me");
  let captured = false;
  try {
    await assert.rejects(
      () => downloadHighlight(
        VIDEO_ID,
        { outPath },
        { captureManifest: async () => { captured = true; return "unused"; } }
      ),
      /输出文件已存在/
    );
    assert.equal(captured, false);
    assert.equal(await readFile(outPath, "utf8"), "keep-me");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("downloadHighlight rejects a nonempty audio-only file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wc26-download-audio-only-"));
  const outPath = join(directory, "highlight.mp4");
  const fakeFfprobe = join(directory, "fake-ffprobe");
  await writeFile(
    fakeFfprobe,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({format:{duration:"134.144"},streams:[{codec_type:"audio"}]}));\n'
  );
  await chmod(fakeFfprobe, 0o755);
  try {
    await assert.rejects(
      () => downloadHighlight(
        VIDEO_ID,
        { outPath, ffprobePath: fakeFfprobe, expectedDurationSeconds: 134.144 },
        {
          captureManifest: async () => "https://media.invalid/authorized.m3u8",
          runFfmpeg: async (_url, temporaryPath) => writeFile(temporaryPath, "audio-only")
        }
      ),
      /未检测到视频流/
    );

    await assert.rejects(() => readFile(outPath), /ENOENT/);
    assert.deepEqual(
      (await readdir(directory)).filter((name) => /\.part-|\.backup-/.test(name)),
      []
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

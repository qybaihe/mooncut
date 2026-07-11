/**
 * Packaging honesty: mac only claims arch we ship; runtime prep pins ffmpeg.
 */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const studioRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("mac electron-builder targets arm64 only (no false x64 claim)", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const mac = pkg.build?.mac;
  assert.ok(mac);
  for (const target of mac.target ?? []) {
    if (typeof target === "object" && target.arch) {
      assert.deepEqual(target.arch, ["arm64"], JSON.stringify(target));
    }
  }
});

test("prepare-runtime-bundle pins ffmpeg packages and records integrity", async () => {
  const script = await readFile(join(studioRoot, "scripts/prepare-runtime-bundle.mjs"), "utf8");
  assert.ok(script.includes("@ffmpeg-installer/ffmpeg@1.1.0") || script.includes('"@ffmpeg-installer/ffmpeg": "1.1.0"'));
  assert.ok(script.includes("@ffprobe-installer/ffprobe@2.1.2") || script.includes('"@ffprobe-installer/ffprobe": "2.1.2"'));
  assert.ok(script.includes("binaryIntegrity"));
  assert.ok(script.includes("sha256"));
  assert.ok(script.includes("pin.json"));
  // must not use unpinned npm install of bare package names without version
  assert.equal(/npm",\s*\[\s*"install",\s*"@ffmpeg-installer\/ffmpeg"\s*\]/u.test(script), false);
});

/**
 * Packaging honesty: mac only claims arch we ship; runtime prep pins ffmpeg;
 * brand app icons ship for all installers (no Electron default icon).
 */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {readFile, stat} from "node:fs/promises";
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

test("brand app icons exist for mac/win/linux packaging", async () => {
  const required = [
    "build/icon.png",
    "build/icon.icns",
    "build/icon.ico",
    "build/icons/512x512.png",
    "build/icons/256x256.png",
    "build/icons/128x128.png",
  ];
  for (const rel of required) {
    const path = join(root, rel);
    assert.ok(existsSync(path), `missing ${rel}`);
    const size = (await stat(path)).size;
    assert.ok(size > 1024, `${rel} too small (${size})`);
  }
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.build?.icon, "build/icon.png");
  assert.equal(pkg.build?.mac?.icon, "build/icon.icns");
  assert.equal(pkg.build?.win?.icon, "build/icon.ico");
  assert.equal(pkg.build?.linux?.icon, "build/icons");
  assert.equal(pkg.build?.nsis?.installerIcon, "build/icon.ico");
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

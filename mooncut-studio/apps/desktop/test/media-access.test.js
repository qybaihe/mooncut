/**
 * Security: path allowlist + permission bounds (shipped media-access helpers).
 */
import assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {
  isPathAllowed,
  isPathUnderRoot,
  shouldGrantPermission,
  MAX_RECORDING_BYTES,
  STUDIO_MEDIA_PERMISSIONS,
} from "../src/main/media-access.js";

test("isPathUnderRoot allows only descendants", () => {
  const root = join("/Users/demo", "MoonCut", "Projects", "a");
  assert.equal(isPathUnderRoot(join(root, "media", "x.mp4"), root), true);
  assert.equal(isPathUnderRoot(root, root), true);
  assert.equal(isPathUnderRoot(join("/Users/demo", "other", "x.mp4"), root), false);
  assert.equal(isPathUnderRoot(join(root, "..", "b", "x.mp4"), root), false);
});

test("isPathAllowed checks any root", () => {
  const a = join("/tmp", "proj-a");
  const b = join("/tmp", "proj-b");
  assert.equal(isPathAllowed(join(a, "m.mp4"), [a, b]), true);
  assert.equal(isPathAllowed(join("/etc", "passwd"), [a, b]), false);
});

test("shouldGrantPermission only media-like from local app pages", () => {
  assert.equal(shouldGrantPermission("media", "http://127.0.0.1:5178/"), true);
  assert.equal(shouldGrantPermission("display-capture", "file:///app/index.html"), true);
  assert.equal(shouldGrantPermission("media", "https://evil.example/"), false);
  assert.equal(shouldGrantPermission("geolocation", "http://127.0.0.1:5178/"), false);
  assert.equal(shouldGrantPermission("notifications", "file:///x"), false);
  assert.ok(STUDIO_MEDIA_PERMISSIONS.has("media"));
  assert.ok(MAX_RECORDING_BYTES >= 100 * 1024 * 1024);
});
